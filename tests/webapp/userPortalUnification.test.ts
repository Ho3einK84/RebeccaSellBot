import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import { resolveSupportDestination } from '../../src/domain/services/SupportDestination.js';
import { RefundOutcomePendingError } from '../../src/domain/services/RefundService.js';
import { api, type ApiClientError } from '../../webapp/src/shared/lib/api.js';
import { formatTransactionDescription } from '../../webapp/src/shared/lib/transactionFormatters.js';
import {
  buildClientConnectLinks,
  parseWebAppDeepLink,
} from '../../webapp/src/shared/lib/deepLinks.js';
import { Providers } from '../../webapp/src/app/providers.js';
import { LuckyWheelSection } from '../../webapp/src/features/user-portal/components/LuckyWheelSection.js';
import {
  FreeTrialBanner,
  FreeTrialResultModal,
} from '../../webapp/src/features/user-portal/components/FreeTrialSection.js';
import { SmartConnectButtons } from '../../webapp/src/features/user-portal/components/SmartConnectButtons.js';
import { ClaimSubLinkModal } from '../../webapp/src/features/user-portal/components/ClaimSubLinkModal.js';
import { ConfigTransferModal } from '../../webapp/src/features/user-portal/components/ConfigTransferModal.js';
import { ConfigDeleteRefundModal } from '../../webapp/src/features/user-portal/components/ConfigDeleteRefundModal.js';
import { WalletTransferModal } from '../../webapp/src/features/user-portal/components/WalletTransferModal.js';
import {
  TEST_BOT_TOKEN,
  createMockUserServices,
  createSignedInitData,
  createTestConfig,
} from './helpers/webappTestHarness.js';

function renderWithProviders(element: React.ReactElement, locale: 'fa' | 'en' = 'fa'): string {
  return renderToStaticMarkup(React.createElement(Providers, { initialLocale: locale }, element));
}

