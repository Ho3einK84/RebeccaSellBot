import { InlineKeyboard, type Bot } from 'grammy';
import { logger } from '../../infra/logger.js';
import { buildAdminEmptyState, buildAdminScreen, buildBreadcrumb } from '../designSystem.js';
import { t } from '../locale.js';
import type { BotServices, MenuContext } from '../types.js';
import { clearTransientConversationSession, renderScreen } from '../ui.js';
import { clearAdminInput } from './adminInput.js';
import { markAdminContext } from './adminNav.js';
import { dispatchAdminRoute } from './adminRouter.js';
import { formatUserDisplayName } from '../features/admin/userRoutes.js';

/**
 * Sync native Telegram command menus:
 * - Default scope: `/start` only (clean for customers)
 * - Per-admin `chat` scope: `/admin`, `/r`, `/u`, `/stats`, `/cancel`
 */
export async function syncAdminBotCommands(
  bot: Bot<MenuContext>,
  services: BotServices
): Promise<void> {
  try {
    await bot.api.setMyCommands([{ command: 'start', description: 'شروع و منوی اصلی' }]);
  } catch (err) {
    logger.debug({ err }, 'Could not register default Telegram bot commands');
  }

  const adminCommands = [
    { command: 'admin', description: 'پنل مدیریت' },
    { command: 'r', description: 'صف رسیدهای در انتظار' },
    { command: 'u', description: 'جست‌وجو یا مشاهدهٔ کاربر (/u 12345)' },
    { command: 'stats', description: 'آمار فوری و وضعیت زیرساخت' },
    { command: 'cancel', description: 'لغو عملیات فعال' },
  ];

  for (const adminId of services.adminIds) {
    try {
      await bot.api.setMyCommands(adminCommands, {
        scope: { type: 'chat', chat_id: adminId },
      });
    } catch (err) {
      logger.debug({ err, adminId }, 'Could not register admin chat commands');
    }
  }
}

/** Register power-admin slash shortcuts (`/r`, `/u`, `/stats`, `/cancel`). */
export function registerAdminQuickCommands(bot: Bot<MenuContext>, services: BotServices): void {
  const ensureAdmin = async (ctx: MenuContext): Promise<boolean> => {
    const telegramId = ctx.from?.id;
    if (telegramId && services.isAdmin(telegramId)) {
      clearTransientConversationSession(ctx.session);
      clearAdminInput(ctx.session);
      markAdminContext(ctx);
      return true;
    }
    await renderScreen(
      ctx,
      buildAdminEmptyState('🔒', t(ctx, 'admin_menu_title'), t(ctx, 'admin_access_denied')),
      { parse_mode: 'Markdown' }
    );
    return false;
  };

  bot.command('r', async (ctx) => {
    if (!(await ensureAdmin(ctx))) return;
    await dispatchAdminRoute(ctx, 'adm:rcpt:q:1');
  });

  bot.command('stats', async (ctx) => {
    if (!(await ensureAdmin(ctx))) return;
    await dispatchAdminRoute(ctx, 'adm:stats');
  });

  bot.command('u', async (ctx) => {
    if (!(await ensureAdmin(ctx))) return;
    const rawQuery = ctx.match?.trim() ?? '';
    if (!rawQuery) {
      await dispatchAdminRoute(ctx, 'adm:usr:search');
      return;
    }
    const candidates =
      (await services.userService.searchProfiles?.(rawQuery, 6)) ??
      (await (async () => {
        const one = await services.userService.findProfile(rawQuery);
        return one ? [one] : [];
      })());

    if (candidates.length === 1 && candidates[0]) {
      await dispatchAdminRoute(ctx, `adm:usr:v:${candidates[0].telegramId}`);
      return;
    }

    if (candidates.length === 0) {
      const kb = new InlineKeyboard()
        .text(t(ctx, 'admin_search_again'), 'adm:usr:search')
        .row()
        .text(t(ctx, 'admin_menu_users'), 'adm:usr:p:1')
        .text(t(ctx, 'admin_nav_root_short'), 'adm:home');
      await renderScreen(
        ctx,
        buildAdminEmptyState(
          '📭',
          t(ctx, 'admin_user_search_button'),
          t(ctx, 'admin_user_not_found'),
          {
            breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_menu_users')),
          }
        ),
        { parse_mode: 'Markdown', reply_markup: kb }
      );
      return;
    }

    const kb = new InlineKeyboard();
    for (const candidate of candidates) {
      const name = formatUserDisplayName(candidate);
      const badge = candidate.isBanned ? '🚫 ' : candidate.activeSubscriptionCount > 0 ? '🟢 ' : '';
      kb.text(
        `${badge}${name} (${candidate.telegramId})`,
        `adm:usr:v:${candidate.telegramId}`
      ).row();
    }
    kb.text(t(ctx, 'admin_search_again'), 'adm:usr:search')
      .row()
      .text(t(ctx, 'admin_menu_users'), 'adm:usr:p:1')
      .text(t(ctx, 'admin_nav_root_short'), 'adm:home');

    await renderScreen(
      ctx,
      buildAdminScreen({
        emoji: '🔎',
        title: t(ctx, 'admin_search_multiple_title'),
        breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_menu_users')),
        subtitle: t(ctx, 'admin_search_multiple_subtitle'),
      }),
      { parse_mode: 'Markdown', reply_markup: kb }
    );
  });

  bot.command('cancel', async (ctx) => {
    const telegramId = ctx.from?.id;
    clearTransientConversationSession(ctx.session);
    clearAdminInput(ctx.session);
    if (telegramId && services.isAdmin(telegramId) && ctx.session?.adminLastContext === 'admin') {
      await dispatchAdminRoute(ctx, 'adm:home', {
        tone: 'info',
        text: t(ctx, 'operation_cancelled'),
      });
      return;
    }
    await renderScreen(ctx, buildAdminEmptyState('↩️', t(ctx, 'operation_cancelled'), ''), {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(t(ctx, 'menu_back_main'), 'nav:home'),
    });
  });
}
