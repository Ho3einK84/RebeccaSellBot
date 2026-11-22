import type { Bot } from 'grammy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerConfigRoutes } from '../../src/telegram/features/configRoutes.js';
import {
  buildRenewalSelectionKeyboard,
  buildSubscriptionActionKeyboard,
  registerSubscriptionRoutes,
  showUserSubscriptions,
} from '../../src/telegram/features/subscriptions/routes.js';
import {
  autoRenewCustomConversation,
  renewConfigConversation,
} from '../../src/telegram/conversations/userConversations.js';
import { resetActionCooldowns } from '../../src/telegram/middleware/actionCooldown.js';
import { packageCatalogToken } from '../../src/telegram/packageCatalog.js';
import type { ConversationContext, MenuContext, MyConversation } from '../../src/telegram/types.js';
import {
  createBotHarness,
  createMockServices,
  extractCallbackDataList,
} from './helpers/botHarness.js';

function context(): MenuContext {
  return {
    userLocale: 'en',
    services: {
      translationService: { get: vi.fn((key: string) => key) },
    },
  } as unknown as MenuContext;
}

afterEach(() => {
  resetActionCooldowns();
});

describe('Subscription cards and action hierarchy', () => {
  it('renders level 1 compact button and level 2 detail hierarchy with byte-safe callbacks', () => {
    const compactKb = buildSubscriptionActionKeyboard(context(), 'cfg_101', 'active', false, false);
    expect(compactKb.inline_keyboard.flat()).toHaveLength(1);
    expect(extractCallbackDataList(compactKb)).toEqual(['config:view:cfg_101']);

    const detailKb = buildSubscriptionActionKeyboard(
      context(),
      'uc_alice_123',
      'active',
      false,
      true
    );
    const callbacks = extractCallbackDataList(detailKb);
    expect(callbacks).toEqual(
      expect.arrayContaining([
        'renew:open:uc_alice_123',
        'config:qr:uc_alice_123',
        'config:refresh:uc_alice_123',
        'config:set:off:uc_alice_123',
        'config:revoke_prompt:uc_alice_123',
        'config:transfer:uc_alice_123',
        'config:delete_prompt:uc_alice_123',
        'autorenew:on:uc_alice_123',
      ])
    );
    expect(callbacks.every((data) => Buffer.byteLength(data, 'utf8') <= 64)).toBe(true);

    const disableKb = buildSubscriptionActionKeyboard(
      context(),
      'uc_alice_123',
      'active',
      true,
      true
    );
    expect(extractCallbackDataList(disableKb)).toContain('autorenew:off:uc_alice_123');
  });

  it('hides custom renewal when disabled and shows it by default', () => {
    const disabledCtx = {
      ...context(),
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          getSetting: vi.fn((key: string, fallback = '') =>
            key === 'custom_volume_enabled' ? 'false' : fallback
          ),
          getSettingNum: vi.fn(() => 5_000),
        },
        pricingService: {
          getPackages: vi.fn(() => [
            { id: 'basic', name: 'Basic', price: 100_000, gbAmount: 20, durationDays: 30 },
          ]),
        },
      },
    } as unknown as MenuContext;
    const disabledCbs = extractCallbackDataList(
      buildRenewalSelectionKeyboard(disabledCtx, 'uc_alice_123')
    );
    expect(disabledCbs).toContainEqual(expect.stringMatching(/^r:p:uc_alice_123:0:[0-9a-f]{10}$/u));
    expect(disabledCbs).not.toContain('renew:custom:uc_alice_123');

    const defaultCtx = {
      ...context(),
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          getSetting: vi.fn((_k: string, fallback = '') => fallback),
          getSettingNum: vi.fn(() => 5_000),
        },
        pricingService: { getPackages: vi.fn(() => []) },
      },
    } as unknown as MenuContext;
    expect(
      extractCallbackDataList(buildRenewalSelectionKeyboard(defaultCtx, 'uc_alice_123'))
    ).toContain('renew:custom:uc_alice_123');
  });

  it('renders paginated service list without progress bars and detail view with progress bars', async () => {
    const configs = [
      {
        id: 'uc_one_123',
        telegramId: 42,
        configUsername: 'config_one',
        subUrl: 'https://example.test/one',
        panelStatus: 'active',
        panelDataLimit: 10 * 1024 ** 3,
        panelExpire: Math.floor(Date.now() / 1000) + 86_400 * 10,
        createdAt: new Date(Date.now() - 86_400 * 5 * 1000),
      },
    ];
    const services = createMockServices({
      configService: {
        listConfigsForOwner: vi.fn().mockResolvedValue(configs),
        getOwnedConfigById: vi.fn().mockResolvedValue(configs[0]),
        getRemoteConfigDetail: vi.fn().mockResolvedValue({
          username: 'config_one',
          status: 'active',
          data_limit: 10 * 1024 ** 3,
          used_traffic: 5 * 1024 ** 3,
          expire: Math.floor(Date.now() / 1000) + 86_400 * 10,
          created_at: new Date(Date.now() - 86_400 * 5 * 1000).toISOString(),
        }),
      },
    });
    const listReply = vi.fn().mockResolvedValue({ message_id: 1 });
    await showUserSubscriptions({
      from: { id: 42 },
      userLocale: 'fa',
      reply: listReply,
      services,
    } as unknown as MenuContext);
    const listText = String(listReply.mock.calls[0]?.[0]);
    expect(listText).toContain('`config_one`');
    expect(listText).not.toContain('🟩');

    // Edit in place on callback
    const editMessageText = vi.fn().mockResolvedValue(true);
    await showUserSubscriptions({
      from: { id: 42 },
      userLocale: 'fa',
      callbackQuery: { message: { message_id: 1 } },
      editMessageText,
      reply: vi.fn(),
      services,
    } as unknown as MenuContext);
    expect(editMessageText).toHaveBeenCalledWith(
      expect.stringMatching(/`config_one`/),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );

    const harness = createBotHarness({ services });
    registerSubscriptionRoutes(harness.bot);
    await harness.sendCallback('config:view:uc_one_123', { userId: 42, messageId: 10 });
    const detailText = String(harness.callsFor('editMessageText').at(-1)?.payload.text);
    expect(detailText).toContain('subscription_detail_heading');
    expect(detailText).toContain('🟩');
    expect(detailText).toContain('🟪');
  });

  it('requires auto-renew confirmation, rejects stale package fingerprints, routes underfunded renewals, and debounces toggles', async () => {
    const setAutoRenew = vi.fn().mockResolvedValue(true);
    const disableConfig = vi.fn().mockRejectedValue(new Error('origin unavailable'));
    const pkg = { id: 'pkg_30gb', name: '30 GB', price: 100_000, gbAmount: 30, durationDays: 30 };
    const token = packageCatalogToken([pkg]);

    const services = createMockServices({
      configService: {
        getOwnedConfigById: vi.fn().mockResolvedValue({
          id: 'uc_alice_123',
          telegramId: 42,
          configUsername: 'alice',
          panelId: 'main',
          serviceId: 1,
          subUrl: 'https://example.com/sub/alice',
        }),
        getRemoteConfigDetail: vi
          .fn()
          .mockResolvedValue({ subscription_url: 'https://example.com/sub/alice' }),
        setAutoRenew,
        disableConfig,
      },
      pricingService: { getPackages: vi.fn(() => [pkg]) },
      walletService: {
        getBalance: vi.fn().mockResolvedValue(99_999),
        getAvailableBalance: vi.fn().mockResolvedValue(99_999),
      },
      purchaseCheckoutService: { create: vi.fn() },
    });

    const harness = createBotHarness({ services });
    registerSubscriptionRoutes(harness.bot);

    // 1. Auto-renew prompt + confirm
    await harness.sendCallback('autorenew:on:uc_alice_123', { userId: 42 });
    expect(setAutoRenew).not.toHaveBeenCalled();

    await harness.sendCallback(`ar:p:uc_alice_123:0:${token}`, { userId: 42 });
    expect(setAutoRenew).not.toHaveBeenCalled();
    expect(harness.getSession(42)?.pendingAutoRenew).toMatchObject({
      configId: 'uc_alice_123',
      packageId: 'pkg_30gb',
      price: 100_000,
    });

    await harness.sendCallback('autorenew:confirm:uc_alice_123', { userId: 42 });
    expect(setAutoRenew).toHaveBeenCalledWith(42, 'uc_alice_123', true, 'pkg_30gb', 100_000);

    // 2. Stale fingerprint rejected
    harness.clearCalls();
    await harness.sendCallback('r:p:uc_alice_123:0:0000000000', { userId: 42 });
    expect(harness.services.purchaseCheckoutService.create).not.toHaveBeenCalled();
    expect(harness.callsFor('answerCallbackQuery')[0]?.payload).toMatchObject({
      text: 'renewal_package_missing',
      show_alert: true,
    });

    // 3. Underfunded renewal offers direct topup and stores pendingTopupIntent deficit
    harness.clearCalls();
    await harness.sendCallback(`r:p:uc_alice_123:0:${token}`, { userId: 42 });
    const rendered = harness.callsFor('editMessageText').at(-1)?.payload;
    expect(extractCallbackDataList(rendered?.reply_markup)).toContain('topup:direct');
    expect(harness.getSession(42)?.pendingTopupIntent).toMatchObject({
      kind: 'renew_config',
      configId: 'uc_alice_123',
      deficitAmount: 1,
    });

    // 3b. Active catalog discount applies to renewal checkout and renew:confirm shows config:view button
    const discountedCreate = vi.fn().mockResolvedValue({
      id: 'co_renew_disc_1',
      telegramId: 42,
      kind: 'renew_config',
      configId: 'uc_alice_123',
      packageId: 'pkg_30gb',
      packageName: '30 GB',
      panelId: 'main',
      serviceId: 1,
      amount: 80_000,
      quotedAmount: 80_000,
      gbAmount: 30,
      durationDays: 30,
      promoCode: null,
    });
    const discountedClaim = vi.fn().mockResolvedValue({
      id: 'co_renew_disc_1',
      telegramId: 42,
      kind: 'renew_config',
      configId: 'uc_alice_123',
      packageId: 'pkg_30gb',
      packageName: '30 GB',
      panelId: 'main',
      serviceId: 1,
      amount: 80_000,
      quotedAmount: 80_000,
      gbAmount: 30,
      durationDays: 30,
      promoCode: null,
    });
    const discountedSaga = vi.fn().mockResolvedValue({
      success: true,
      configUsername: 'alice',
    });
    const discServices = createMockServices({
      configService: {
        getOwnedConfigById: vi.fn().mockResolvedValue({
          id: 'uc_alice_123',
          telegramId: 42,
          configUsername: 'alice',
          panelId: 'main',
          serviceId: 1,
          panelStatus: 'active',
          panelDataLimit: 20 * 1024 ** 3,
          panelUsedTraffic: 5 * 1024 ** 3,
          panelExpire: Math.floor(Date.now() / 1000) + 10 * 86_400,
        }),
      },
      pricingService: { getPackages: vi.fn(() => [pkg]) },
      catalogDiscountService: {
        listActiveDiscounts: vi.fn().mockResolvedValue([
          {
            id: 'disc_1',
            title: 'Flash 20%',
            scope: 'all',
            targetId: null,
            discountType: 'percent',
            value: 20,
            maxDiscountAmount: null,
            startsAt: new Date(Date.now() - 60_000),
            expiresAt: new Date(Date.now() + 3_600_000),
            active: true,
          },
        ]),
      },
      walletService: {
        getAvailableBalance: vi.fn().mockResolvedValue(99_999),
        getBalance: vi.fn().mockResolvedValue(99_999),
        executePurchaseSaga: discountedSaga,
      },
      purchaseCheckoutService: {
        create: discountedCreate,
        claim: discountedClaim,
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      },
    });
    const discHarness = createBotHarness({ services: discServices });
    registerSubscriptionRoutes(discHarness.bot);

    await discHarness.sendCallback(`r:p:uc_alice_123:0:${token}`, { userId: 42, messageId: 88 });
    expect(discountedCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'renew_config',
        quotedAmount: 80_000,
      })
    );
    const reviewPayload = discHarness.callsFor('editMessageText').at(-1)?.payload;
    expect(String(reviewPayload?.text)).toContain('checkout_catalog_discount_label');
    expect(String(reviewPayload?.text)).toContain('renewal_rollover_preview_gb');

    await discHarness.sendCallback('renew:confirm:co_renew_disc_1', { userId: 42, messageId: 88 });
    expect(discountedSaga).toHaveBeenCalledOnce();
    const donePayload = discHarness.callsFor('editMessageText').at(-1)?.payload;
    expect(String(donePayload?.text)).toContain('renewal_success_title');
    expect(extractCallbackDataList(donePayload?.reply_markup)).toContain(
      'config:view:uc_alice_123'
    );

    // 4. Cooldown deduplicates rapid config disable
    await harness.sendCallback('config:set:off:uc_alice_123', { userId: 42 });
    await harness.sendCallback('config:set:off:uc_alice_123', { userId: 42 });
    expect(disableConfig).toHaveBeenCalledOnce();

    // 5. QR popover marks photo as artifact without demoting prior message
    harness.clearCalls();
    await harness.sendCallback('config:qr:uc_alice_123', { userId: 42, messageId: 50 });
    expect(harness.callsFor('sendPhoto')).toHaveLength(1);
    expect(harness.getSession(42)?.artifactMessageIds).not.toContain(50);
    expect(harness.getSession(42)?.artifactMessageIds?.length).toBe(1);
  });
});

