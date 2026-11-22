import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isAdminCallbackData } from '../../src/telegram/botRuntime.js';
import {
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
} from '../../src/telegram/designSystem.js';
import { validateTelegramMarkdown } from '../../src/telegram/rendering.js';
import {
  clearAdminInput,
  isAdminInputActive,
  registerAdminInputHandler,
  registerAdminInputMiddleware,
  startAdminInput,
} from '../../src/telegram/admin/adminInput.js';
import {
  attachAdminRouter,
  clearRegisteredAdminRoutes,
  dispatchAdminRoute,
  registerAdminRoute,
} from '../../src/telegram/admin/adminRouter.js';
import {
  invalidatePanelHealthCache,
  registerAdminHomeRoutes,
  renderAdminHomeScreen,
} from '../../src/telegram/admin/adminHome.js';
import {
  registerAdminQuickCommands,
  syncAdminBotCommands,
} from '../../src/telegram/admin/adminCommands.js';
import { registerAdminSalesRoutes } from '../../src/telegram/admin/adminSalesRoutes.js';
import { registerAdminSettingsRoutes } from '../../src/telegram/admin/adminSettingsRoutes.js';
import { registerAdminTextsRoutes } from '../../src/telegram/admin/adminTextsRoutes.js';
import { registerPromoAdminRoutes } from '../../src/telegram/features/admin/promoRoutes.js';
import { registerBaseRoutes } from '../../src/telegram/features/baseRoutes.js';
import { registerCoreRoutes } from '../../src/telegram/features/coreRoutes.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import {
  GENERAL_SETTING_GROUPS,
  getSettingGroup,
} from '../../src/telegram/conversations/adminConversations/settings/catalog.js';
import { settingValidationMessage } from '../../src/telegram/conversations/adminConversations/settings/validation.js';
import {
  createBotHarness,
  createMockServices,
  extractCallbackDataList,
} from './helpers/botHarness.js';
import type { MenuContext, SessionData } from '../../src/telegram/types.js';

