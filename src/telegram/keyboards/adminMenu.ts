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
import { localizedNumber, t, tm } from '../locale.js';
import { backKeyboard } from '../ui.js';
import { showPromoCenter } from '../promoAdminUi.js';
import { renderUserListPage } from '../features/admin/userRoutes.js';
import { showReceiptQueue } from '../features/admin/receiptRoutes.js';
import { renderAdminRegistry, renderOrphanIssues } from '../features/admin/maintenanceRoutes.js';
import { renderPanelRegistry } from '../features/admin/panelRoutes.js';

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
      await ctx.editMessageText(t(ctx, 'admin_menu_title'));
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
      await ctx.editMessageText(t(ctx, 'admin_menu_title'));
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
      await ctx.editMessageText(t(ctx, 'admin_menu_title'));
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
      await ctx.editMessageText(t(ctx, 'admin_menu_title'));
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

      await ctx.reply(
        tm(ctx, 'admin_dashboard_stats', {
          total_users: localizedNumber(stats.totalUsers, ctx),
          total_sales: localizedNumber(stats.totalSales, ctx),
          daily_revenue: localizedNumber(stats.dailyRevenue, ctx),
          weekly_revenue: localizedNumber(stats.weeklyRevenue, ctx),
          monthly_revenue: localizedNumber(stats.monthlyRevenue, ctx),
          active_subscriptions: localizedNumber(stats.activeSubscriptions, ctx),
          inactive_subscriptions: localizedNumber(stats.inactiveSubscriptions, ctx),
          pending_receipts: localizedNumber(stats.pendingReceipts, ctx),
          panel_health: panel.healthy ? '✅' : '⚠️',
          panel_latency: localizedNumber(panel.latency, ctx),
          database_health: '✅',
          database_latency: localizedNumber(databaseLatency, ctx),
          total_referral_bonus: localizedNumber(stats.totalReferralBonus, ctx),
          total_cashback: localizedNumber(stats.totalCashback, ctx),
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
      await ctx.editMessageText(t(ctx, 'admin_menu_title'));
    }
  )
  .text(
    (ctx) => t(ctx, 'admin_group_sales'),
    async (ctx) => {
      ctx.menu.nav('admin-sales-menu');
      await ctx.editMessageText(t(ctx, 'admin_menu_title'));
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
      await ctx.editMessageText(t(ctx, 'admin_menu_title'));
    }
  )
  .text(
    (ctx) => t(ctx, 'admin_group_system'),
    async (ctx) => {
      ctx.menu.nav('admin-system-menu');
      await ctx.editMessageText(t(ctx, 'admin_menu_title'));
    }
  )
  .row()
  .text(
    (ctx) => t(ctx, 'admin_menu_back'),
    async (ctx) => {
      ctx.menu.nav('main-menu');
      await ctx.editMessageText(t(ctx, 'main_menu'));
    }
  );

// Register submenus into the main admin menu tree
adminMenu.register(adminDailyMenu);
adminMenu.register(adminSalesMenu);
adminMenu.register(adminPanelsMenu);
adminMenu.register(adminSystemMenu);