describe('User Portal Unification (Phases 0-4): P0/P1 Fixes, Wheel, Trial, Native Services & Wallet 2.0', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('Phase 0: P0/P1 Stability, Auth, Maintenance, Ban, Support & Formatting Fixes', () => {
    it('resolves all support destination formats including numeric Telegram IDs and admin fallback', () => {
      expect(resolveSupportDestination({ rawDestination: '@SkySupport' })).toMatchObject({
        url: 'https://t.me/SkySupport',
        username: 'SkySupport',
        label: '@SkySupport',
        kind: 'username',
      });
      expect(resolveSupportDestination({ rawDestination: '987654321' })).toMatchObject({
        url: 'tg://user?id=987654321',
        username: '',
        label: '987654321',
        kind: 'telegram_id',
      });
      expect(
        resolveSupportDestination({ rawDestination: '', supportUrl: 'https://help.example.com' })
      ).toMatchObject({
        url: 'https://help.example.com',
        kind: 'url',
      });
      expect(
        resolveSupportDestination({ rawDestination: '', fallbackAdminId: 123456 })
      ).toMatchObject({
        url: 'tg://user?id=123456',
        label: '123456',
        kind: 'telegram_id',
      });
    });

    it('enforces maintenance mode (503) for users while allowing Admin bypass and includes supportUrl on banned 403', async () => {
      const base = createMockUserServices();
      base.mockTranslationService.getSettingBool.mockImplementation(
        (key: string, defaultValue = true) => {
          if (key === 'bot_enabled') return false;
          if (key === 'support_enabled') return true;
          return defaultValue;
        }
      );

      const app = await createWebAppServer(createTestConfig(), base.mockServices, {
        serveStatic: false,
      });
      try {
        const userToken = app.jwt.sign({ telegramId: 55555, role: 'user' });
        const adminToken = app.jwt.sign({ telegramId: 12345, role: 'admin' });
        const bannedToken = app.jwt.sign({ telegramId: 99999, role: 'user' });

        // Regular user blocked with 503 MAINTENANCE_MODE + support info
        const maintRes = await app.inject({
          method: 'GET',
          url: '/api/user/profile',
          cookies: { session: userToken },
        });
        expect(maintRes.statusCode).toBe(503);
        expect(maintRes.json()).toMatchObject({
          code: 'MAINTENANCE_MODE',
          supportUrl: 'https://t.me/RebeccaSupport',
        });

        // Banned user receives supportUrl inside 403 USER_BANNED response (P0-4 fix)
        const banRes = await app.inject({
          method: 'GET',
          url: '/api/user/profile',
          cookies: { session: bannedToken },
        });
        expect(banRes.statusCode).toBe(403);
        expect(banRes.json()).toMatchObject({
          code: 'USER_BANNED',
          supportUrl: 'https://t.me/RebeccaSupport',
          supportUsername: 'RebeccaSupport',
        });

        // Admin bypasses maintenance mode cleanly
        base.mockUserService.findProfile.mockResolvedValueOnce({
          id: 'u-admin',
          telegramId: 12345,
          username: 'admin',
          firstName: 'Admin',
          lastName: null,
          balance: 100_000,
          reservedBalance: 0,
          referralCode: 'ref_12345',
          totalSpend: 0,
          activeSubscriptionCount: 0,
          transactionCount: 0,
          referredUserCount: 0,
          referralBonusEarned: 0,
          cashbackEarned: 0,
          hasUsedTrial: false,
          createdAt: new Date(),
        });
        const adminRes = await app.inject({
          method: 'GET',
          url: '/api/user/profile',
          cookies: { session: adminToken },
        });
        expect(adminRes.statusCode).toBe(200);
        expect(adminRes.json().settings.maintenanceMode).toBe(true);
        expect(adminRes.json().settings.isAdminBypass).toBe(true);
      } finally {
        await app.close();
      }
    });

    it('P0-3: allows renew_config checkout confirm when require_phone_for_purchase is true, while blocking new_config', async () => {
      const base = createMockUserServices();
      const contactVerificationService = {
        shouldRequirePhoneForPurchase: vi.fn(async () => true),
        shouldRequirePhoneForTrial: vi.fn(async () => false),
        isUserPhoneVerified: vi.fn(async () => false),
      };

      const app = await createWebAppServer(
        createTestConfig(),
        {
          ...base.mockServices,
          contactVerificationService: contactVerificationService as any,
        },
        { serveStatic: false }
      );

      try {
        const token = app.jwt.sign({ telegramId: 55555, role: 'user' });

        // Renewal confirm succeeds without phone verification
        base.mockPurchaseCheckoutService.claim.mockResolvedValueOnce({
          id: 'co_renew_phone_test',
          telegramId: 55555,
          kind: 'renew_config',
          configId: 'cfg_1',
          packageId: 'pkg_10gb_10d',
          packageName: '10 GB - 10 Days',
          panelId: 'panel_1',
          serviceId: 1,
          amount: 40_000,
          quotedAmount: 40_000,
          gbAmount: 10,
          durationDays: 10,
          promoCode: null,
          status: 'processing',
          expiresAt: new Date(Date.now() + 600_000),
          claimedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const renewRes = await app.inject({
          method: 'POST',
          url: '/api/user/checkout/co_renew_phone_test/confirm',
          cookies: { session: token },
        });
        expect(renewRes.statusCode).toBe(200);
        expect(renewRes.json().success).toBe(true);

        // New config confirm is blocked with 403 PHONE_VERIFICATION_REQUIRED
        const newRes = await app.inject({
          method: 'POST',
          url: '/api/user/checkout/co_new_phone_test/confirm',
          cookies: { session: token },
        });
        expect(newRes.statusCode).toBe(403);
        expect(newRes.json().code).toBe('PHONE_VERIFICATION_REQUIRED');
      } finally {
        await app.close();
      }
    });

    it('P0-5: upserts Telegram profile and referral start_param on /api/auth/telegram-validate', async () => {
      const base = createMockUserServices();
      const app = await createWebAppServer(createTestConfig(), base.mockServices, {
        serveStatic: false,
      });
      try {
        const initData = createSignedInitData({
          botToken: TEST_BOT_TOKEN,
          fields: {
            auth_date: String(Math.floor(Date.now() / 1000)),
            start_param: 'ref_777_abc',
            user: JSON.stringify({
              id: 55555,
              username: 'ali_tg',
              first_name: 'Ali',
              last_name: 'Karimi',
              language_code: 'fa',
            }),
          },
        });

        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/telegram-validate',
          payload: { initData },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().startParam).toBe('ref_777_abc');
        expect(base.mockWalletService.getOrCreateUser).toHaveBeenCalledWith(
          55555,
          'ali_tg',
          'Ali',
          'Karimi',
          'ref_777_abc',
          'fa',
          'webapp_referral'
        );
      } finally {
        await app.close();
      }
    });

    it('P0-1: frontend api.confirmCheckout throws ApiClientError(202) on PURCHASE_OUTCOME_PENDING', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                error: 'being verified, funds stay reserved',
                code: 'PURCHASE_OUTCOME_PENDING',
              }),
              { status: 202, headers: { 'content-type': 'application/json' } }
            )
        )
      );

      await expect(api.confirmCheckout('co_pending_202')).rejects.toMatchObject({
        name: 'ApiClientError',
        status: 202,
        code: 'PURCHASE_OUTCOME_PENDING',
      } satisfies Partial<ApiClientError>);
    });

    it('P1-1: formats WalletService transfer and voided receipt descriptions cleanly in FA and EN', () => {
      expect(formatTransactionDescription('Transfer to 987654', 'fa')).toBe(
        'انتقال موجودی به کاربر ۹۸۷۶۵۴'
      );
      expect(formatTransactionDescription('Transfer from 123456: اشتراک', 'fa')).toBe(
        'دریافت از کاربر ۱۲۳۴۵۶ (اشتراک)'
      );
      expect(formatTransactionDescription('Transfer to 987654', 'en')).toBe(
        'Transfer to user 987654'
      );
      expect(formatTransactionDescription('Top-up receipt rec_99 voided by admin 1', 'fa')).toBe(
        'ابطال رسید تأییدشده توسط مدیریت'
      );
    });
  });

  describe('Phases 1-3: Lucky Wheel, Free Trial, Native Service Ops & Wallet 2.0 API Routes', () => {
    it('supports Lucky Wheel status/spin and Free Trial status/claim endpoints', async () => {
      const base = createMockUserServices();
      const luckyWheelService = {
        getStatus: vi.fn(async () => ({
          enabled: true,
          canSpin: true,
          totalSpins: 1,
          maxSpins: 5,
          minPrize: 5_000,
          maxPrize: 50_000,
          currentEffectiveLuck: 40,
        })),
        listSpinsForUser: vi.fn(async () => [
          {
            id: 'spin_1',
            amount: 15_000,
            spinNumber: 1,
            effectiveLuckPercent: 50,
            createdAt: new Date('2026-11-20T10:00:00Z'),
          },
        ]),
        spin: vi.fn(async () => ({
          success: true,
          amount: 20_000,
          balanceAfter: 95_000,
          spinNumber: 2,
          spinsRemaining: 3,
          nextSpinAt: new Date('2026-11-23T10:00:00Z'),
          effectiveLuckPercent: 40,
        })),
      };
      const trialService = {
        claimTrial: vi.fn(async () => ({
          success: true,
          messageKey: 'trial_success',
          subUrl: 'https://sub.example.com/trial_token',
        })),
      };
      const referralService = {
        getReferralStats: vi.fn(async () => ({
          totalInvited: 3,
          activeBuyers: 2,
          totalReferralBonus: 30_000,
          totalCashback: 12_500,
        })),
      };
      const botApi = {
        sendMessage: vi.fn(async () => ({ message_id: 99 })),
      };
      (base.mockPanelRegistry as unknown as Record<string, unknown>).resolveTarget = vi.fn(
        async () => ({ panelId: 'panel_1', serviceId: 1 })
      );
      // Allow user 55555 to be trial-eligible for this test
      const origFindProfile = base.mockUserService.findProfile;
      base.mockUserService.findProfile = vi.fn(async (id: string | number) => {
        const profile = await origFindProfile(id);
        return profile ? { ...profile, hasUsedTrial: false } : null;
      });

      const app = await createWebAppServer(
        createTestConfig(),
        {
          ...base.mockServices,
          luckyWheelService: luckyWheelService as any,
          trialService: trialService as any,
          referralService: referralService as any,
          botApi: botApi as any,
        },
        { serveStatic: false }
      );

      try {
        const token = app.jwt.sign({ telegramId: 55555, role: 'user' });

        // Profile includes wheel, trial, activeBuyersCount & bilingual package metadata
        const profileRes = await app.inject({
          method: 'GET',
          url: '/api/user/profile',
          cookies: { session: token },
        });
        expect(profileRes.statusCode).toBe(200);
        const pBody = profileRes.json();
        expect(pBody.user.activeBuyersCount).toBe(2);
        expect(pBody.trial).toMatchObject({ enabled: true, eligible: true, gb: 1, days: 3 });
        expect(pBody.luckyWheel).toMatchObject({ enabled: true, canSpin: true, spinsRemaining: 4 });

        // Wheel status & spin
        const wheelStatus = await app.inject({
          method: 'GET',
          url: '/api/user/wheel/status',
          cookies: { session: token },
        });
        expect(wheelStatus.statusCode).toBe(200);
        expect(wheelStatus.json().history).toHaveLength(1);

        const spinRes = await app.inject({
          method: 'POST',
          url: '/api/user/wheel/spin',
          cookies: { session: token },
        });
        expect(spinRes.statusCode).toBe(200);
        expect(spinRes.json()).toMatchObject({
          success: true,
          amount: 20_000,
          balanceAfter: 95_000,
          spinsRemaining: 3,
        });

        // Trial claim
        const trialRes = await app.inject({
          method: 'POST',
          url: '/api/user/trial/claim',
          cookies: { session: token },
        });
        expect(trialRes.statusCode).toBe(200);
        expect(trialRes.json()).toMatchObject({
          success: true,
          subUrl: 'https://sub.example.com/trial_token',
        });
      } finally {
        await app.close();
      }
    });

    it('supports native service claim, per-node usage, transfer, refund quote & delete, and Wallet 2.0 topup/transfer', async () => {
      const base = createMockUserServices();
      const validJpegBase64 = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00, 0x00,
      ]).toString('base64');

      (base.mockConfigService as Record<string, unknown>).claimSubLink = vi.fn(async () => ({
        success: true,
        messageKey: 'claimed_success',
        username: 'claimed_srv_1',
        panelId: 'panel_1',
      }));
      (base.mockConfigService as Record<string, unknown>).getRemoteConfigUsage = vi.fn(
        async () => ({
          usages: [{ node_id: 1, node_name: 'DE-Hetzner', used_traffic: 4_200_000_000 }],
        })
      );
      (base.mockConfigService as Record<string, unknown>).getRemoteConfigDetail = vi.fn(
        async () => ({
          online_at: '2026-11-22T15:00:00Z',
          sub_updated_at: '2026-11-22T14:00:00Z',
          lifetime_used_traffic: 4_200_000_000,
        })
      );
      (base.mockConfigService as Record<string, unknown>).deleteConfigCompletely = vi.fn(
        async () => true
      );
      (base.mockUserService as Record<string, unknown>).findTransferRecipient = vi.fn(
        async (q: string) =>
          q === '@friend' || q === '77777'
            ? {
                telegramId: 77777,
                username: 'friend',
                firstName: 'Sara',
                lastName: null,
                isBanned: false,
              }
            : null
      );
      (base.mockUserService as Record<string, unknown>).listReceiptsForUser = vi.fn(async () => ({
        receipts: [
          {
            id: 'rec_170000_abcd',
            amount: 100_000,
            status: 'approved',
            cardNumber: '6037997911112222',
            createdAt: new Date('2026-11-20T00:00:00Z'),
            updatedAt: new Date('2026-11-20T00:05:00Z'),
          },
        ],
        total: 1,
        totalPages: 1,
        page: 1,
      }));
      (base.mockWalletService as Record<string, unknown>).submitTopupReceiptDetailed = vi.fn(
        async () => ({ receiptId: 'rec_999_ab12', duplicateOfReceiptId: null })
      );
      (base.mockWalletService as Record<string, unknown>).transferBalance = vi.fn(async () => ({
        success: true,
        fromTelegramId: 55555,
        toTelegramId: 77777,
        amount: 25_000,
        fromBalanceAfter: 50_000,
        toBalanceAfter: 80_000,
        txIdSender: 'tx_s',
        txIdRecipient: 'tx_r',
      }));

      const refundService = {
        quote: vi.fn(async () => ({
          eligible: true,
          configId: 'cfg_1',
          configUsername: 'u55555_srv1',
          panelId: 'panel_1',
          grossAmount: 120_000,
          cashbackWithheld: 6_000,
          refundAmount: 114_000,
          purchaseIntentId: 'pi_1',
          purchasedAt: new Date('2026-11-22T00:00:00Z'),
        })),
        executeDeleteWithRefund: vi
          .fn()
          .mockResolvedValueOnce({
            eligible: true,
            configId: 'cfg_1',
            configUsername: 'u55555_srv1',
            panelId: 'panel_1',
            grossAmount: 120_000,
            cashbackWithheld: 6_000,
            refundAmount: 114_000,
            purchaseIntentId: 'pi_1',
            purchasedAt: new Date('2026-11-22T00:00:00Z'),
          })
          .mockRejectedValueOnce(new RefundOutcomePendingError('rf_pending_1')),
      };
      const configTransferService = {
        transfer: vi.fn(async () => ({
          configUsername: 'u55555_srv1',
          fromTelegramId: 55555,
          toTelegramId: 77777,
        })),
      };
      const paymentService = {
        getActiveBankCards: vi.fn(() => [
          {
            id: 'card_1',
            cardNumber: '6037997911112222',
            cardHolder: 'Ali',
            enabled: true,
            dailyCapToman: 5_000_000,
            bankName: 'بانک ملی',
          },
        ]),
        getTodayCardUsageMap: vi.fn(async () => new Map()),
        canCardAcceptAmount: vi.fn(() => true),
        selectCardForTopupWithDailyCaps: vi.fn(async () => ({
          id: 'card_1',
          cardNumber: '6037997911112222',
          cardHolder: 'Ali',
          enabled: true,
          bankName: 'بانک ملی',
        })),
        allocateUniquePayableAmount: vi.fn(async (amt: number) => ({
          requestedAmount: amt,
          payableAmount: amt - 123,
          offset: 123,
          isUnique: true,
        })),
        recordCardDailyUsage: vi.fn(),
        resolveCardDisplayLabel: vi.fn(() => 'بانک ملی · •••• 2222'),
      };
      const botApi = {
        sendMessage: vi.fn(async () => ({ message_id: 10 })),
        sendPhoto: vi.fn(async () => ({
          photo: [{ file_id: 'tg_file_id_123', file_unique_id: 'tg_uniq_123' }],
        })),
      };

      const app = await createWebAppServer(
        createTestConfig(),
        {
          ...base.mockServices,
          refundService: refundService as any,
          configTransferService: configTransferService as any,
          paymentService: paymentService as any,
          botApi: botApi as any,
          adminIds: [12345],
        },
        { serveStatic: false }
      );

      try {
        const token = app.jwt.sign({ telegramId: 55555, role: 'user' });

        // 1. Claim sub link
        const claimRes = await app.inject({
          method: 'POST',
          url: '/api/user/configs/claim',
          cookies: { session: token },
          payload: { subUrl: 'https://sub.example.com/sub/abcdef123456' },
        });
        expect(claimRes.statusCode).toBe(200);
        expect(claimRes.json().username).toBe('claimed_srv_1');

        // 2. Per-node usage
        const usageRes = await app.inject({
          method: 'GET',
          url: '/api/user/configs/cfg_1/usage',
          cookies: { session: token },
        });
        expect(usageRes.statusCode).toBe(200);
        expect(usageRes.json().nodes[0].nodeName).toBe('DE-Hetzner');

        // 3. Refund quote + delete with refund + 202 pending
        const quoteRes = await app.inject({
          method: 'GET',
          url: '/api/user/configs/cfg_1/refund-quote',
          cookies: { session: token },
        });
        expect(quoteRes.statusCode).toBe(200);
        expect(quoteRes.json().refundAmount).toBe(114_000);

        const delRefundRes = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/delete',
          cookies: { session: token },
          payload: { withRefund: true },
        });
        expect(delRefundRes.statusCode).toBe(200);
        expect(delRefundRes.json()).toMatchObject({ refunded: true, refundAmount: 114_000 });

        const delPendingRes = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/delete',
          cookies: { session: token },
          payload: { withRefund: true },
        });
        expect(delPendingRes.statusCode).toBe(202);
        expect(delPendingRes.json().code).toBe('REFUND_OUTCOME_PENDING');

        // 4. Config transfer preview + execute
        const txPreview = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/transfer/preview',
          cookies: { session: token },
          payload: { recipient: '@friend' },
        });
        expect(txPreview.statusCode).toBe(200);
        expect(txPreview.json().recipient).toMatchObject({
          telegramId: 77777,
          displayName: 'Sara',
        });

        const txExec = await app.inject({
          method: 'POST',
          url: '/api/user/configs/cfg_1/transfer',
          cookies: { session: token },
          payload: { toTelegramId: 77777 },
        });
        expect(txExec.statusCode).toBe(200);
        expect(txExec.json().toTelegramId).toBe(77777);

        // 5. Wallet Top-Up prepare & native receipt upload
        const prepRes = await app.inject({
          method: 'POST',
          url: '/api/user/topup/prepare',
          cookies: { session: token },
          payload: { amount: 100_000 },
        });
        expect(prepRes.statusCode).toBe(200);
        expect(prepRes.json().card.cardNumber).toBe('6037997911112222');

        const uploadRes = await app.inject({
          method: 'POST',
          url: '/api/user/topup/receipt',
          cookies: { session: token },
          payload: {
            amount: 100_000,
            cardId: 'card_1',
            cardNumber: '6037997911112222',
            fileBase64: `data:image/jpeg;base64,${validJpegBase64}`,
          },
        });
        expect(uploadRes.statusCode).toBe(201);
        expect(uploadRes.json()).toMatchObject({ success: true, receiptId: 'rec_999_ab12' });

        // Reject invalid file magic bytes
        const badUpload = await app.inject({
          method: 'POST',
          url: '/api/user/topup/receipt',
          cookies: { session: token },
          payload: {
            amount: 100_000,
            fileBase64: Buffer.from('not-a-valid-image-payload-at-all').toString('base64'),
          },
        });
        expect(badUpload.statusCode).toBe(400);
        expect(badUpload.json().code).toBe('UNSUPPORTED_RECEIPT_TYPE');

        // 6. Receipts history + Wallet transfer preview/execute
        const receiptsRes = await app.inject({
          method: 'GET',
          url: '/api/user/receipts',
          cookies: { session: token },
        });
        expect(receiptsRes.statusCode).toBe(200);
        expect(receiptsRes.json().receipts).toHaveLength(1);

        const wPreview = await app.inject({
          method: 'POST',
          url: '/api/user/wallet/transfer/preview',
          cookies: { session: token },
          payload: { recipient: '@friend' },
        });
        expect(wPreview.statusCode).toBe(200);

        const wTransfer = await app.inject({
          method: 'POST',
          url: '/api/user/wallet/transfer',
          cookies: { session: token },
          payload: { toTelegramId: 77777, amount: 25_000, note: 'gift' },
        });
        expect(wTransfer.statusCode).toBe(200);
        expect(wTransfer.json()).toMatchObject({
          success: true,
          amount: 25_000,
          fromBalanceAfter: 50_000,
        });
      } finally {
        await app.close();
      }
    });
  });

  describe('Phase 4: Deep Links, Platform Smart Connect & SSR Smoke Render', () => {
    it('parses start_param and URL query deep links accurately', () => {
      expect(parseWebAppDeepLink('tab_wheel')).toEqual({ tab: 'referral', focusWheel: true });
      expect(parseWebAppDeepLink('tab_trial')).toEqual({ tab: 'dashboard', openTrial: true });
      expect(parseWebAppDeepLink('cfg_uc_42')).toEqual({ tab: 'services', configId: 'uc_42' });
      expect(parseWebAppDeepLink(undefined, '?tab=services&config=uc_99')).toEqual({
        tab: 'services',
        configId: 'uc_99',
      });
    });

    it('sorts recommended VPN client import links by Telegram platform (iOS vs Android)', () => {
      const iosLinks = buildClientConnectLinks('https://sub.example.com/abc', 'ios', 'srv1');
      expect(iosLinks[0]?.recommended).toBe(true);
      expect(iosLinks.filter((l) => l.recommended).map((l) => l.id)).toEqual(
        expect.arrayContaining(['happ', 'streisand', 'v2box'])
      );

      const androidLinks = buildClientConnectLinks(
        'https://sub.example.com/abc',
        'android',
        'srv1'
      );
      expect(androidLinks.filter((l) => l.recommended).map((l) => l.id)).toEqual(
        expect.arrayContaining(['happ', 'v2rayng'])
      );
    });

    it('renders all new Phase 1-4 UI components cleanly via SSR in both FA and EN', () => {
      const sampleConfig = {
        id: 'cfg_1',
        configUsername: 'u55555_srv1',
        subUrl: 'https://sub.example.com/token123',
        panelStatus: 'active',
        panelDataLimit: 50 * 1024 ** 3,
        panelUsedTraffic: 0,
        panelExpire: Math.floor(Date.now() / 1000) + 86400 * 10,
        autoRenewEnabled: false,
        createdAt: '2026-11-20T00:00:00Z',
      };

      for (const locale of ['fa', 'en'] as const) {
        const html = renderWithProviders(
          React.createElement(
            'div',
            null,
            React.createElement(LuckyWheelSection, { onNotify: () => undefined }),
            React.createElement(FreeTrialBanner, {
              trial: {
                enabled: true,
                eligible: true,
                hasUsedTrial: false,
                gb: 2,
                days: 3,
                requirePhone: false,
              },
              onNotify: () => undefined,
            }),
            React.createElement(FreeTrialResultModal, {
              result: {
                success: true,
                configUsername: 'trial_user_1',
                subUrl: 'https://sub.example.com/trial',
                gb: 2,
                days: 3,
              },
              onClose: () => undefined,
              onGoToServices: () => undefined,
              onNotify: () => undefined,
            }),
            React.createElement(SmartConnectButtons, {
              subUrl: 'https://sub.example.com/token123',
              configUsername: 'u55555_srv1',
            }),
            React.createElement(ClaimSubLinkModal, {
              isOpen: true,
              onClose: () => undefined,
              onNotify: () => undefined,
            }),
            React.createElement(ConfigTransferModal, {
              isOpen: true,
              config: sampleConfig,
              onClose: () => undefined,
              onTransferred: () => undefined,
              onNotify: () => undefined,
            }),
            React.createElement(ConfigDeleteRefundModal, {
              isOpen: true,
              config: sampleConfig,
              onClose: () => undefined,
              onDeleted: () => undefined,
              onNotify: () => undefined,
            }),
            React.createElement(WalletTransferModal, {
              isOpen: true,
              onClose: () => undefined,
              availableBalance: 250_000,
              minAmount: 5_000,
              onNotify: () => undefined,
            })
          ),
          locale
        );

        expect(html).toContain('trial_user_1');
        expect(html).toContain('u55555_srv1');
        expect(html).toContain('Happ');
      }
    });
  });
});