describe('Config routes: 64-byte confirm fallback & refund guards', () => {
  it('uses compact delete_confirm callback when configUsername exceeds 64B and preserves refund check', async () => {
    const longUsername = 'user_' + 'x'.repeat(58);
    const deleteConfigCompletely = vi.fn().mockResolvedValue(true);
    const quote = vi.fn().mockResolvedValue({ eligible: false, refundAmount: 0 });
    const services = createMockServices({
      configService: {
        getOwnedConfigByUsername: vi.fn().mockResolvedValue({
          id: 'cfg_long_1',
          telegramId: 42,
          configUsername: longUsername,
          panelId: 'p1',
        }),
        deleteConfigCompletely,
      },
      refundService: { quote },
    });

    const harness = createBotHarness({ services });
    registerConfigRoutes(harness.bot as unknown as Bot<MenuContext>, harness.services);

    await harness.sendCallback(`config_delete:${longUsername}`, { userId: 42 });
    const confirmCbs = extractCallbackDataList(
      harness.callsFor('editMessageText').at(-1)?.payload.reply_markup
    );
    expect(confirmCbs).toContain('config:delete_confirm:cfg_long_1');
    expect(confirmCbs.every((c) => Buffer.byteLength(c, 'utf8') <= 64)).toBe(true);

    // Refund-eligible guard prevents legacy confirm from bypassing refund screen
    quote.mockResolvedValueOnce({
      eligible: true,
      grossAmount: 50_000,
      cashbackWithheld: 0,
      refundAmount: 30_000,
    });
    harness.clearCalls();
    await harness.sendCallback(`config_delete_confirm:${longUsername}`, { userId: 42 });
    expect(deleteConfigCompletely).not.toHaveBeenCalled();
    expect(
      extractCallbackDataList(harness.callsFor('editMessageText').at(-1)?.payload.reply_markup)
    ).toContain('config:refund_confirm:cfg_long_1');
  });
});

