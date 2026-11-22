import type { FastifyInstance } from 'fastify';
import {
  detectIranianBankName,
  normalizeCardNumber,
  parseBankCardsJson,
} from '../../../../domain/services/PaymentService.js';
import { parseVolumePricingTiersJson } from '../../../../domain/services/PricingService.js';
import {
  customServiceNameEnabled,
  customVolumeEnabled,
  onHoldDefaultEnabled,
  renewalRolloverEnabled,
  requirePhoneForTrial,
  uniqueTopupAmountEnabled,
  walletTransferEnabled,
  walletTransferMinAmount,
} from '../../../../domain/services/FeatureSettings.js';
import type { ContactVerificationService } from '../../../../domain/services/ContactVerificationService.js';
import { sendWebAppConfigArtifact } from '../../../../telegram/webappNotifications.js';
import {
  resolveSupportInfoForUser,
  resolveUserLocale,
  type UserRateLimitConfigs,
  type UserRoutesOptions,
} from './shared.js';

export function registerUserProfileRoutes(
  userScope: FastifyInstance,
  options: UserRoutesOptions,
  limits: UserRateLimitConfigs,
  contactVerificationService: ContactVerificationService
): void {
  // GET /api/user/profile
  userScope.get(
    '/api/user/profile',
    {
      config: {
        rateLimit: limits.standard,
      },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      let profile = await options.userService.findProfile(String(telegramId));
      if (!profile) {
        await options.walletService.getOrCreateUser(telegramId);
        profile = await options.userService.findProfile(String(telegramId));
      }

      if (!profile) {
        return reply.code(404).send({ error: 'User profile not found' });
      }

      const locale = await resolveUserLocale(telegramId, options);
      const currency = options.translationService?.getSetting('currency', 'تومان') || 'تومان';
      let cardNumber = '';
      let cardHolder = '';
      let bankName = '';
      let cardId = '';
      let allCardsCapReached = false;

      // Read-only card preview on profile load (never mutates PaymentService.rotationCounter!)
      if (options.paymentService) {
        if (typeof options.paymentService.getActiveBankCards === 'function') {
          const activeCards = options.paymentService.getActiveBankCards();
          if (activeCards.length > 0) {
            let picked = activeCards[0]!;
            if (
              typeof options.paymentService.getTodayCardUsageMap === 'function' &&
              typeof options.paymentService.canCardAcceptAmount === 'function'
            ) {
              const usageMap = await options.paymentService.getTodayCardUsageMap();
              const eligible = activeCards.filter((card) =>
                options.paymentService!.canCardAcceptAmount(card, 0, usageMap)
              );
              if (eligible.length > 0) {
                picked = eligible[0]!;
              } else {
                allCardsCapReached = true;
                picked = undefined as never;
              }
            }
            if (picked) {
              cardId = picked.id;
              cardNumber = picked.cardNumber;
              cardHolder = picked.cardHolder;
              bankName = picked.bankName || detectIranianBankName(cardNumber, locale) || '';
            }
          }
        } else {
          const selectedCard =
            typeof options.paymentService.selectCardForTopupWithDailyCaps === 'function'
              ? await options.paymentService.selectCardForTopupWithDailyCaps()
              : typeof options.paymentService.selectCardForTopup === 'function'
                ? options.paymentService.selectCardForTopup()
                : null;
          if (selectedCard) {
            cardId = selectedCard.id;
            cardNumber = selectedCard.cardNumber;
            cardHolder = selectedCard.cardHolder;
            bankName = selectedCard.bankName || detectIranianBankName(cardNumber, locale) || '';
          }
        }
      } else if (options.translationService) {
        const configuredEnabled = parseBankCardsJson(
          options.translationService.getSetting('bank_cards_json', '[]')
        ).filter((card) => card.enabled);
        if (configuredEnabled.length > 0) {
          const picked = configuredEnabled[0]!;
          cardId = picked.id;
          cardNumber = picked.cardNumber;
          cardHolder = picked.cardHolder;
          bankName = picked.bankName || detectIranianBankName(cardNumber, locale) || '';
        } else {
          cardNumber = normalizeCardNumber(
            options.translationService.getSetting('card_number', '')
          );
          cardHolder = options.translationService.getSetting('card_holder', '').trim();
          bankName = cardNumber ? (detectIranianBankName(cardNumber, locale) ?? '') : '';
        }
      }

      const support = resolveSupportInfoForUser(options);
      const availableBalance = Math.max(0, profile.balance - profile.reservedBalance);

      const pendingReceiptRow = await options.walletService.getPendingReceiptForUser?.(telegramId);
      const pendingReceipt = pendingReceiptRow
        ? {
            id: pendingReceiptRow.id,
            amount: pendingReceiptRow.amount,
            status: pendingReceiptRow.status,
            createdAt:
              pendingReceiptRow.createdAt instanceof Date
                ? pendingReceiptRow.createdAt.toISOString()
                : String(pendingReceiptRow.createdAt),
          }
        : null;

      const ts = options.translationService;
      const cvEnabled = ts ? customVolumeEnabled(ts) : true;
      const pricePerGb =
        typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('price_per_gb', 5000) : 5000;
      const pricePerDay =
        typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('price_per_day', 0) : 0;
      const topupMinAmount =
        typeof ts?.getSettingNum === 'function'
          ? ts.getSettingNum('topup_min_amount', 10_000)
          : 10_000;
      const topupMaxAmount =
        typeof ts?.getSettingNum === 'function'
          ? ts.getSettingNum('topup_max_amount', 10_000_000)
          : 10_000_000;
      const defaultDays =
        typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('custom_default_days', 30) : 30;
      const minGb =
        typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('custom_min_gb', 5) : 5;
      const maxGb =
        typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('custom_max_gb', 500) : 500;
      const volumePricingTiers =
        parseVolumePricingTiersJson(ts?.getSetting('volume_pricing_tiers_json', '') ?? '') ?? [];

      const customNameEnabled = ts ? customServiceNameEnabled(ts) : false;
      const onHoldDefault = ts ? onHoldDefaultEnabled(ts) : false;
      const rolloverDefault = ts ? renewalRolloverEnabled(ts) : true;
      const isUniqueTopupEnabled = ts ? uniqueTopupAmountEnabled(ts) : false;
      const isWalletTransferEnabled = ts ? walletTransferEnabled(ts) : true;
      const walletTransferMin = ts ? walletTransferMinAmount(ts) : 5_000;
      const botEnabled =
        typeof ts?.getSettingBool === 'function' ? ts.getSettingBool('bot_enabled', true) : true;
      const isAdmin =
        request.userSession?.role === 'admin' ||
        Boolean(options.adminService?.isAdmin?.(telegramId)) ||
        Boolean(options.adminIds?.includes(telegramId));

      let phoneVerificationRequired: boolean;
      let phoneVerified: boolean;
      let trialPhoneRequired: boolean;
      try {
        phoneVerificationRequired = await contactVerificationService.shouldRequirePhoneForPurchase(
          telegramId,
          ts
        );
        phoneVerified = await contactVerificationService.isUserPhoneVerified(telegramId);
        trialPhoneRequired = await contactVerificationService.shouldRequirePhoneForTrial(
          telegramId,
          ts
        );
      } catch {
        phoneVerificationRequired = false;
        phoneVerified = false;
        trialPhoneRequired = false;
      }

      // Free Trial summary
      const trialEnabled =
        typeof ts?.getSettingBool === 'function' ? ts.getSettingBool('trial_enabled', true) : true;
      const trialGb = typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('trial_gb', 1) : 1;
      const trialDays =
        typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('trial_days', 3) : 3;
      const trialRequiresPhoneSetting = ts ? requirePhoneForTrial(ts) : false;

      // Lucky Wheel summary (best-effort)
      let luckyWheelSummary: {
        enabled: boolean;
        canSpin: boolean;
        reason?: string;
        totalSpins: number;
        maxSpins: number;
        spinsRemaining: number;
        minPrize: number;
        maxPrize: number;
        nextSpinAt: string | null;
        secondsRemaining: number | null;
      } | null = null;
      if (typeof options.luckyWheelService?.getStatus === 'function') {
        try {
          const wheelStatus = await options.luckyWheelService.getStatus(telegramId);
          luckyWheelSummary = {
            enabled: wheelStatus.enabled,
            canSpin: wheelStatus.canSpin,
            ...(wheelStatus.reason ? { reason: wheelStatus.reason } : {}),
            totalSpins: wheelStatus.totalSpins,
            maxSpins: wheelStatus.maxSpins,
            spinsRemaining: Math.max(0, wheelStatus.maxSpins - wheelStatus.totalSpins),
            minPrize: wheelStatus.minPrize,
            maxPrize: wheelStatus.maxPrize,
            nextSpinAt: wheelStatus.nextSpinAt ? wheelStatus.nextSpinAt.toISOString() : null,
            secondsRemaining: wheelStatus.secondsRemaining ?? null,
          };
        } catch {
          luckyWheelSummary = null;
        }
      } else {
        const wheelEnabled =
          typeof ts?.getSettingBool === 'function'
            ? ts.getSettingBool('lucky_wheel_enabled', true)
            : false;
        if (wheelEnabled) {
          luckyWheelSummary = {
            enabled: false,
            canSpin: false,
            reason: 'disabled',
            totalSpins: 0,
            maxSpins: 0,
            spinsRemaining: 0,
            minPrize: 0,
            maxPrize: 0,
            nextSpinAt: null,
            secondsRemaining: null,
          };
        }
      }

      // Referral & Cashback rich summary (mirrors Telegram Bot `mainMenu.ts`)
      const referralBonusToman =
        typeof ts?.getSettingNum === 'function'
          ? ts.getSettingNum('referral_bonus_toman', 10_000)
          : 10_000;
      const cashbackPercent =
        typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('cashback_percent', 0) : 0;
      let activeBuyers = 0;
      if (typeof options.referralService?.getReferralStats === 'function') {
        try {
          const refStats = await options.referralService.getReferralStats(telegramId);
          activeBuyers = refStats.activeBuyers;
        } catch {
          activeBuyers = 0;
        }
      }

      return reply.code(200).send({
        user: {
          id: profile.id,
          telegramId: profile.telegramId,
          username: profile.username,
          firstName: profile.firstName,
          lastName: profile.lastName,
          balance: profile.balance,
          reservedBalance: profile.reservedBalance,
          availableBalance,
          referralCode: profile.referralCode,
          totalSpend: profile.totalSpend,
          activeSubscriptionCount: profile.activeSubscriptionCount,
          transactionCount: profile.transactionCount,
          referredUserCount: profile.referredUserCount,
          activeBuyersCount: activeBuyers,
          referralBonusEarned: profile.referralBonusEarned,
          cashbackEarned: profile.cashbackEarned,
          hasUsedTrial: profile.hasUsedTrial,
          phoneVerificationRequired,
          phoneVerified,
          createdAt: profile.createdAt,
        },
        settings: {
          currency,
          cardNumber,
          cardHolder,
          ...(bankName ? { bankName } : {}),
          ...(cardId ? { cardId } : {}),
          allCardsCapReached,
          uniqueTopupAmountEnabled: isUniqueTopupEnabled,
          nativeReceiptUploadEnabled: Boolean(options.botApi),
          walletTransferEnabled: isWalletTransferEnabled,
          walletTransferMinAmount: walletTransferMin,
          supportUsername: support.supportUsername,
          supportUrl: support.supportUrl,
          supportLabel: support.supportLabel,
          supportEnabled: support.supportEnabled,
          botUsername: options.botUsername || '',
          topupMinAmount,
          topupMaxAmount,
          referralBonusToman,
          cashbackPercent,
          maintenanceMode: !botEnabled,
          isAdminBypass: !botEnabled && isAdmin,
          customServiceNameEnabled: customNameEnabled,
          onHoldDefaultEnabled: onHoldDefault,
          renewalRolloverEnabled: rolloverDefault,
          customVolume: {
            enabled: cvEnabled,
            pricePerGb,
            pricePerDay,
            defaultDays,
            minGb,
            maxGb,
            tiers: volumePricingTiers,
          },
        },
        trial: {
          enabled: trialEnabled && Boolean(options.trialService),
          eligible: trialEnabled && Boolean(options.trialService) && !profile.hasUsedTrial,
          hasUsedTrial: profile.hasUsedTrial,
          gb: trialGb,
          days: trialDays,
          requirePhone: trialRequiresPhoneSetting,
          phoneVerificationRequired: trialPhoneRequired,
        },
        luckyWheel: luckyWheelSummary,
        pendingReceipt,
      });
    }
  );

  // GET /api/user/trial/status
  userScope.get(
    '/api/user/trial/status',
    {
      config: {
        rateLimit: limits.standard,
      },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const ts = options.translationService;
      const profile = await options.userService.findProfile(String(telegramId));
      const hasUsedTrial = profile?.hasUsedTrial ?? false;
      const enabled =
        Boolean(options.trialService) &&
        (typeof ts?.getSettingBool === 'function'
          ? ts.getSettingBool('trial_enabled', true)
          : true);
      const gb = typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('trial_gb', 1) : 1;
      const days = typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('trial_days', 3) : 3;
      const requirePhone = ts ? requirePhoneForTrial(ts) : false;

      let phoneVerificationRequired: boolean;
      try {
        phoneVerificationRequired = await contactVerificationService.shouldRequirePhoneForTrial(
          telegramId,
          ts
        );
      } catch {
        phoneVerificationRequired = false;
      }

      return reply.code(200).send({
        enabled,
        eligible: enabled && !hasUsedTrial,
        hasUsedTrial,
        gb,
        days,
        requirePhone,
        phoneVerificationRequired,
      });
    }
  );

  // POST /api/user/trial/claim
  userScope.post(
    '/api/user/trial/claim',
    {
      config: {
        rateLimit: limits.confirm,
      },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (typeof options.trialService?.claimTrial !== 'function') {
        return reply
          .code(503)
          .send({ error: 'Trial service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      // Ensure user row exists before claiming
      const profile = await options.userService.findProfile(String(telegramId));
      if (!profile) {
        await options.walletService.getOrCreateUser(telegramId);
      }

      if (
        await contactVerificationService.shouldRequirePhoneForTrial(
          telegramId,
          options.translationService
        )
      ) {
        return reply.code(403).send({
          error: 'Phone verification is required before claiming a free trial',
          code: 'PHONE_VERIFICATION_REQUIRED',
        });
      }

      let panelId: string | undefined;
      let serviceId: number | undefined;
      try {
        if (typeof options.panelRegistry?.resolveTarget === 'function') {
          const target = await options.panelRegistry.resolveTarget();
          panelId = target.panelId;
          serviceId = target.serviceId;
        }
      } catch {
        return reply.code(503).send({
          error: 'No active panel available for trial',
          code: 'PANEL_DOWN',
          messageKey: 'trial_creation_failed',
        });
      }

      const configName =
        typeof options.configService?.generateConfigName === 'function'
          ? await options.configService.generateConfigName(telegramId, panelId)
          : `trial_${telegramId}_${Date.now()}`;

      const result = await options.trialService.claimTrial(
        telegramId,
        configName,
        panelId,
        serviceId
      );

      if (!result.success) {
        const statusCode =
          result.messageKey === 'trial_already_used'
            ? 409
            : result.messageKey === 'trial_disabled'
              ? 403
              : 503;
        const code =
          result.messageKey === 'trial_already_used'
            ? 'TRIAL_ALREADY_USED'
            : result.messageKey === 'trial_disabled'
              ? 'TRIAL_DISABLED'
              : 'TRIAL_CREATION_FAILED';
        return reply.code(statusCode).send({
          error: result.messageKey,
          code,
          messageKey: result.messageKey,
        });
      }

      const ts = options.translationService;
      const trialGb = typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('trial_gb', 1) : 1;
      const trialDays =
        typeof ts?.getSettingNum === 'function' ? ts.getSettingNum('trial_days', 3) : 3;

      if (options.botApi && ts) {
        void sendWebAppConfigArtifact(
          options.botApi,
          { userService: options.userService, translationService: ts },
          {
            telegramId,
            kind: 'trial',
            configUsername: configName,
            subUrl: result.subUrl,
            gbAmount: trialGb,
            durationDays: trialDays,
            webAppUrl: options.webAppUrl,
          }
        );
      }

      return reply.code(200).send({
        success: true,
        configUsername: configName,
        subUrl: result.subUrl ?? '',
        gb: trialGb,
        days: trialDays,
      });
    }
  );

  // GET /api/user/wheel/status
  userScope.get(
    '/api/user/wheel/status',
    {
      config: {
        rateLimit: limits.standard,
      },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (typeof options.luckyWheelService?.getStatus !== 'function') {
        return reply.code(200).send({
          enabled: false,
          canSpin: false,
          reason: 'disabled',
          totalSpins: 0,
          maxSpins: 0,
          spinsRemaining: 0,
          minPrize: 0,
          maxPrize: 0,
          currentEffectiveLuck: 0,
          nextSpinAt: null,
          secondsRemaining: null,
          history: [],
        });
      }

      // Ensure user row exists so first-time WebApp visitors can immediately spin
      const existing = await options.userService.findProfile(String(telegramId));
      if (!existing) {
        await options.walletService.getOrCreateUser(telegramId);
      }

      const [status, rawHistory] = await Promise.all([
        options.luckyWheelService.getStatus(telegramId),
        typeof options.luckyWheelService.listSpinsForUser === 'function'
          ? options.luckyWheelService.listSpinsForUser(telegramId, 10)
          : Promise.resolve([]),
      ]);

      return reply.code(200).send({
        enabled: status.enabled,
        canSpin: status.canSpin,
        ...(status.reason ? { reason: status.reason } : {}),
        totalSpins: status.totalSpins,
        maxSpins: status.maxSpins,
        spinsRemaining: Math.max(0, status.maxSpins - status.totalSpins),
        minPrize: status.minPrize,
        maxPrize: status.maxPrize,
        currentEffectiveLuck: status.currentEffectiveLuck,
        nextSpinAt: status.nextSpinAt ? status.nextSpinAt.toISOString() : null,
        secondsRemaining: status.secondsRemaining ?? null,
        history: rawHistory.map((row) => ({
          id: row.id,
          amount: row.amount,
          spinNumber: row.spinNumber,
          createdAt:
            row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
        })),
      });
    }
  );

  // POST /api/user/wheel/spin
  userScope.post(
    '/api/user/wheel/spin',
    {
      config: {
        rateLimit: limits.action10,
      },
    },
    async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (typeof options.luckyWheelService?.spin !== 'function') {
        return reply
          .code(503)
          .send({ error: 'Lucky wheel service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }

      const existing = await options.userService.findProfile(String(telegramId));
      if (!existing) {
        await options.walletService.getOrCreateUser(telegramId);
      }

      try {
        const result = await options.luckyWheelService.spin(telegramId);
        return reply.code(200).send({
          success: true,
          amount: result.amount,
          balanceAfter: result.balanceAfter,
          spinNumber: result.spinNumber,
          spinsRemaining: result.spinsRemaining,
          nextSpinAt: result.nextSpinAt ? result.nextSpinAt.toISOString() : null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'LUCKY_WHEEL_DISABLED') {
          return reply
            .code(403)
            .send({ error: 'Lucky wheel is disabled', code: 'LUCKY_WHEEL_DISABLED' });
        }
        if (msg === 'COOLDOWN_ACTIVE') {
          return reply.code(429).send({ error: 'Cooldown is active', code: 'COOLDOWN_ACTIVE' });
        }
        if (msg === 'MAX_SPINS_REACHED') {
          return reply
            .code(409)
            .send({ error: 'Maximum spins reached', code: 'MAX_SPINS_REACHED' });
        }
        if (msg === 'USER_BANNED') {
          return reply.code(403).send({ error: 'User is banned', code: 'USER_BANNED' });
        }
        return reply.code(500).send({ error: 'Spin failed', code: 'WHEEL_SPIN_FAILED' });
      }
    }
  );
}
