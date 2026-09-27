import type { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/adminGuard.js';
import type { UserService } from '../../../domain/services/UserService.js';
import type { WalletService } from '../../../domain/services/WalletService.js';
import type { ConfigService } from '../../../domain/services/ConfigService.js';
import type { PricingService } from '../../../domain/services/PricingService.js';
import type { TranslationService } from '../../../domain/services/TranslationService.js';
import { customVolumeEnabled } from '../../../domain/services/FeatureSettings.js';

function clampPositiveInt(val: string | number | undefined, fallback: number, max = 1000): number {
  if (val === undefined || val === null || val === '') return fallback;
  const parsed = typeof val === 'number' ? val : Number.parseInt(String(val), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function registerUserRoutes(
  app: FastifyInstance,
  options: {
    userService: UserService;
    walletService: WalletService;
    configService?: ConfigService;
    pricingService?: PricingService;
    translationService?: TranslationService;
    botUsername?: string;
  }
): void {
  app.register(async (userScope) => {
    userScope.addHook('preHandler', authGuard);

    // GET /api/user/profile
    userScope.get('/api/user/profile', async (request, reply) => {
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

      const currency = options.translationService?.getSetting('currency', 'تومان') || 'تومان';
      const cardNumber = options.translationService?.getSetting('card_number', '') || '';
      const cardHolder = options.translationService?.getSetting('card_holder', '') || '';
      const rawSupport = options.translationService?.getSetting('support_destination', '') || '';
      const supportUsername = rawSupport.replace(/^@/, '');
      const supportEnabled =
        options.translationService?.getSettingBool('support_enabled', true) ?? true;

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

      const cvEnabled = options.translationService
        ? customVolumeEnabled(options.translationService)
        : true;
      const pricePerGb =
        typeof options.translationService?.getSettingNum === 'function'
          ? options.translationService.getSettingNum('price_per_gb', 5000)
          : 5000;
      const pricePerDay =
        typeof options.translationService?.getSettingNum === 'function'
          ? options.translationService.getSettingNum('price_per_day', 0)
          : 0;
      const topupMinAmount =
        typeof options.translationService?.getSettingNum === 'function'
          ? options.translationService.getSettingNum('topup_min_amount', 10_000)
          : 10_000;
      const topupMaxAmount =
        typeof options.translationService?.getSettingNum === 'function'
          ? options.translationService.getSettingNum('topup_max_amount', 10_000_000)
          : 10_000_000;

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
          referralBonusEarned: profile.referralBonusEarned,
          cashbackEarned: profile.cashbackEarned,
          hasUsedTrial: profile.hasUsedTrial,
          createdAt: profile.createdAt,
        },
        settings: {
          currency,
          cardNumber,
          cardHolder,
          supportUsername,
          supportEnabled,
          botUsername: options.botUsername || '',
          topupMinAmount,
          topupMaxAmount,
          customVolume: {
            enabled: cvEnabled,
            pricePerGb,
            pricePerDay,
            defaultDays: 30,
            minGb: 5,
            maxGb: 500,
          },
        },
        pendingReceipt,
      });
    });

    // GET /api/user/configs
    userScope.get('/api/user/configs', async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!options.configService) {
        return reply.code(200).send({ configs: [] });
      }

      const rows = await options.configService.listConfigsForOwner(telegramId);
      const configs = rows.map((c) => ({
        id: c.id,
        configUsername: c.configUsername,
        subUrl: c.subUrl,
        panelStatus: c.panelStatus,
        panelDataLimit: c.panelDataLimit,
        panelUsedTraffic: c.panelUsedTraffic,
        panelExpire: c.panelExpire,
        autoRenewEnabled: c.autoRenewEnabled,
        createdAt: c.createdAt,
      }));

      return reply.code(200).send({ configs });
    });

    // GET /api/user/packages
    userScope.get('/api/user/packages', async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!options.pricingService) {
        return reply.code(200).send({ packages: [] });
      }

      const packages = options.pricingService
        .getPackages(undefined, undefined, false)
        .filter((p) => p.enabled !== false)
        .map((p) => ({
          id: p.id,
          name: p.name,
          gbAmount: p.gbAmount,
          durationDays: p.durationDays,
          price: p.price,
        }));

      return reply.code(200).send({ packages });
    });

    // GET /api/user/transactions
    userScope.get<{
      Querystring: {
        page?: string;
        limit?: string;
      };
    }>('/api/user/transactions', async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const page = clampPositiveInt(request.query.page, 1, 10_000);
      const limit = clampPositiveInt(request.query.limit, 10, 50);

      const result = await options.walletService.listTransactionsForUser(telegramId, page, limit);

      return reply.code(200).send({
        transactions: result.transactions.map((tx) => ({
          id: tx.id,
          amount: tx.amount,
          balanceAfter: tx.balanceAfter,
          type: tx.type,
          description: tx.description,
          createdAt: tx.createdAt,
        })),
        total: result.total,
        totalPages: result.totalPages,
        page: result.page,
      });
    });

    // GET /api/user/quote
    userScope.get<{
      Querystring: {
        gb?: string;
        days?: string;
      };
    }>('/api/user/quote', async (request, reply) => {
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const gb = clampPositiveInt(request.query.gb, 10, 10_000);
      const days = clampPositiveInt(request.query.days, 30, 365);

      if (options.pricingService) {
        try {
          const quote = options.pricingService.getCustomPriceQuote(gb, days);
          return reply.code(200).send({
            gbAmount: gb,
            durationDays: days,
            totalPrice: quote.totalPrice,
            pricePerGb: quote.pricePerGb,
            pricePerDay: quote.pricePerDay,
          });
        } catch {
          // fallback to linear calculation
        }
      }

      const pricePerGb =
        typeof options.translationService?.getSettingNum === 'function'
          ? options.translationService.getSettingNum('price_per_gb', 5000)
          : 5000;
      const pricePerDay =
        typeof options.translationService?.getSettingNum === 'function'
          ? options.translationService.getSettingNum('price_per_day', 0)
          : 0;
      return reply.code(200).send({
        gbAmount: gb,
        durationDays: days,
        totalPrice: gb * pricePerGb + days * pricePerDay,
        pricePerGb,
        pricePerDay,
      });
    });
  });
}