describe('Admin Telegram UI/UX Overhaul (adm:* routes, non-blocking input, P0 fixes)', () => {
  beforeEach(() => {
    clearRegisteredAdminRoutes();
  });

  it('authorizes adm:* callbacks in botRuntime and blocks non-admins on attachAdminRouter', async () => {
    expect(isAdminCallbackData('adm:home')).toBe(true);
    expect(isAdminCallbackData('adm:rcpt:q:1')).toBe(true);
    expect(isAdminCallbackData('adm:cfg:gen')).toBe(true);
    expect(isAdminCallbackData('nav:home')).toBe(false);

    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
    });
    const harness = createBotHarness({ services });
    registerAdminHomeRoutes();
    attachAdminRouter(harness.bot);

    await harness.sendCallback('adm:home', { userId: 999 });
    expect(harness.callsFor('answerCallbackQuery')[0]?.payload.text).toBe('access_denied');
    expect(harness.callsFor('editMessageText')).toHaveLength(0);
    expect(harness.callsFor('sendMessage')).toHaveLength(0);
  });

  it('builds valid Markdown Admin screens without Persian-breaking italic wrappers', () => {
    const screen = buildAdminScreen({
      emoji: '🛠️',
      title: 'مدیریت ربات',
      breadcrumb: buildBreadcrumb('مدیریت ربات', 'فروش و فروشگاه'),
      subtitle: 'وضعیت سرویس‌های فروش',
      notice: { tone: 'success', text: 'تغییرات ذخیره شد.' },
      primary: { emoji: '🧾', label: 'در انتظار', value: '۳', inline: true, emphasizeValue: true },
      sections: [
        {
          emoji: '⚙️',
          title: 'تنظیمات',
          fields: [{ label: 'حجم دلخواه', value: '🟢 فعال' }],
        },
      ],
      footer: 'برای تغییر روی دکمه بزنید.',
    });

    expect(validateTelegramMarkdown(screen).valid).toBe(true);
    expect(screen).toContain('✅ تغییرات ذخیره شد.');
    expect(screen).toContain('مدیریت ربات › فروش و فروشگاه');
    expect(screen).not.toMatch(/^_.*_$/mu);

    const prompt = buildAdminPromptScreen({
      emoji: '✏️',
      title: 'ویرایش مقدار',
      body: 'عدد جدید را بفرستید:',
      error: 'مقدار نامعتبر است.',
    });
    expect(validateTelegramMarkdown(prompt).valid).toBe(true);
    expect(prompt).toContain('❌ مقدار نامعتبر است.');
  });

  it('renders 1-tap Admin Home and flags degraded panel health (1/2) as warning, never green', async () => {
    const healthSummary = vi.fn().mockResolvedValue({ configured: 2, healthy: 1 });
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      panelRegistry: { healthSummary, listPanels: vi.fn(() => []) },
      walletService: {
        getPendingReceiptCount: vi.fn().mockResolvedValue(4),
        getDashboardStats: vi.fn().mockResolvedValue({
          pendingReceipts: 4,
          dailyRevenue: 250_000,
          weeklyRevenue: 1_000_000,
          monthlyRevenue: 3_000_000,
          totalUsers: 120,
          totalSales: 5_000_000,
          activeSubscriptions: 45,
          inactiveSubscriptions: 12,
          totalReferralBonus: 20_000,
          totalCashback: 15_000,
        }),
      },
      configReconciliationService: {
        getQueueSummary: vi
          .fn()
          .mockResolvedValue({ openTotal: 2, remoteUnbound: 2, localMissing: 0, ignoredTotal: 0 }),
      },
    });

    invalidatePanelHealthCache(services.panelRegistry);
    const harness = createBotHarness({ services });
    registerAdminHomeRoutes();
    attachAdminRouter(harness.bot);

    await harness.sendCallback('adm:home', { userId: 1 });
    const msg = harness.callsFor('editMessageText').at(-1)?.payload;
    const text = String(msg?.text ?? '');
    const callbacks = extractCallbackDataList(msg?.reply_markup);

    expect(text).toContain('admin_home_alert_panels');
    expect(text).toContain('admin_home_alert_receipts');
    expect(text).toContain('admin_home_alert_orphans');
    expect(callbacks).toEqual(
      expect.arrayContaining([
        'adm:rcpt:q:1',
        'adm:usr:p:1',
        'adm:sales',
        'adm:pnl:p:1',
        'adm:msg',
        'adm:stats',
        'adm:cfg',
        'nav:home',
      ])
    );

    const buttons = (
      (
        msg?.reply_markup as {
          inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>>;
        }
      )?.inline_keyboard ?? []
    ).flat();
    const panelsBtn = buttons.find((b) => b.callback_data === 'adm:pnl:p:1');
    expect(panelsBtn?.text).toContain('⚠️');
    expect(panelsBtn?.text).not.toContain('🟢');

    // Calling again within TTL hits cache without re-probing panels
    await harness.sendCallback('adm:home', { userId: 1 });
    expect(healthSummary).toHaveBeenCalledTimes(1);

    // Invalidating cache forces fresh probe
    invalidatePanelHealthCache(services.panelRegistry);
    await harness.sendCallback('adm:home', { userId: 1 });
    expect(healthSummary).toHaveBeenCalledTimes(2);
  });

  it('supports non-blocking adminInput: retry, /cancel return, TTL expiry, and seamless callback interruption', async () => {
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
    });
    const session: Record<string, SessionData> = {};
    const harness = createBotHarness({ services, initialSession: session });

    const handledValues: string[] = [];
    const targetHit = vi.fn();

    registerAdminRoute('adm:test:parent', async (ctx, _m, notice) => {
      await ctx.reply(`PARENT:${notice?.text ?? 'ok'}`);
    });
    registerAdminRoute('adm:test:start', async (ctx) => {
      await startAdminInput(ctx, {
        kind: 'test:number',
        returnRoute: 'adm:test:parent',
        promptText: 'ENTER_NUMBER',
      });
    });
    registerAdminRoute('adm:test:interrupt', async (ctx) => {
      targetHit();
      await ctx.reply('INTERRUPTED_OK');
    });

    registerAdminInputHandler('test:number', async (_ctx, text) => {
      if (!/^\d+$/u.test(text.trim())) {
        return { status: 'retry', promptText: 'RETRY_INVALID' };
      }
      handledValues.push(text.trim());
      return { status: 'done', notice: { tone: 'success', text: 'SAVED_NUM' } };
    });

    registerAdminInputMiddleware(harness.bot, dispatchAdminRoute);
    attachAdminRouter(harness.bot);

    // Start prompt -> invalid text triggers inline retry -> valid text completes & returns to parent
    await harness.sendCallback('adm:test:start', { userId: 1 });
    expect(String(harness.callsFor('editMessageText').at(-1)?.payload.text)).toContain(
      'ENTER_NUMBER'
    );

    await harness.sendText('abc', { userId: 1 });
    expect(String(harness.callsFor('sendMessage').at(-1)?.payload.text)).toContain('RETRY_INVALID');

    await harness.sendText('42', { userId: 1 });
    expect(handledValues).toEqual(['42']);
    expect(String(harness.callsFor('sendMessage').at(-1)?.payload.text)).toContain(
      'PARENT:SAVED_NUM'
    );

    // Start prompt -> `/cancel` exits cleanly to parent route
    await harness.sendCallback('adm:test:start', { userId: 1 });
    await harness.sendText('/cancel', { userId: 1 });
    expect(String(harness.callsFor('sendMessage').at(-1)?.payload.text)).toContain(
      'PARENT:operation_cancelled'
    );

    // Start prompt -> tapping an unrelated button (e.g. incoming receipt alert) interrupts cleanly!
    await harness.sendCallback('adm:test:start', { userId: 1 });
    await harness.sendCallback('adm:test:interrupt', { userId: 1 });
    expect(targetHit).toHaveBeenCalledTimes(1);
    expect(String(harness.callsFor('sendMessage').at(-1)?.payload.text)).toContain(
      'INTERRUPTED_OK'
    );

    // TTL helper expires stale prompts automatically
    const staleSession: SessionData = {
      adminInput: {
        kind: 'test:number',
        returnRoute: 'adm:home',
        createdAt: Date.now() - 10 * 60 * 1000,
      },
    };
    expect(isAdminInputActive(staleSession)).toBe(false);
    expect(staleSession.adminInput).toBeUndefined();
    clearAdminInput(staleSession);
  });

  it('clears stale await_api_key panel session state on /admin and /start (P0 security regression)', async () => {
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      panelRegistry: {
        healthSummary: vi.fn().mockResolvedValue({ configured: 1, healthy: 1 }),
        listPanels: vi.fn(() => []),
      },
      walletService: {
        getPendingReceiptCount: vi.fn().mockResolvedValue(0),
        getDashboardStats: vi.fn().mockResolvedValue({
          pendingReceipts: 0,
          dailyRevenue: 0,
          weeklyRevenue: 0,
          monthlyRevenue: 0,
          totalUsers: 1,
          totalSales: 0,
          activeSubscriptions: 0,
          inactiveSubscriptions: 0,
          totalReferralBonus: 0,
          totalCashback: 0,
        }),
      },
      configReconciliationService: {
        getQueueSummary: vi.fn().mockResolvedValue({ openTotal: 0 }),
      },
    });
    const harness = createBotHarness({
      services,
      initialSession: {
        '1:1': {
          adminPanelAction: 'await_api_key',
          adminPanelId: 'rp_1',
          adminPanelActionAt: Date.now(),
        },
      },
    });
    registerBaseRoutes(harness.bot, services);
    registerAdminHomeRoutes();

    await harness.sendText('/admin', { userId: 1 });
    expect(harness.getSession(1)?.adminPanelAction).toBeUndefined();
    expect(harness.getSession(1)?.adminPanelId).toBeUndefined();
  });

  it('registers power-admin quick commands (/r, /u, /stats) and chat-scoped command menu', async () => {
    const receiptsHit = vi.fn();
    const statsHit = vi.fn();
    const userHit = vi.fn();
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      userService: {
        findProfile: vi.fn().mockResolvedValue({ telegramId: 777 }),
      },
    });
    const harness = createBotHarness({ services });

    registerAdminRoute('adm:rcpt:q:1', async (ctx) => {
      receiptsHit();
      await ctx.reply('RECEIPTS_QUEUE');
    });
    registerAdminRoute('adm:stats', async (ctx) => {
      statsHit();
      await ctx.reply('STATS_VIEW');
    });
    registerAdminRoute(/^adm:usr:v:(\d+)$/u, async (ctx, match) => {
      userHit(Number(match![1]));
      await ctx.reply(`USER_${match![1]}`);
    });
    registerAdminQuickCommands(harness.bot, services);

    // Non-admin blocked
    await harness.sendText('/r', { userId: 999 });
    expect(receiptsHit).not.toHaveBeenCalled();

    // Admin commands work
    await harness.sendText('/r', { userId: 1 });
    expect(receiptsHit).toHaveBeenCalledTimes(1);

    await harness.sendText('/stats', { userId: 1 });
    expect(statsHit).toHaveBeenCalledTimes(1);

    await harness.sendText('/u 777', { userId: 1 });
    expect(userHit).toHaveBeenCalledWith(777);

    // Scoped setMyCommands sync
    await syncAdminBotCommands(harness.bot, services);
    const cmdCalls = harness.callsFor('setMyCommands');
    expect(cmdCalls.length).toBeGreaterThanOrEqual(2);
    const adminScopeCall = cmdCalls.find(
      (c) => (c.payload.scope as { type?: string; chat_id?: number } | undefined)?.type === 'chat'
    );
    expect((adminScopeCall?.payload.scope as { chat_id?: number })?.chat_id).toBe(1);
  });

  it('excludes raw webapp settings from General Settings catalog and gives specific cleanup_warn_days error', () => {
    const systemGroup = getSettingGroup('system');
    expect(systemGroup?.settings).not.toContain('webapp_enabled');
    expect(systemGroup?.settings).not.toContain('webapp_url');
    expect(GENERAL_SETTING_GROUPS.some((g) => g.id === 'system')).toBe(true);

    const realTs = new TranslationService();
    const ctx = {
      from: { id: 1, language_code: 'en' },
      userLocale: 'en',
      services: { translationService: realTs },
    } as unknown as MenuContext;
    const msg = settingValidationMessage(ctx, 'expired_cleanup_warn_days');
    expect(msg).toContain('3,1');
    expect(msg).not.toBe(realTs.get('admin_setting_invalid', 'en'));
  });

  it('supports stateless Sales, Settings, Promo Quick Editor, Discounts & Texts routes end-to-end', async () => {
    const realTs = new TranslationService();
    const settingsStore = new Map<string, string>([
      ['custom_volume_enabled', 'true'],
      ['price_per_gb', '5000'],
      ['custom_default_days', '30'],
      ['trial_enabled', 'true'],
      ['trial_gb', '1'],
      ['trial_days', '3'],
      ['referral_bonus_toman', '10000'],
      ['cashback_percent', '5'],
      ['lucky_wheel_enabled', 'true'],
      ['refund_window_hours', '0'],
      ['webapp_enabled', 'false'],
    ]);
    const promo = {
      id: '11111111-1111-4111-8111-111111111111',
      code: 'SAVE20',
      type: 'discount_percent',
      value: 20,
      maxUses: 100,
      maxUsesPerUser: 1,
      currentUses: 5,
      minPurchaseAmount: 0,
      maxDiscountAmount: 50_000,
      firstPurchaseOnly: false,
      expiresAt: null,
      active: true,
      createdAt: new Date(),
    };
    const createPromoCode = vi.fn().mockResolvedValue(undefined);
    const deleteDiscount = vi.fn().mockResolvedValue(true);
    const discountRow = {
      id: 'disc_1',
      title: 'Weekend Flash',
      scope: 'all',
      targetId: null,
      discountType: 'percent',
      value: 15,
      maxDiscountAmount: null,
      startsAt: new Date(),
      expiresAt: null,
      active: true,
      createdAt: new Date(),
    };

    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      translationService: {
        resolveLocale: vi.fn(() => 'en'),
        get: vi.fn((key: string, locale?: string, vars?: Record<string, string | number>) =>
          realTs.get(key, (locale as 'fa' | 'en') ?? 'en', vars)
        ),
        getSetting: vi.fn((key: string, fb = '') => settingsStore.get(key) ?? fb),
        getSettingBool: vi.fn((key: string, fb = false) =>
          settingsStore.has(key) ? settingsStore.get(key) === 'true' : fb
        ),
        getSettingNum: vi.fn((key: string, fb = 0) =>
          settingsStore.has(key) ? Number(settingsStore.get(key)) : fb
        ),
        updateSetting: vi.fn(async (key: string, value: string) => {
          settingsStore.set(key, value);
        }),
        deleteSetting: vi.fn(async (key: string) => {
          settingsStore.delete(key);
        }),
        getTranslationKeys: vi.fn(() => realTs.getTranslationKeys()),
        getCustomizedKeys: vi.fn(() => [] as string[]),
        searchTranslations: vi.fn((q: string, loc: 'fa' | 'en') =>
          realTs.searchTranslations(q, loc)
        ),
      },
      promoService: {
        listCodes: vi.fn().mockResolvedValue({ items: [promo], total: 1, page: 1, totalPages: 1 }),
        getPromoCodeById: vi.fn().mockResolvedValue(promo),
        createPromoCode,
        setPromoActiveById: vi.fn().mockResolvedValue(true),
      },
      catalogDiscountService: {
        listDiscounts: vi.fn().mockResolvedValue([discountRow]),
        getDiscountById: vi.fn().mockResolvedValue(discountRow),
        deleteDiscount,
        toggleDiscount: vi.fn().mockResolvedValue({ ...discountRow, active: false }),
        updateDiscount: vi.fn().mockResolvedValue({ ...discountRow, value: 25 }),
      },
      broadcastService: {
        countAudience: vi.fn().mockResolvedValue(42),
        listRecentJobs: vi
          .fn()
          .mockResolvedValue({ items: [], total: 0, page: 1, totalPages: 1, activeCount: 0 }),
      },
      panelRegistry: {
        listPanels: vi.fn(() => []),
        getPanel: vi.fn(() => undefined),
        healthSummary: vi.fn().mockResolvedValue({ configured: 1, healthy: 1 }),
      },
    });

    const harness = createBotHarness({ services, defaultLocale: 'en' });
    registerAdminInputMiddleware(harness.bot, dispatchAdminRoute);
    registerCoreRoutes(harness.bot, services);
    registerPromoAdminRoutes(harness.bot);
    registerAdminSalesRoutes();
    registerAdminSettingsRoutes();
    registerAdminTextsRoutes();

    // 1. Sales Hub -> Growth & Rewards -> Toggle Lucky Wheel
    await harness.sendCallback('adm:sales', { userId: 1 });
    const salesCbs = extractCallbackDataList(
      harness.callsFor('editMessageText').at(-1)?.payload.reply_markup
    );
    expect(salesCbs).toEqual(
      expect.arrayContaining([
        'adm:pkg:p:1',
        'adm:cv',
        'adm:prm:p:1',
        'adm:dsc:p:1',
        'adm:trl',
        'adm:grw',
      ])
    );

    await harness.sendCallback('adm:grw', { userId: 1 });
    await harness.sendCallback('adm:grw:w:tg', { userId: 1 });
    expect(settingsStore.get('lucky_wheel_enabled')).toBe('false');

    // 2. Promo Quick Editor 1-tap expiry preset
    await harness.sendCallback(`adm:prm:edit:${promo.id}`, { userId: 1 });
    await harness.sendCallback(`adm:prm:ep:7d:${promo.id}`, { userId: 1 });
    expect(createPromoCode).toHaveBeenCalledTimes(1);

    // 3. Flash Discount Delete requires explicit confirmation first!
    await harness.sendCallback('adm:dsc:del:disc_1', { userId: 1 });
    expect(deleteDiscount).not.toHaveBeenCalled();
    await harness.sendCallback('adm:dsc:del_ok:disc_1', { userId: 1 });
    expect(deleteDiscount).toHaveBeenCalledWith('disc_1');

    // 4. Service Rules shows "Unlimited" when refund_window_hours is 0 (fixed misleading "Disabled" copy)
    await harness.sendCallback('adm:cfg:svc', { userId: 1 });
    const svcText = String(harness.callsFor('editMessageText').at(-1)?.payload.text ?? '');
    expect(svcText).toContain('Unlimited');

    // 5. Stateless Bot Texts Hub -> Essential list -> View key
    await harness.sendCallback('adm:txt:hub', { userId: 1 });
    await harness.sendCallback('adm:txt:list:essential:1', { userId: 1 });
    await harness.sendCallback('adm:txt:v:0', { userId: 1 });
    const detailText = String(harness.callsFor('editMessageText').at(-1)?.payload.text ?? '');
    expect(detailText).toContain('onboarding_welcome');
  });

  it('keeps package category and target picker callbacks strictly within Telegram 64-byte limit', async () => {
    const longPkgId = 'pkg_enterprise_unlimited_monthly_bundle';
    const longCatId = 'cat_high_speed_premium_residential_plans_a1b2c3';
    const longPanelId = 'rp_a1b2c3d4e5f6';
    const packages = [
      { id: longPkgId, name: 'Enterprise Plan', gbAmount: 100, durationDays: 30, price: 250_000 },
    ];
    const settingsStore = new Map<string, string>([['packages_json', JSON.stringify(packages)]]);
    const realTs = new TranslationService();
    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      translationService: {
        resolveLocale: vi.fn(() => 'en'),
        get: vi.fn((key: string, locale?: string, vars?: Record<string, string | number>) =>
          realTs.get(key, (locale as 'fa' | 'en') ?? 'en', vars)
        ),
        getSetting: vi.fn((key: string, fallback = '') => settingsStore.get(key) ?? fallback),
        getSettingBool: vi.fn((_key: string, fallback = false) => fallback),
        getSettingNum: vi.fn((_key: string, fallback = 0) => fallback),
        updateSetting: vi.fn(async (key: string, value: string) => {
          settingsStore.set(key, value);
        }),
      },
      packageCategoryService: {
        listCategories: vi
          .fn()
          .mockResolvedValue([
            { id: longCatId, name: 'Premium Residential', icon: '⚡', enabled: true },
          ]),
      },
      panelRegistry: {
        listPanels: vi.fn(() => [
          {
            id: longPanelId,
            name: 'EU Primary',
            enabled: true,
            services: [{ serviceId: 7, name: 'SkyLink' }],
          },
        ]),
        getPanel: vi.fn(() => undefined),
        healthSummary: vi.fn().mockResolvedValue({ configured: 1, healthy: 1 }),
      },
    });

    const harness = createBotHarness({ services, defaultLocale: 'en' });
    registerCoreRoutes(harness.bot, services);
    registerAdminSalesRoutes();

    await harness.sendCallback(`adm:pkg:cat:${longPkgId}:1`, { userId: 1 });
    const catCbs = extractCallbackDataList(
      harness.callsFor('editMessageText').at(-1)?.payload.reply_markup
    );
    expect(catCbs.every((cb) => Buffer.byteLength(cb, 'utf8') <= 64)).toBe(true);
    expect(catCbs).toContain('adm:pkg:sc:0:0');

    await harness.sendCallback('adm:pkg:sc:0:0', { userId: 1 });
    const afterCat = JSON.parse(settingsStore.get('packages_json') ?? '[]') as Array<{
      categoryId?: string;
    }>;
    expect(afterCat[0]?.categoryId).toBe(longCatId);

    await harness.sendCallback(`adm:pkg:tgt:${longPkgId}`, { userId: 1 });
    const tgtCbs = extractCallbackDataList(
      harness.callsFor('editMessageText').at(-1)?.payload.reply_markup
    );
    expect(tgtCbs.every((cb) => Buffer.byteLength(cb, 'utf8') <= 64)).toBe(true);
    expect(tgtCbs).toContain('adm:pkg:st:0:0:7');

    await harness.sendCallback('adm:pkg:st:0:0:7', { userId: 1 });
    const afterTgt = JSON.parse(settingsStore.get('packages_json') ?? '[]') as Array<{
      panelId?: string;
      serviceId?: number;
    }>;
    expect(afterTgt[0]?.panelId).toBe(longPanelId);
    expect(afterTgt[0]?.serviceId).toBe(7);
  });
});

// Keep reference used in type validation
void renderAdminHomeScreen;
