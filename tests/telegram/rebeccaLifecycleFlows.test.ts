import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import {
  buildRenewalCheckoutScreen,
  registerSubscriptionRoutes,
} from '../../src/telegram/features/subscriptions/routes.js';
import { registerPurchaseRoutes } from '../../src/telegram/features/purchaseRoutes.js';
import {
  buyPackageCustomNameConversation,
  promptCustomServiceName,
} from '../../src/telegram/conversations/userConversations.js';
import { manageNamingSettings } from '../../src/telegram/conversations/adminConversations/settings/naming.js';
import { managePackagePolicies } from '../../src/telegram/conversations/adminConversations/settings/packageManager.js';
import { resetActionCooldowns } from '../../src/telegram/middleware/actionCooldown.js';
import type {
  ConversationContext,
  MenuContext,
  MyConversation,
  SessionData,
} from '../../src/telegram/types.js';
import {
  createBotHarness,
  createMockServices,
  extractCallbackDataList,
} from './helpers/botHarness.js';

vi.mock('../../src/infra/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

afterEach(() => {
  resetActionCooldowns();
});

describe('Rebecca Lifecycle Telegram UI & Flows (on_hold, rollover, custom name, admin toggles)', () => {
  it('renders waiting-for-first-connection text on Telegram subscription card when status is on_hold', async () => {
    const realTs = new TranslationService();
    const config = {
      id: 'uc_hold_1',
      telegramId: 42,
      panelId: 'main',
      serviceId: 1,
      configUsername: 'shop_hold_1',
      subUrl: 'https://sub.example.test/shop_hold_1',
      panelStatus: 'on_hold',
      panelDataLimit: 20 * 1024 ** 3,
      panelUsedTraffic: 0,
      panelExpire: null,
      panelOnHoldExpireDuration: 30 * 86_400,
      autoRenewEnabled: false,
      createdAt: new Date('2026-11-20T00:00:00Z'),
    };
    const services = createMockServices({
      translationService: {
        get: vi.fn((key: string, locale?: string, params?: Record<string, string | number>) =>
          realTs.get(key, locale, params)
        ),
        resolveLocale: vi.fn((loc?: string | null) => realTs.resolveLocale(loc)),
      },
      configService: {
        getOwnedConfigById: vi.fn().mockResolvedValue(config),
        getRemoteConfigDetail: vi.fn().mockResolvedValue({
          username: 'shop_hold_1',
          status: 'on_hold',
          data_limit: 20 * 1024 ** 3,
          used_traffic: 0,
          expire: null,
          on_hold_expire_duration: 30 * 86_400,
          created_at: '2026-11-20T00:00:00Z',
          subscription_url: 'https://sub.example.test/shop_hold_1',
        }),
      },
    });

    const harness = createBotHarness({ services, defaultLocale: 'fa' });
    registerSubscriptionRoutes(harness.bot);
    await harness.sendCallback('config:view:uc_hold_1', { userId: 42, messageId: 10 });

    const detailText = String(harness.callsFor('editMessageText').at(-1)?.payload.text);
    expect(detailText).toContain('در انتظار اولین اتصال (۳۰ روز)');
    expect(detailText).not.toContain('🟪');
  });

  it('displays rollover notice in buildRenewalCheckoutScreen when enabled and omits it when disabled', () => {
    const realTs = new TranslationService();
    const ctx = {
      userLocale: 'fa',
      services: {
        translationService: realTs,
      },
    } as unknown as MenuContext;

    const withRollover = buildRenewalCheckoutScreen(ctx, {
      username: 'shop_u1',
      gbAmount: 20,
      durationDays: 30,
      amount: 100_000,
      pricePerGb: 5_000,
      rolloverEnabled: true,
    });
    expect(withRollover).toContain('انتقال مانده');
    expect(withRollover).toContain('به دورهٔ جدید منتقل می‌شود');

    const withoutRollover = buildRenewalCheckoutScreen(ctx, {
      username: 'shop_u1',
      gbAmount: 20,
      durationDays: 30,
      amount: 100_000,
      pricePerGb: 5_000,
      rolloverEnabled: false,
    });
    expect(withoutRollover).not.toContain('انتقال مانده');
  });

  it('prompts custom service name (with validation retry and random fallback) and resolves it on purchase confirm', async () => {
    const reply = vi.fn().mockResolvedValue({ message_id: 10 });
    const services = createMockServices({
      pricingService: {
        getPackageById: vi.fn(() => ({
          id: 'pkg_20',
          name: '20 GB',
          gbAmount: 20,
          durationDays: 30,
          price: 100_000,
          startOnFirstUse: true,
        })),
      },
      walletService: {
        getAvailableBalance: vi.fn().mockResolvedValue(200_000),
      },
      purchaseCheckoutService: {
        create: vi.fn().mockResolvedValue({
          id: 'co_custom_pkg1',
          requestedUsername: 'ali_home',
        }),
      },
    });
    const session: SessionData = { pendingCustomNamePurchase: { packageId: 'pkg_20' } };
    const ctx = {
      from: { id: 42 },
      userLocale: 'fa',
      reply,
      services,
      session,
    } as unknown as ConversationContext;

    const inputs = [
      { from: { id: 42 }, message: { text: '1invalid!' }, deleteMessage: vi.fn(), reply, services },
      { from: { id: 42 }, message: { text: 'Ali_Home' }, deleteMessage: vi.fn(), reply, services },
    ];
    const conversation = {
      external: vi.fn(async (fn: (c: unknown) => unknown) => fn(ctx)),
      wait: vi.fn(async () => inputs.shift()),
    } as unknown as MyConversation;

    await buyPackageCustomNameConversation(conversation, ctx);

    expect(services.purchaseCheckoutService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: 42,
        requestedUsername: 'ali_home',
      })
    );
    const reviewReply = reply.mock.calls.at(-1);
    expect(String(reviewReply?.[0])).toContain('ali_home');
    expect(extractCallbackDataList(reviewReply?.[1]?.reply_markup)).toContain(
      'buy:confirm:co_custom_pkg1'
    );

    // Random name button path
    const randomConv = {
      external: vi.fn(async (fn: (c: unknown) => unknown) => fn(ctx)),
      wait: vi.fn().mockResolvedValueOnce({
        from: { id: 42 },
        callbackQuery: { data: 'custom_name:random' },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        services,
      }),
    } as unknown as MyConversation;
    await expect(promptCustomServiceName(randomConv, ctx)).resolves.toEqual({ kind: 'random' });

    // Confirm route calls resolveCustomConfigName and forwards package startOnFirstUse
    const resolveCustomConfigName = vi.fn().mockResolvedValue('shop_ali_home');
    const generateConfigName = vi.fn().mockResolvedValue('shop_999');
    const executePurchaseSaga = vi.fn().mockResolvedValue({
      success: true,
      configUsername: 'shop_ali_home',
      subUrl: 'https://sub.example.test/shop_ali_home',
    });
    const confirmServices = createMockServices({
      pricingService: {
        getPackageById: vi.fn(() => ({
          id: 'pkg_20',
          name: '20 GB',
          gbAmount: 20,
          durationDays: 30,
          price: 100_000,
          startOnFirstUse: true,
        })),
      },
      purchaseCheckoutService: {
        claim: vi.fn().mockResolvedValue({
          id: 'co_custom_pkg1',
          telegramId: 42,
          kind: 'new_config',
          packageId: 'pkg_20',
          packageName: '20 GB',
          panelId: 'main',
          serviceId: 1,
          amount: 100_000,
          quotedAmount: 100_000,
          gbAmount: 20,
          durationDays: 30,
          promoCode: null,
          requestedUsername: 'ali_home',
        }),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      },
      walletService: {
        getAvailableBalance: vi.fn().mockResolvedValue(200_000),
        executePurchaseSaga,
      },
      configService: { resolveCustomConfigName, generateConfigName },
    });
    const confirmHarness = createBotHarness({ services: confirmServices, defaultLocale: 'en' });
    registerPurchaseRoutes(confirmHarness.bot, confirmHarness.services);
    await confirmHarness.sendCallback('buy:confirm:co_custom_pkg1', { userId: 42, messageId: 50 });

    expect(resolveCustomConfigName).toHaveBeenCalledWith('ali_home', 'main');
    expect(generateConfigName).not.toHaveBeenCalled();
    expect(executePurchaseSaga).toHaveBeenCalledWith(
      expect.objectContaining({
        configUsername: 'shop_ali_home',
        startOnFirstUse: true,
      })
    );
  });

  it('toggles custom_service_name_enabled in naming settings and on_hold/rollover in package policies', async () => {
    const settings = new Map<string, string>([
      ['naming_prefix', 'shop'],
      ['custom_service_name_enabled', 'false'],
      ['on_hold_default_enabled', 'false'],
      ['renewal_rollover_enabled', 'true'],
    ]);
    const updateSetting = vi.fn(async (key: string, value: string) => {
      settings.set(key, value);
    });
    const syncCounters = vi.fn();
    const reply = vi.fn().mockResolvedValue({ message_id: 20 });
    const services = createMockServices({
      adminIds: [42],
      isAdmin: vi.fn(() => true),
      configService: { syncCounters },
      translationService: {
        getSetting: vi.fn((key: string, fallback = '') => settings.get(key) ?? fallback),
        getSettingBool: vi.fn((key: string, fallback = false) => {
          const v = settings.get(key);
          return v === undefined ? fallback : v === 'true';
        }),
        getSettingNum: vi.fn((_k: string, fallback = 0) => fallback),
        updateSetting,
      },
    });
    const ctx = {
      from: { id: 42 },
      userLocale: 'en',
      reply,
      services,
      session: {},
    } as unknown as ConversationContext;

    const namingCallbacks = ['naming:toggle_custom_name', 'naming:back'];
    const namingConv = {
      external: vi.fn(async (fn: (c: unknown) => unknown) => fn(ctx)),
      wait: vi.fn(async () => ({
        ...ctx,
        callbackQuery: { data: namingCallbacks.shift(), message: { message_id: 20 } },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      })),
    } as unknown as MyConversation;

    await manageNamingSettings(namingConv, ctx);
    expect(settings.get('custom_service_name_enabled')).toBe('true');
    expect(syncCounters).not.toHaveBeenCalled();

    const policyCallbacks = ['pp:toggle:on_hold', 'pp:toggle:rollover', 'pp:back'];
    const policyConv = {
      external: vi.fn(async (fn: (c: unknown) => unknown) => fn(ctx)),
      wait: vi.fn(async () => ({
        ...ctx,
        callbackQuery: { data: policyCallbacks.shift(), message: { message_id: 20 } },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      })),
    } as unknown as MyConversation;

    await managePackagePolicies(policyConv, ctx);
    expect(settings.get('on_hold_default_enabled')).toBe('true');
    expect(settings.get('renewal_rollover_enabled')).toBe('false');
  });
});
