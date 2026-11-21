import type { Bot } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { registerBaseRoutes } from '../../src/telegram/features/baseRoutes.js';
import { registerCoreRoutes } from '../../src/telegram/features/coreRoutes.js';
import { renderHomeDashboard as renderStandaloneHomeDashboard } from '../../src/telegram/keyboards/homeDashboard.js';
import {
  renderHomeDashboard,
  renderShopMenuText,
  renderWalletDashboard,
  renderWalletStatementScreen,
  resolveSupportInfo,
} from '../../src/telegram/keyboards/mainMenu.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import { validateTelegramMarkdown } from '../../src/telegram/rendering.js';
import { localizedNumber } from '../../src/telegram/locale.js';
import type { BotServices, MenuContext } from '../../src/telegram/types.js';
import { createBotHarness, createMockServices } from './helpers/botHarness.js';

describe('Home & wallet dashboards', () => {
  it('renders state-aware home dashboard with wallet balance, active services, and near-expiry alerts', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const getBalance = vi.fn().mockResolvedValue(50_000);
    const listConfigsForOwner = vi.fn().mockResolvedValue([
      { id: 'cfg1', configUsername: 'alice', panelStatus: 'active', panelExpire: null },
      { id: 'cfg2', configUsername: 'bob', panelStatus: 'active', panelExpire: null },
    ]);

    const ctx = {
      from: { id: 123, language_code: 'fa' },
      userLocale: 'fa',
      services: {
        walletService: { getBalance },
        configService: { listConfigsForOwner },
        translationService: {
          get: vi.fn((key: string, _locale?: string, params?: Record<string, string>) => {
            if (key === 'home_near_expiry_detail') {
              return `${params?.username} · ${params?.days} ${params?.days_unit}`;
            }
            const map: Record<string, string> = {
              home_title: 'خانه',
              home_subtitle: 'کیف پول و سرویس‌ها',
              home_balance: 'موجودی کیف پول',
              currency_toman: 'تومان',
              home_service_overview: 'سرویس‌ها',
              home_active_services: 'سرویس فعال',
              service_unit: 'سرویس',
              ui_status_active: 'فعال',
            };
            return map[key] ?? key;
          }),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const mainDashboard = await renderHomeDashboard(ctx);
    const standaloneDashboard = await renderStandaloneHomeDashboard(ctx);
    expect(mainDashboard).toContain(localizedNumber(50_000, ctx));
    expect(mainDashboard).toContain(localizedNumber(2, ctx));
    expect(standaloneDashboard).toContain('۵۰٬۰۰۰ تومان');

    // Highlights nearest expiry service within 3 days
    const nearestCtx = {
      from: { id: 888 },
      userLocale: 'en',
      services: {
        walletService: { getBalance: vi.fn().mockResolvedValue(1000) },
        configService: {
          listConfigsForOwner: vi.fn().mockResolvedValue([
            { configUsername: 'later', panelStatus: 'active', panelExpire: nowSec + 3 * 86400 },
            { configUsername: 'sooner', panelStatus: 'active', panelExpire: nowSec + 86400 },
          ]),
        },
        translationService: {
          get: vi.fn((key: string, _locale?: string, params?: Record<string, string>) =>
            key === 'home_near_expiry_detail' ? `${params?.username}:${params?.days}` : key
          ),
          resolveLocale: vi.fn(() => 'en'),
        },
      },
    } as unknown as MenuContext;

    const nearestText = await renderHomeDashboard(nearestCtx);
    expect(nearestText).toContain('sooner');
    expect(nearestText).not.toContain('later');
  });

  it('warns about expired services and panel-unavailable state rather than showing zero active', async () => {
    const expiredCtx = {
      from: { id: 123456 },
      services: {
        walletService: { getBalance: vi.fn().mockResolvedValue(0) },
        configService: {
          listConfigsForOwner: vi.fn().mockResolvedValue([
            {
              id: 'cfg1',
              configUsername: 'u_123',
              panelStatus: 'expired',
              panelExpire: Math.floor(Date.now() / 1000) - 86400,
            },
          ]),
        },
        translationService: {
          get: vi.fn((key: string) =>
            key === 'home_has_expired_services_hint' ? 'سرویس‌های شما منقضی شده‌اند.' : key
          ),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    expect(await renderStandaloneHomeDashboard(expiredCtx)).toContain(
      'سرویس‌های شما منقضی شده‌اند.'
    );

    const unavailableCtx = {
      from: { id: 777 },
      userLocale: 'en',
      services: {
        walletService: { getBalance: vi.fn().mockResolvedValue(1000) },
        configService: { listConfigsForOwner: vi.fn().mockRejectedValue(new Error('panel down')) },
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'en'),
        },
      },
    } as unknown as MenuContext;

    const unavailableText = await renderHomeDashboard(unavailableCtx);
    expect(unavailableText).toContain('home_services_unavailable_hint');
    expect(unavailableText).not.toContain('home_no_active_services_hint');
  });

  it('renders wallet dashboard (with/without pending receipt) and transaction statements', async () => {
    const withReceiptCtx = {
      from: { id: 789, language_code: 'fa' },
      userLocale: 'fa',
      services: {
        walletService: {
          getBalance: vi.fn().mockResolvedValue(150_000),
          getPendingReceiptForUser: vi.fn().mockResolvedValue({
            id: 'rcp_101',
            amount: 100_000,
            createdAt: new Date('2026-08-01T12:00:00Z'),
          }),
        },
        translationService: { get: vi.fn((key: string) => key), resolveLocale: vi.fn(() => 'fa') },
      },
    } as unknown as MenuContext;

    const walletWithReceipt = await renderWalletDashboard(withReceiptCtx);
    expect(walletWithReceipt).toContain(localizedNumber(150_000, withReceiptCtx));
    expect(walletWithReceipt).toContain(localizedNumber(100_000, withReceiptCtx));
    expect(walletWithReceipt).toContain('`789`');

    const emptyWalletCtx = {
      ...withReceiptCtx,
      services: {
        ...withReceiptCtx.services,
        walletService: {
          getBalance: vi.fn().mockResolvedValue(50_000),
          getPendingReceiptForUser: vi.fn().mockResolvedValue(null),
        },
      },
    } as unknown as MenuContext;
    const cleanWallet = await renderWalletDashboard(emptyWalletCtx);
    expect(cleanWallet).toContain(localizedNumber(50_000, emptyWalletCtx));
    expect(cleanWallet).not.toContain('rcp_');

    // Wallet statement empty & populated
    const replyEmpty = vi.fn().mockResolvedValue({ message_id: 100 });
    await renderWalletStatementScreen(
      {
        from: { id: 12345 },
        editMessageText: vi.fn(),
        reply: replyEmpty,
        services: {
          walletService: {
            listTransactionsForUser: vi
              .fn()
              .mockResolvedValue({ transactions: [], total: 0, totalPages: 1, page: 1 }),
          },
          translationService: {
            get: vi.fn((k: string) =>
              k === 'wallet_history_empty' ? 'هیچ تراکنشی ثبت نشده است.' : k
            ),
            resolveLocale: vi.fn(() => 'fa'),
          },
        },
      } as unknown as MenuContext,
      1
    );
    expect(replyEmpty.mock.calls[0]?.[0]).toContain('هیچ تراکنشی ثبت نشده است.');

    const replyTx = vi.fn().mockResolvedValue({ message_id: 101 });
    await renderWalletStatementScreen(
      {
        from: { id: 12345 },
        editMessageText: vi.fn(),
        reply: replyTx,
        services: {
          walletService: {
            listTransactionsForUser: vi.fn().mockResolvedValue({
              transactions: [
                {
                  id: 'tx_1',
                  telegramId: 12345,
                  amount: 50_000,
                  balanceAfter: 100_000,
                  type: 'topup',
                  description: 'Topup receipt',
                  createdAt: new Date('2026-08-28T12:00:00Z'),
                },
                {
                  id: 'tx_2',
                  telegramId: 12345,
                  amount: -30_000,
                  balanceAfter: 70_000,
                  type: 'purchase',
                  description: 'Subscription purchase',
                  createdAt: new Date('2026-08-29T12:00:00Z'),
                },
                {
                  id: 'tx_3',
                  telegramId: 12345,
                  amount: 0,
                  balanceAfter: 0,
                  type: 'trial',
                  description: 'Free trial',
                  createdAt: new Date('2026-08-27T12:00:00Z'),
                },
              ],
              total: 3,
              totalPages: 1,
              page: 1,
            }),
          },
          translationService: {
            get: vi.fn(
              (key: string) =>
                ({
                  wallet_history_title: 'سوابق تراکنش‌ها',
                  wallet_dashboard_subtitle: 'موجودی، شارژ حساب و گردش مالی',
                  wallet_pending_amount: 'مبلغ',
                  wallet_transfer_balance_after_label: 'ماندهٔ کیف پول',
                  tx_type_topup: 'افزایش موجودی',
                  tx_type_purchase: 'خرید اشتراک',
                  tx_type_trial: 'تست رایگان',
                  currency_toman: 'تومان',
                })[key] ?? key
            ),
            resolveLocale: vi.fn(() => 'fa'),
          },
        },
      } as unknown as MenuContext,
      1
    );
    const renderedTxText = String(replyTx.mock.calls[0]?.[0] ?? '');
    expect(renderedTxText).toContain('افزایش موجودی');
    expect(renderedTxText).toContain('۵۰٬۰۰۰ تومان');
    expect(renderedTxText).toContain('خرید اشتراک');
    expect(renderedTxText).toContain('🎁 *تست رایگان');
    // Every non-empty line in Persian statement screen (including negative amount lines with inline LRM) must start with RLM
    for (const line of renderedTxText.split('\n').filter(Boolean)) {
      expect(line.startsWith('\u200f')).toBe(true);
    }
  });

  it('resolves configured support destination or falls back dynamically to admin ID', () => {
    const configured = resolveSupportInfo({
      services: {
        translationService: { getSetting: vi.fn(() => '@my_support') },
        adminService: { adminIds: [99999] },
      },
    } as unknown as MenuContext);
    expect(configured).toMatchObject({
      isConfigured: true,
      url: 'https://t.me/my_support',
      rawValue: '@my_support',
    });

    const fallback = resolveSupportInfo({
      services: {
        translationService: { getSetting: vi.fn(() => '') },
        adminService: { adminIds: [888888] },
      },
    } as unknown as MenuContext);
    expect(fallback).toMatchObject({
      isConfigured: true,
      url: 'tg://user?id=888888',
      rawValue: '888888',
    });

    const none = resolveSupportInfo({
      services: {
        translationService: { getSetting: vi.fn(() => '') },
        adminService: { adminIds: [] },
      },
    } as unknown as MenuContext);
    expect(none.isConfigured).toBe(false);
  });
});

describe('/start onboarding, deep links & core route fallbacks', () => {
  it('uses admin default_locale and prompts for language on first visit', async () => {
    let startHandler: ((ctx: unknown) => Promise<void>) | undefined;
    const bot = {
      use: vi.fn(),
      command: vi.fn((cmd: string, handler: (ctx: unknown) => Promise<void>) => {
        if (cmd === 'start') startHandler = handler;
      }),
      callbackQuery: vi.fn(),
    } as unknown as Bot<MenuContext>;

    const getOrCreateUser = vi.fn().mockResolvedValue({
      id: 1,
      telegramId: 12345,
      locale: 'fa',
      localeManual: false,
    });
    const services = {
      userService: { exists: vi.fn().mockResolvedValue(false) },
      walletService: { getOrCreateUser },
      translationService: {
        getDefaultLocale: vi.fn(() => 'fa'),
        getSettingBool: vi.fn((key: string) => key === 'language_selection_enabled'),
        get: vi.fn((key: string) => `translated:${key}`),
        resolveLocale: vi.fn(() => 'fa'),
      },
      isAdmin: vi.fn(() => false),
    } as unknown as BotServices;

    registerBaseRoutes(bot, services);
    const reply = vi.fn().mockResolvedValue({ message_id: 10 });
    const ctx = {
      from: { id: 12345, first_name: 'NewUser', language_code: 'en' },
      chat: { id: 12345, type: 'private' },
      services,
      reply,
      userLocale: undefined,
    };

    await startHandler!(ctx);

    expect(getOrCreateUser).toHaveBeenCalledWith(
      12345,
      null,
      'NewUser',
      null,
      undefined,
      'fa',
      'telegram_start'
    );
    expect(ctx.userLocale).toBe('fa');
    expect(reply).toHaveBeenCalledWith(
      'translated:onboarding_welcome',
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({ callback_data: 'locale:fa' }),
              expect.objectContaining({ callback_data: 'locale:en' }),
            ]),
          ]),
        }),
      })
    );
  });

  it('handles renew_, transfer_, delete_, custom, and receipt deep links with ownership enforcement', async () => {
    let startHandler: ((ctx: unknown) => Promise<void>) | undefined;
    const bot = {
      use: vi.fn(),
      command: vi.fn((cmd: string, handler: (ctx: unknown) => Promise<void>) => {
        if (cmd === 'start') startHandler = handler;
      }),
      callbackQuery: vi.fn(),
    } as unknown as Bot<MenuContext>;

    const services = createMockServices({
      configService: {
        getOwnedConfigById: vi.fn(async (telegramId: number, configId: string) =>
          telegramId === 12345 && configId === 'cfg_test_1'
            ? {
                id: 'cfg_test_1',
                telegramId: 12345,
                configUsername: 'u12345_srv1',
                panelId: 'panel_1',
                serviceId: 1,
              }
            : undefined
        ),
      },
      pricingService: {
        getPackages: vi.fn(() => [
          { id: 'pkg_1', name: 'Plan 1', gbAmount: 10, durationDays: 30, price: 50_000 },
        ]),
      },
      refundService: {
        quote: vi.fn().mockResolvedValue({
          eligible: true,
          grossAmount: 50_000,
          cashbackWithheld: 0,
          refundAmount: 35_000,
        }),
      },
    });
    registerBaseRoutes(bot, services);

    const mkCtx = (match: string, extra: Record<string, unknown> = {}) => ({
      from: { id: 12345, first_name: 'TestUser' },
      chat: { id: 12345, type: 'private' },
      match,
      services,
      reply: vi.fn().mockResolvedValue({ message_id: 101 }),
      editMessageText: vi.fn().mockResolvedValue(true),
      session: {},
      conversation: { enter: vi.fn().mockResolvedValue(undefined) },
      ...extra,
    });

    const renewOk = mkCtx('renew_cfg_test_1');
    await startHandler!(renewOk);
    expect(services.configService.getOwnedConfigById).toHaveBeenCalledWith(12345, 'cfg_test_1');
    expect(renewOk.reply).toHaveBeenCalled();

    const renewBad = mkCtx('renew_cfg_other');
    await startHandler!(renewBad);
    expect(renewBad.reply).toHaveBeenCalled();

    const transferOk = mkCtx('transfer_cfg_test_1');
    await startHandler!(transferOk);
    expect(transferOk.session.transferConfigId).toBe('cfg_test_1');
    expect(transferOk.conversation.enter).toHaveBeenCalledWith('transferConfigConversation');

    const transferBad = mkCtx('transfer_cfg_other');
    await startHandler!(transferBad);
    expect(transferBad.conversation.enter).not.toHaveBeenCalled();

    const deleteOk = mkCtx('delete_cfg_test_1');
    await startHandler!(deleteOk);
    expect(services.refundService.quote).toHaveBeenCalledWith(12345, 'cfg_test_1');
    expect(deleteOk.reply).toHaveBeenCalled();

    const customCtx = mkCtx('custom');
    await startHandler!(customCtx);
    expect(customCtx.conversation.enter).toHaveBeenCalledWith('customAmountConversation');

    const receiptCtx = mkCtx('receipt');
    await startHandler!(receiptCtx);
    expect(receiptCtx.conversation.enter).toHaveBeenCalledWith('topupConversation');
  });

  it('handles unmatched text and expired callback buttons safely through coreRoutes', async () => {
    const harness = createBotHarness();
    registerCoreRoutes(harness.bot, harness.services);

    await harness.sendText('random unhandled message', { userId: 42 });
    const textReply = harness.callsFor('sendMessage')[0]?.payload;
    expect(String(textReply?.text)).toContain('home_title');
    expect(String(textReply?.text)).toContain('unexpected_text_hint');

    harness.clearCalls();
    await harness.sendCallback('obsolete:button:from:v1', { userId: 42 });
    const answer = harness.callsFor('answerCallbackQuery')[0]?.payload;
    expect(answer?.text).toBe('button_expired');
    expect(answer?.show_alert).toBe(true);
  });

  it('renders shop overview cleanly with categories, custom volume, promo badge, and valid Markdown', async () => {
    const ts = new TranslationService();
    const packages = [
      { id: 'p1', name: 'Plan 1', gbAmount: 20, durationDays: 30, price: 50_000, categoryId: 'c1' },
      {
        id: 'p2',
        name: 'Plan 2',
        gbAmount: 50,
        durationDays: 30,
        price: 100_000,
        categoryId: 'c1',
      },
    ];
    const categories = [
      {
        id: 'c1',
        name: 'Europe_DE*',
        icon: '🇩🇪',
        description: 'Fast_[Route]',
        displayOrder: 0,
        enabled: true,
      },
    ];

    const ctx = {
      from: { id: 99, language_code: 'fa' },
      userLocale: 'fa',
      session: {
        pendingPromo: {
          code: 'OFF20',
          type: 'discount_percent',
          value: 20,
        },
      },
      services: {
        ...createMockServices({
          pricingService: {
            getPackages: vi.fn((_p?: string, _s?: number, _inc?: boolean, catId?: string | null) =>
              catId === 'c1' ? packages : catId === null ? [] : packages
            ),
          },
          packageCategoryService: {
            listCategories: vi.fn(async () => categories),
            getCategoryById: vi.fn(
              async (id: string) => categories.find((c) => c.id === id) ?? null
            ),
          },
        }),
        translationService: ts as unknown as BotServices['translationService'],
      },
    } as unknown as MenuContext;

    vi.spyOn(ts, 'getSettingBool').mockImplementation((k: string, fb = false) =>
      k === 'custom_volume_enabled' ? true : fb
    );
    vi.spyOn(ts, 'getSettingNum').mockImplementation((k: string, fb = 0) =>
      k === 'price_per_gb' ? 4500 : fb
    );

    const rootShop = await renderShopMenuText(ctx);
    expect(validateTelegramMarkdown(rootShop).valid).toBe(true);
    expect(rootShop).toContain('OFF20');
    expect(rootShop).toContain('۴٬۵۰۰');
    expect(rootShop).toContain('۲ بسته در ۱ دسته‌بندی');

    ctx.session.activeShopCategory = 'c1';
    const catShop = await renderShopMenuText(ctx);
    expect(validateTelegramMarkdown(catShop).valid).toBe(true);
    expect(catShop).toContain('Europe\\_DE\\*');
    expect(catShop).toContain('Fast\\_\\[Route]');
  });
});