describe('Admin renewal and auto-renew target charging', () => {
  it('renews and sets auto-renew targeting config owner wallet instead of admin', async () => {
    const adminId = 999_999;
    const ownerId = 123_456;
    const config = {
      id: 'cfg_target_user',
      telegramId: ownerId,
      configUsername: 'user_config_1',
      panelId: 'rp_1',
      serviceId: 1,
    };
    const getConfigById = vi.fn().mockResolvedValue(config);
    const getOwnedConfigById = vi.fn().mockResolvedValue(null);
    const getBalance = vi.fn().mockResolvedValue(100_000);
    const createCheckout = vi.fn().mockResolvedValue({
      id: 'co_test_1',
      telegramId: ownerId,
      amount: 25_000,
      quotedAmount: 25_000,
    });
    const claimCheckout = vi.fn().mockResolvedValue({
      id: 'co_test_1',
      telegramId: ownerId,
      amount: 25_000,
      quotedAmount: 25_000,
    });
    const executePurchaseSaga = vi.fn().mockResolvedValue({
      configUsername: 'user_config_1',
      subUrl: 'https://test/sub',
    });
    const setAutoRenew = vi.fn().mockResolvedValue(undefined);

    const services = createMockServices({
      adminIds: [adminId],
      isAdmin: vi.fn((id: number) => id === adminId),
      configService: { getConfigById, getOwnedConfigById, setAutoRenew },
      pricingService: {
        getCustomPriceQuote: vi.fn(() => ({ totalPrice: 25_000, pricePerGb: 5_000 })),
      },
      walletService: { getBalance, getAvailableBalance: getBalance, executePurchaseSaga },
      purchaseCheckoutService: { create: createCheckout, claim: claimCheckout },
    });

    let renewWait = 0;
    const renewConv = {
      external: vi.fn(async (fn: (c: unknown) => unknown) =>
        fn({ from: { id: adminId }, session: { renewConfigId: 'cfg_target_user' }, services })
      ),
      wait: vi.fn(async () => {
        renewWait += 1;
        return renewWait === 1
          ? ({
              from: { id: adminId },
              message: { text: '5' },
              reply: vi.fn(),
              deleteMessage: vi.fn(),
            } as never)
          : ({
              from: { id: adminId },
              callbackQuery: { data: 'renew_confirm' },
              answerCallbackQuery: vi.fn().mockResolvedValue(true),
              reply: vi.fn(),
            } as never);
      }),
    } as unknown as MyConversation;

    await renewConfigConversation(renewConv, {
      from: { id: adminId },
      chat: { id: 1111 },
      services,
      userLocale: 'fa',
      api: { editMessageText: vi.fn().mockResolvedValue({}) },
      reply: vi.fn().mockResolvedValue({ message_id: 123 }),
    } as unknown as ConversationContext);

    expect(getConfigById).toHaveBeenCalledWith('cfg_target_user');
    expect(getOwnedConfigById).not.toHaveBeenCalled();
    expect(getBalance).toHaveBeenCalledWith(ownerId);
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ telegramId: ownerId, configId: 'cfg_target_user' })
    );
    expect(executePurchaseSaga).toHaveBeenCalledWith(
      expect.objectContaining({ telegramId: ownerId, allowAdminOverride: true })
    );

    let autoWait = 0;
    const autoConv = {
      external: vi.fn(async (fn: (c: unknown) => unknown) =>
        fn({ from: { id: adminId }, session: { pendingConfigId: 'cfg_target_user' }, services })
      ),
      wait: vi.fn(async () => {
        autoWait += 1;
        return autoWait === 1
          ? ({
              from: { id: adminId },
              message: { text: '10' },
              reply: vi.fn(),
              deleteMessage: vi.fn(),
            } as never)
          : ({
              from: { id: adminId },
              callbackQuery: { data: 'autorenew:custom_confirm' },
              answerCallbackQuery: vi.fn().mockResolvedValue(true),
              reply: vi.fn(),
            } as never);
      }),
    } as unknown as MyConversation;

    await autoRenewCustomConversation(autoConv, {
      from: { id: adminId },
      chat: { id: 1111 },
      services,
      userLocale: 'fa',
      reply: vi.fn().mockResolvedValue({ message_id: 123 }),
    } as unknown as ConversationContext);

    expect(setAutoRenew).toHaveBeenCalledWith(
      ownerId,
      'cfg_target_user',
      true,
      'custom_10gb_30d',
      25_000
    );
  });
});
