/**
 * Admin Telegram Dashboard menu tree.
 *
 * Gated by the dynamic admin registry in setupBot.
 * Features:
 *  - Real-time overall bot statistics (total users, total sales, referral payouts, cashback paid)
 *  - Grouped admin navigation: Daily operations, Sales & Packages, Rebecca panels, System & Settings
 *  - Search user profile & atomic balance modification
 *  - Dynamic setting management
 *  - Promo code management
 *  - Topup receipt verification
 *  - Throttled global broadcast
 */
import { Menu } from '@grammyjs/menu';
import type { MenuContext } from '../types.js';
import { localizedNumber, t } from '../locale.js';
import { backKeyboard, buildScreen, buildStatusBadge } from '../ui.js';
import { showPromoCenter } from '../promoAdminUi.js';
import { renderUserListPage } from '../features/admin/userRoutes.js';
import { showReceiptQueue } from '../features/admin/receiptRoutes.js';
import { renderAdminRegistry, renderOrphanIssues } from '../features/admin/maintenanceRoutes.js';
import { renderPanelRegistry } from '../features/admin/panelRoutes.js';

export function renderAdminHome(ctx: MenuContext): string {
  return buildScreen({
    emoji: '🛠️',
    title: t(ctx, 'admin_home_title'),
    subtitle: t(ctx, 'admin_home_subtitle'),
    footer: `ℹ️ ${t(ctx, 'admin_home_hint')}`,
  });
}

function renderAdminGroup(
  ctx: MenuContext,
  input: { emoji: string; titleKey: string; subtitleKey: string }
): string {
  return buildScreen({
    emoji: input.emoji,
    title: t(ctx, input.titleKey),
    subtitle: t(ctx, input.subtitleKey),
    footer: `ℹ️ ${t(ctx, 'admin_home_hint')}`,
  });
}

// ── Daily Operations Submenu ──────────────────────────────────────────────────

export const adminDailyMenu = new Menu<MenuContext>('admin-daily-menu')
  .text(
    async (ctx) => {
      const baseLabel = t(ctx, 'admin_menu_pending_receipts');
      if (!ctx.services) return baseLabel;
      const stats = await ctx.services.walletService.getDashboardStats().catch(() => null);
      if (stats && stats.pendingReceipts > 0) {
        return `${baseLabel} (📩 ${localizedNumber(stats.pendingReceipts, ctx)})`;
      }
      return baseLabel;
    },
    async (ctx) => {
      await showReceiptQueue(ctx, 1);
    }
  )
  .text(
    (ctx) => t(ctx, 'admin_menu_users'),
    async (ctx) => {
      await renderUserListPage(ctx, 1);
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'admin_menu_manual_topup'),
    async (ctx) => {
      await ctx.conversation.enter('adminSetBalanceConversation');
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'admin_menu_broadcast'),
    async (ctx) => {
      await ctx.conversation.enter('adminBroadcastConversation');
    }
  )
  .text(
    (ctx) => t(ctx, 'admin_menu_direct_message'),
    async (ctx) => {
      await ctx.conversation.enter('adminDirectMessageConversation');
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'admin_menu_back_to_admin'),
    async (ctx) => {
      ctx.menu.nav('admin-menu');
      await ctx.editMessageText(renderAdminHome(ctx), { parse_mode: 'Markdown' });
    }
  );

// ── Sales & Packages Submenu ──────────────────────────────────────────────────

export const adminSalesMenu = new Menu<MenuContext>('admin-sales-menu')
  .text(
    (ctx) => t(ctx, 'admin_sales_packages_button'),
    async (ctx) => {
      await ctx.conversation.enter('adminEditSettingsConversation', 'packages');
    }
  )
  .text(
    (ctx) => t(ctx, 'admin_sales_custom_volume_button'),
    async (ctx) => {
      await ctx.conversation.enter('adminEditSettingsConversation', 'custom_volume');
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'admin_menu_promo_codes'),
    async (ctx) => {
      await showPromoCenter(ctx);
    }
  )
  .text(
    (ctx) => t(ctx, 'admin_sales_referral_button'),
    async (ctx) => {
      await ctx.conversation.enter('adminEditSettingsConversation', 'referral');
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'admin_menu_back_to_admin'),
    async (ctx) => {
      ctx.menu.nav('admin-menu');
      await ctx.editMessageText(renderAdminHome(ctx), { parse_mode: 'Markdown' });
    }
  );

