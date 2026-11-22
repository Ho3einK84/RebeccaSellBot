import { InlineKeyboard } from 'grammy';
import {
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  type AdminScreenNotice,
} from '../designSystem.js';
import { localizedNumber, t } from '../locale.js';
import type { MenuContext } from '../types.js';
import { renderScreen } from '../ui.js';
import { appendAdminFooterNav, markAdminContext, resetAdminNav } from './adminNav.js';
import { registerAdminRoute } from './adminRouter.js';

const PANEL_HEALTH_CACHE_TTL_MS = 60_000;
const PANEL_HEALTH_FAST_TIMEOUT_MS = 1_500;
const PANEL_HEALTH_STATS_TIMEOUT_MS = 4_000;

interface CachedPanelHealth {
  configured: number;
  healthy: number;
  allHealthy: boolean;
  latencyMs: number;
  checkedAt: number;
}

const healthCacheByRegistry = new WeakMap<object, CachedPanelHealth>();

/** Invalidate cached panel health (call after panel mutations or manual connection tests). */
export function invalidatePanelHealthCache(registry?: object): void {
  if (registry) {
    healthCacheByRegistry.delete(registry);
  }
}

async function measurePanelHealth(
  ctx: MenuContext,
  timeoutMs: number,
  useCache: boolean
): Promise<CachedPanelHealth | null> {
  const registry = ctx.services?.panelRegistry;
  if (!registry || typeof registry.healthSummary !== 'function') return null;

  if (useCache) {
    const cached = healthCacheByRegistry.get(registry);
    if (cached && Date.now() - cached.checkedAt < PANEL_HEALTH_CACHE_TTL_MS) {
      return cached;
    }
  }

  const startedAt = performance.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      registry.healthSummary(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('HEALTH_CHECK_TIMEOUT')), timeoutMs);
      }),
    ]);
    const entry: CachedPanelHealth = {
      configured: result.configured,
      healthy: result.healthy,
      allHealthy: result.configured > 0 && result.healthy === result.configured,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkedAt: Date.now(),
    };
    healthCacheByRegistry.set(registry, entry);
    return entry;
  } catch {
    return {
      configured: 0,
      healthy: 0,
      allHealthy: false,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkedAt: Date.now(),
    };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function buildAdminHomeKeyboard(
  ctx: MenuContext,
  counts: { pendingReceipts: number; openOrphans?: number; panelHealth: CachedPanelHealth | null }
): InlineKeyboard {
  const receiptsBase = t(ctx, 'admin_nav_receipts');
  const receiptsLabel =
    counts.pendingReceipts > 0
      ? `${receiptsBase} (${localizedNumber(counts.pendingReceipts, ctx)})`
      : receiptsBase;

  const panelsBase = t(ctx, 'admin_nav_panels');
  let panelsLabel = panelsBase;
  if (counts.panelHealth && counts.panelHealth.configured > 0) {
    const healthIcon = counts.panelHealth.allHealthy ? '🟢' : '⚠️';
    panelsLabel = `${panelsBase} (${healthIcon})`;
  }

  const kb = new InlineKeyboard()
    .text(receiptsLabel, 'adm:rcpt:q:1')
    .text(t(ctx, 'admin_menu_users'), 'adm:usr:p:1')
    .row()
    .text(t(ctx, 'admin_group_sales'), 'adm:sales')
    .text(panelsLabel, 'adm:pnl:p:1')
    .row()
    .text(t(ctx, 'admin_nav_messaging'), 'adm:msg')
    .text(t(ctx, 'admin_menu_stats'), 'adm:stats')
    .row()
    .text(t(ctx, 'admin_menu_settings'), 'adm:cfg');

  if (ctx.services?.webAppUrl) {
    kb.webApp(t(ctx, 'admin_nav_webapp_short'), ctx.services.webAppUrl);
  }
  kb.row().text(t(ctx, 'menu_back_main'), 'nav:home');
  return kb;
}

/** Render the sleek, 1-tap Command Center Admin Home screen (stateless). */
export async function renderAdminHomeScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  markAdminContext(ctx);
  resetAdminNav(ctx.session);

  let dailyRevenue: number | undefined;
  let activeSubscriptions: number | undefined;

  const [pendingRes, panelHealth, statsRes] = await Promise.all([
    ctx.services?.walletService?.getPendingReceiptCount?.().catch(() => 0) ?? Promise.resolve(0),
    measurePanelHealth(ctx, PANEL_HEALTH_FAST_TIMEOUT_MS, true),
    ctx.services?.walletService?.getDashboardStats?.().catch(() => null) ?? Promise.resolve(null),
  ]);

  let pendingReceipts = pendingRes ?? 0;
  if (statsRes) {
    dailyRevenue = statsRes.dailyRevenue;
    activeSubscriptions = statsRes.activeSubscriptions;
    if (pendingReceipts === 0 && statsRes.pendingReceipts > 0) {
      pendingReceipts = statsRes.pendingReceipts;
    }
  }

  const alerts: string[] = [];
  if (pendingReceipts > 0) {
    alerts.push(
      t(ctx, 'admin_home_alert_receipts', { count: localizedNumber(pendingReceipts, ctx) })
    );
  }
  if (panelHealth && panelHealth.configured > 0 && !panelHealth.allHealthy) {
    alerts.push(
      t(ctx, 'admin_home_alert_panels', {
        healthy: localizedNumber(panelHealth.healthy, ctx),
        total: localizedNumber(panelHealth.configured, ctx),
      })
    );
  }

  const pulseFields = [
    ...(dailyRevenue !== undefined
      ? [
          {
            label: t(ctx, 'admin_stats_today_label'),
            value: `${localizedNumber(dailyRevenue, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ]
      : []),
    ...(activeSubscriptions !== undefined
      ? [
          {
            label: t(ctx, 'admin_stats_active_label'),
            value: localizedNumber(activeSubscriptions, ctx),
          },
        ]
      : []),
    {
      label: t(ctx, 'admin_home_status_label'),
      value: alerts.length > 0 ? alerts.join(' · ') : t(ctx, 'admin_home_status_healthy'),
    },
  ];

  const text = buildAdminScreen({
    emoji: '🛠️',
    title: t(ctx, 'admin_home_title'),
    subtitle: t(ctx, 'admin_home_subtitle'),
    notice,
    sections: [{ fields: pulseFields }],
  });

  await renderScreen(ctx, text, {
    parse_mode: 'Markdown',
    reply_markup: buildAdminHomeKeyboard(ctx, {
      pendingReceipts,
      panelHealth,
    }),
  });
}

/** Render live dashboard statistics & infrastructure health screen. */
export async function renderAdminStatsScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);

  const dbStartedAt = performance.now();
  const [statsData, panelHealth] = await Promise.all([
    ctx.services.walletService.getDashboardStats().then((stats) => ({
      stats,
      latency: Math.max(0, Math.round(performance.now() - dbStartedAt)),
    })),
    measurePanelHealth(ctx, PANEL_HEALTH_STATS_TIMEOUT_MS, false),
  ]);

  const { stats, latency: dbLatency } = statsData;
  const panelHealthy = Boolean(panelHealth?.allHealthy);
  const panelLatency = panelHealth?.latencyMs ?? 0;

  const text = buildAdminScreen({
    emoji: '📊',
    title: t(ctx, 'admin_stats_title'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_stats_title')),
    notice,
    primary: {
      emoji: '🧾',
      label: t(ctx, 'admin_stats_pending_receipts_label'),
      value: localizedNumber(stats.pendingReceipts, ctx),
      inline: true,
      emphasizeValue: true,
    },
    sections: [
      {
        emoji: '💳',
        title: t(ctx, 'admin_stats_revenue_section'),
        fields: [
          {
            label: t(ctx, 'admin_stats_today_label'),
            value: `${localizedNumber(stats.dailyRevenue, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_stats_week_label'),
            value: `${localizedNumber(stats.weeklyRevenue, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_stats_month_label'),
            value: `${localizedNumber(stats.monthlyRevenue, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
      {
        emoji: '👥',
        title: t(ctx, 'admin_stats_customers_section'),
        fields: [
          {
            label: t(ctx, 'admin_stats_total_users_label'),
            value: localizedNumber(stats.totalUsers, ctx),
          },
          {
            label: t(ctx, 'admin_stats_total_sales_label'),
            value: `${localizedNumber(stats.totalSales, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_stats_active_label'),
            value: localizedNumber(stats.activeSubscriptions, ctx),
          },
          {
            label: t(ctx, 'admin_stats_inactive_label'),
            value: localizedNumber(stats.inactiveSubscriptions, ctx),
          },
        ],
      },
      {
        emoji: '🎁',
        title: t(ctx, 'admin_stats_rewards_section'),
        fields: [
          {
            label: t(ctx, 'admin_stats_referral_label'),
            value: `${localizedNumber(stats.totalReferralBonus, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_stats_cashback_label'),
            value: `${localizedNumber(stats.totalCashback, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
      {
        emoji: '🩺',
        title: t(ctx, 'admin_stats_health_section'),
        fields: [
          {
            label: t(ctx, 'admin_stats_panel_label'),
            value: `${buildStatusBadge(ctx, panelHealthy ? 'healthy' : 'warning')} · ${localizedNumber(panelLatency, ctx)} ${t(ctx, 'admin_stats_latency_unit')}`,
          },
          {
            label: t(ctx, 'admin_stats_database_label'),
            value: `${buildStatusBadge(ctx, 'healthy')} · ${localizedNumber(dbLatency, ctx)} ${t(ctx, 'admin_stats_latency_unit')}`,
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard().text(t(ctx, 'admin_broadcast_refresh_button'), 'adm:stats').row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:home',
    backLabel: t(ctx, 'admin_menu_back_to_admin'),
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

/** Build the symmetric 3×2 Sales & Storefront Hub keyboard. */
export function buildAdminSalesHubKeyboard(ctx: MenuContext): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_sales_packages_button'), 'adm:pkg:p:1')
    .text(t(ctx, 'admin_sales_custom_volume_button'), 'adm:cv')
    .row()
    .text(t(ctx, 'admin_menu_promo_codes'), 'adm:prm:p:1')
    .text(t(ctx, 'admin_sales_discounts_button'), 'adm:dsc:p:1')
    .row()
    .text(t(ctx, 'admin_sales_trial_button'), 'adm:trl')
    .text(t(ctx, 'admin_sales_growth_button'), 'adm:grw')
    .row();
  return appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:home',
    backLabel: t(ctx, 'admin_menu_back_to_admin'),
  });
}

/** Render Sales & Storefront Hub screen. */
export async function renderAdminSalesHub(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  markAdminContext(ctx);
  const ts = ctx.services?.translationService;
  const packageCount = ctx.services?.pricingService?.getPackages?.().length ?? 0;
  const customOn = ts?.getSettingBool?.('custom_volume_enabled', false) ?? false;
  const trialOn = ts?.getSettingBool?.('trial_enabled', false) ?? false;
  const wheelOn = ts?.getSettingBool?.('lucky_wheel_enabled', false) ?? false;

  const text = buildAdminScreen({
    emoji: '🛍️',
    title: t(ctx, 'admin_sales_title'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_sales_title')),
    notice,
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_sales_packages_count_label'),
            value: localizedNumber(packageCount, ctx),
          },
          {
            label: t(ctx, 'admin_sales_custom_volume_label'),
            value: buildStatusBadge(ctx, customOn ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_sales_trial_label'),
            value: buildStatusBadge(ctx, trialOn ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_sales_wheel_label'),
            value: buildStatusBadge(ctx, wheelOn ? 'active' : 'inactive'),
          },
        ],
      },
    ],
  });

  await renderScreen(ctx, text, {
    parse_mode: 'Markdown',
    reply_markup: buildAdminSalesHubKeyboard(ctx),
  });
}

/** Build the unified 7-item Settings Hub keyboard. */
export function buildAdminSettingsHubKeyboard(ctx: MenuContext): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_cfg_general_button'), 'adm:cfg:gen')
    .text(t(ctx, 'admin_cfg_payment_button'), 'adm:cfg:pay')
    .row()
    .text(t(ctx, 'admin_cfg_service_button'), 'adm:cfg:svc')
    .text(t(ctx, 'admin_menu_texts'), 'adm:txt:hub')
    .row()
    .text(t(ctx, 'admin_menu_webapp_settings'), 'adm:cfg:web')
    .text(t(ctx, 'admin_menu_backup'), 'adm:cfg:bak')
    .row()
    .text(t(ctx, 'admin_cfg_admins_support_button'), 'adm:cfg:adm')
    .row();
  return appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:home',
    backLabel: t(ctx, 'admin_menu_back_to_admin'),
  });
}

/** Render unified Settings Hub screen (eliminating the redundant 2-layer System -> Settings nest). */
export async function renderAdminSettingsHub(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  markAdminContext(ctx);
  const ts = ctx.services?.translationService;
  const botEnabled = ts?.getSettingBool?.('bot_enabled', true) ?? true;
  const backupOn = ts?.getSettingBool?.('backup_enabled', false) ?? false;
  const webAppActive = Boolean(ctx.services?.webAppUrl);

  const text = buildAdminScreen({
    emoji: '⚙️',
    title: t(ctx, 'admin_menu_settings'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_menu_settings')),
    notice,
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_setting_bot_enabled'),
            value: buildStatusBadge(ctx, botEnabled ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_menu_webapp_settings'),
            value: buildStatusBadge(ctx, webAppActive ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_menu_backup'),
            value: buildStatusBadge(ctx, backupOn ? 'active' : 'inactive'),
          },
        ],
      },
    ],
  });

  await renderScreen(ctx, text, {
    parse_mode: 'Markdown',
    reply_markup: buildAdminSettingsHubKeyboard(ctx),
  });
}

/** Render unified Messaging & Broadcast Hub screen. */
export async function renderAdminMessagingHub(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  markAdminContext(ctx);
  const recent = await ctx.services?.broadcastService
    ?.listRecentJobs?.(1, 3)
    .catch(() => ({ items: [], total: 0, page: 1, totalPages: 1, activeCount: 0 }));
  const activeCount = recent?.activeCount ?? 0;
  const totalJobs = recent?.total ?? 0;

  const jobsLabel =
    activeCount > 0
      ? `${t(ctx, 'admin_msg_jobs_button')} (${localizedNumber(activeCount, ctx)})`
      : t(ctx, 'admin_msg_jobs_button');

  const text = buildAdminScreen({
    emoji: '📣',
    title: t(ctx, 'admin_nav_messaging'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_messaging')),
    notice,
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_msg_active_jobs_label'),
            value:
              activeCount > 0
                ? buildStatusBadge(ctx, 'pending', localizedNumber(activeCount, ctx))
                : localizedNumber(0, ctx),
          },
          {
            label: t(ctx, 'admin_msg_total_jobs_label'),
            value: localizedNumber(totalJobs, ctx),
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_menu_broadcast'), 'adm:msg:bcast')
    .text(t(ctx, 'admin_menu_direct_message'), 'adm:msg:dm')
    .row()
    .text(jobsLabel, 'adm:msg:jobs:1')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:home',
    backLabel: t(ctx, 'admin_menu_back_to_admin'),
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

/** Register core hub routes (`adm:home`, `adm:stats`, `adm:sales`, `adm:cfg`, `adm:msg`). */
export function registerAdminHomeRoutes(): void {
  registerAdminRoute('adm:home', async (ctx, _match, notice) => {
    await renderAdminHomeScreen(ctx, notice);
  });
  registerAdminRoute('adm:stats', async (ctx, _match, notice) => {
    await renderAdminStatsScreen(ctx, notice);
  });
  registerAdminRoute('adm:sales', async (ctx, _match, notice) => {
    await renderAdminSalesHub(ctx, notice);
  });
  registerAdminRoute('adm:cfg', async (ctx, _match, notice) => {
    await renderAdminSettingsHub(ctx, notice);
  });
  registerAdminRoute('adm:msg', async (ctx, _match, notice) => {
    await renderAdminMessagingHub(ctx, notice);
  });
}