// ── Rebecca Panels Submenu ───────────────────────────────────────────────────

export const adminPanelsMenu = new Menu<MenuContext>('admin-panels-menu')
  .text(
    (ctx) => t(ctx, 'admin_menu_panels'),
    async (ctx) => {
      await renderPanelRegistry(ctx);
    }
  )
  .text(
    (ctx) => t(ctx, 'admin_menu_orphans'),
    async (ctx) => {
      await renderOrphanIssues(ctx, 1);
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'admin_menu_back_to_admin'),
    async (ctx) => {
      ctx.menu.nav('admin-menu');
      await ctx.editMessageText(renderAdminHome(ctx), { parse_mode: 'Markdown' });
    }
  );

// ── System & Settings Submenu ─────────────────────────────────────────────────

export const adminSystemMenu = new Menu<MenuContext>('admin-system-menu')
  .text(
    (ctx) => t(ctx, 'admin_menu_settings'),
    async (ctx) => {
      await ctx.conversation.enter('adminEditSettingsConversation');
    }
  )
  .text(
    (ctx) => t(ctx, 'admin_menu_admins'),
    async (ctx) => {
      await renderAdminRegistry(ctx);
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'admin_menu_texts'),
    async (ctx) => {
      await ctx.conversation.enter('adminEditTextsConversation');
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'admin_menu_back_to_admin'),
    async (ctx) => {
      ctx.menu.nav('admin-menu');
      await ctx.editMessageText(renderAdminHome(ctx), { parse_mode: 'Markdown' });
    }
  );

// ── Grouped Main Admin Menu ───────────────────────────────────────────────────

export const adminMenu = new Menu<MenuContext>('admin-menu')
  .text(
    (ctx) => t(ctx, 'admin_menu_stats'),
    async (ctx) => {
      if (!ctx.services) return;
      const databaseStartedAt = performance.now();
      const statsPromise = ctx.services.walletService.getDashboardStats().then((stats) => ({
        stats,
        latency: Math.max(0, Math.round(performance.now() - databaseStartedAt)),
      }));
      const panelStartedAt = performance.now();
      const panelPromise = ctx.services.panelRegistry
        .healthSummary()
        .then(({ configured, healthy }) => ({
          healthy: configured > 0 && healthy === configured,
          configured,
          latency: Math.max(0, Math.round(performance.now() - panelStartedAt)),
        }))
        .catch(() => ({
          healthy: false,
          configured: 0,
          latency: Math.max(0, Math.round(performance.now() - panelStartedAt)),
        }));
      const [{ stats, latency: databaseLatency }, panel] = await Promise.all([
        statsPromise,
        panelPromise,
      ]);

      await ctx.editMessageText(
        buildScreen({
          emoji: '📊',
          title: t(ctx, 'admin_stats_title'),
          subtitle: t(ctx, 'admin_stats_subtitle'),
          primary: {
            emoji: '🧾',
            label: t(ctx, 'admin_stats_pending_receipts_label'),
            value: localizedNumber(stats.pendingReceipts, ctx),
          },
          sections: [
            {
              emoji: '💳',
              title: t(ctx, 'admin_stats_revenue_section'),
              fields: [
                {
                  emoji: '📅',
                  label: t(ctx, 'admin_stats_today_label'),
                  value: `${localizedNumber(stats.dailyRevenue, ctx)} ${t(ctx, 'currency_toman')}`,
                },
                {
                  emoji: '🗓️',
                  label: t(ctx, 'admin_stats_week_label'),
                  value: `${localizedNumber(stats.weeklyRevenue, ctx)} ${t(ctx, 'currency_toman')}`,
                },
                {
                  emoji: '📆',
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
                  emoji: '👤',
                  label: t(ctx, 'admin_stats_total_users_label'),
                  value: localizedNumber(stats.totalUsers, ctx),
                },
                {
                  emoji: '💰',
                  label: t(ctx, 'admin_stats_total_sales_label'),
                  value: `${localizedNumber(stats.totalSales, ctx)} ${t(ctx, 'currency_toman')}`,
                },
                {
                  emoji: '🟢',
                  label: t(ctx, 'admin_stats_active_label'),
                  value: localizedNumber(stats.activeSubscriptions, ctx),
                },
                {
                  emoji: '⚪️',
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
                  emoji: '🎁',
                  label: t(ctx, 'admin_stats_referral_label'),
                  value: `${localizedNumber(stats.totalReferralBonus, ctx)} ${t(ctx, 'currency_toman')}`,
                },
                {
                  emoji: '💸',
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
                  emoji: panel.healthy ? '🟢' : '⚠️',
                  label: t(ctx, 'admin_stats_panel_label'),
                  value: `${buildStatusBadge(ctx, panel.healthy ? 'healthy' : 'warning')} · ${localizedNumber(panel.latency, ctx)} ${t(ctx, 'admin_stats_latency_unit')}`,
                },
                {
                  emoji: '🟢',
                  label: t(ctx, 'admin_stats_database_label'),
                  value: `${buildStatusBadge(ctx, 'healthy')} · ${localizedNumber(databaseLatency, ctx)} ${t(ctx, 'admin_stats_latency_unit')}`,
                },
              ],
            },
          ],
        }),
        { parse_mode: 'Markdown', reply_markup: backKeyboard(ctx, 'admin') }
      );
    }
  )
  .row()
  .text(
    async (ctx) => {
      const baseLabel = t(ctx, 'admin_group_daily');
      if (!ctx.services) return baseLabel;
      const stats = await ctx.services.walletService.getDashboardStats().catch(() => null);
      if (stats && stats.pendingReceipts > 0) {
        return `${baseLabel} (📩 ${localizedNumber(stats.pendingReceipts, ctx)})`;
      }
      return baseLabel;
    },
    async (ctx) => {
      ctx.menu.nav('admin-daily-menu');
      await ctx.editMessageText(
        renderAdminGroup(ctx, {
          emoji: '⚡',
          titleKey: 'admin_daily_title',
          subtitleKey: 'admin_daily_subtitle',
        }),
        { parse_mode: 'Markdown' }
      );
    }
  )
  .text(
    (ctx) => t(ctx, 'admin_group_sales'),
    async (ctx) => {
      ctx.menu.nav('admin-sales-menu');
      await ctx.editMessageText(
        renderAdminGroup(ctx, {
          emoji: '🛍️',
          titleKey: 'admin_sales_title',
          subtitleKey: 'admin_sales_subtitle',
        }),
        { parse_mode: 'Markdown' }
      );
    }
  )
  .row()
  .text(
    async (ctx) => {
      const baseLabel = t(ctx, 'admin_group_panels');
      if (!ctx.services) return baseLabel;
      const health = await ctx.services.panelRegistry.healthSummary().catch(() => null);
      if (health && health.configured > 0) {
        const icon = health.healthy ? '🟢' : '⚠️';
        return `${baseLabel} (${icon})`;
      }
      return baseLabel;
    },
    async (ctx) => {
      ctx.menu.nav('admin-panels-menu');
      await ctx.editMessageText(
        renderAdminGroup(ctx, {
          emoji: '🖥️',
          titleKey: 'admin_panels_group_title',
          subtitleKey: 'admin_panels_group_subtitle',
        }),
        { parse_mode: 'Markdown' }
      );
    }
  )
  .text(
    (ctx) => t(ctx, 'admin_group_system'),
    async (ctx) => {
      ctx.menu.nav('admin-system-menu');
      await ctx.editMessageText(
        renderAdminGroup(ctx, {
          emoji: '⚙️',
          titleKey: 'admin_system_title',
          subtitleKey: 'admin_system_subtitle',
        }),
        { parse_mode: 'Markdown' }
      );
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'admin_menu_back'),
    async (ctx) => {
      ctx.menu.nav('main-menu');
      await ctx.editMessageText(
        buildScreen({
          emoji: '🏠',
          title: t(ctx, 'home_title'),
          subtitle: t(ctx, 'home_subtitle'),
        }),
        { parse_mode: 'Markdown' }
      );
    }
  );

// Register submenus into the main admin menu tree
adminMenu.register(adminDailyMenu);
adminMenu.register(adminSalesMenu);
adminMenu.register(adminPanelsMenu);
adminMenu.register(adminSystemMenu);
