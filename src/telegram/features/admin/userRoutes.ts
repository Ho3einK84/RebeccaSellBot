import { InlineKeyboard, type Bot } from 'grammy';
import type { MenuContext } from '../../types.js';
import { backKeyboard } from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { localizedDate, localizedNumber, t, tm } from '../../locale.js';

const USER_PAGE_SIZE = 7;

export async function renderUserListPage(ctx: MenuContext, requestedPage = 1): Promise<void> {
  if (!ctx.services) return;
  const result = await ctx.services.userService.listUsers(requestedPage, USER_PAGE_SIZE);
  const keyboard = new InlineKeyboard();
  for (const user of result.users) {
    const displayName =
      `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
      user.username ||
      String(user.telegramId);
    keyboard
      .text(
        t(ctx, 'admin_user_btn_format', {
          name: displayName,
          balance: localizedNumber(user.balance, ctx),
        }),
        `admin:user:view:${user.telegramId}`
      )
      .row();
  }
  if (result.totalPages > 1) {
    if (result.page > 1) {
      keyboard.text(t(ctx, 'pagination_previous'), `admin:users:page:${result.page - 1}`);
    }
    keyboard.text(
      `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
      `admin:users:page:${result.page}`
    );
    if (result.page < result.totalPages) {
      keyboard.text(t(ctx, 'pagination_next'), `admin:users:page:${result.page + 1}`);
    }
    keyboard.row();
  }
  keyboard
    .text(t(ctx, 'admin_user_search_button'), 'admin:users:search')
    .row()
    .text(t(ctx, 'menu_back'), 'nav:admin');
  await renderUserScreen(
    ctx,
    tm(ctx, 'admin_users_title', {
      total: localizedNumber(result.total, ctx),
      page: localizedNumber(result.page, ctx),
      total_pages: localizedNumber(result.totalPages, ctx),
    }),
    keyboard,
    'Markdown'
  );
}

export function registerAdminUserRoutes(bot: Bot<MenuContext>): void {
  bot.callbackQuery(/^admin:users:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserListPage(ctx, Number(ctx.match[1]) || 1);
  });

  bot.callbackQuery('admin:users:search', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminSearchUserConversation');
  });

  bot.callbackQuery(/^admin:user:view:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserProfile(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^admin:user:balance:(\d+)$/u, async (ctx) => {
    ctx.session.adminBalanceTargetTelegramId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminSetBalanceConversation');
  });

  bot.callbackQuery(/^admin:user:quick_topup:(\d+):(\d+)$/u, async (ctx) => {
    const targetId = Number(ctx.match[1]);
    const amount = Number(ctx.match[2]);
    if (!isSafePositiveInteger(targetId) || !isSafePositiveInteger(amount)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_failed'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderUserScreen(
      ctx,
      tm(ctx, 'admin_user_quick_topup_confirm', {
        telegram_id: targetId,
        amount: localizedNumber(amount, ctx),
      }),
      new InlineKeyboard()
        .text(t(ctx, 'admin_confirm_button'), `admin:user:quick_topup_confirm:${targetId}:${amount}`)
        .row()
        .text(t(ctx, 'menu_cancel'), `admin:user:view:${targetId}`),
      'Markdown'
    );
  });

  bot.callbackQuery(/^admin:user:quick_topup_confirm:(\d+):(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const targetId = Number(ctx.match[1]);
    const amount = Number(ctx.match[2]);
    if (!isSafePositiveInteger(targetId) || !isSafePositiveInteger(amount)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_failed'), show_alert: true });
      return;
    }
    try {
      await ctx.services.walletService.adjustBalanceAdmin({
        telegramId: targetId,
        operation: 'add',
        amount,
        adminId: ctx.from.id,
        description: 'Admin quick top-up',
      });
      await ctx.answerCallbackQuery({
        text: tm(ctx, 'admin_user_quick_topup_success', {
          amount: localizedNumber(amount, ctx),
        }),
        show_alert: false,
      });
      await renderUserProfile(ctx, targetId);
    } catch {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'operation_failed'),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^admin:user:ban_prompt:(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const targetId = Number(ctx.match[1]);
    const user = await ctx.services.userService.findProfile(String(targetId));
    if (!user) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_user_not_found'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const desired = user.isBanned ? 0 : 1;
    await renderUserScreen(
      ctx,
      t(ctx, user.isBanned ? 'admin_user_unban_confirm' : 'admin_user_ban_confirm', {
        telegram_id: targetId,
      }),
      new InlineKeyboard()
        .text(t(ctx, 'admin_confirm_button'), `admin:user:ban:${targetId}:${desired}`)
        .row()
        .text(t(ctx, 'menu_cancel'), `admin:user:view:${targetId}`)
    );
  });

  bot.callbackQuery(/^admin:user:ban:(\d+):([01])$/u, async (ctx) => {
    if (!ctx.services) return;
    const targetId = Number(ctx.match[1]);
    const banned = ctx.match[2] === '1';
    const updated = await ctx.services.userService.setBanned(targetId, banned, ctx.from.id);
    await ctx.answerCallbackQuery({
      text: t(
        ctx,
        updated ? (banned ? 'admin_user_banned' : 'admin_user_unbanned') : 'operation_failed',
        {
          telegram_id: targetId,
        }
      ),
      show_alert: !updated,
    });
    if (updated) await renderUserProfile(ctx, targetId);
  });

  bot.callbackQuery(/^admin:user:subscriptions:(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const targetId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    const configs = await ctx.services.configService.listConfigsForOwner(targetId);
    if (configs.length === 0) {
      await renderUserScreen(
        ctx,
        t(ctx, 'admin_user_no_subscriptions'),
        new InlineKeyboard().text(t(ctx, 'menu_back'), `admin:user:view:${targetId}`)
      );
      return;
    }
    const details = await Promise.all(
      configs.map(async (config) => {
        try {
          return await ctx
            .services!.panelRegistry.getService(config.panelId)
            .getUser(config.configUsername);
        } catch {
          return undefined;
        }
      })
    );
    for (const [index, config] of configs.entries()) {
      const remote = details[index];
      await ctx.reply(
        tm(ctx, 'admin_user_subscription_card', {
          username: config.configUsername,
          status:
            remote?.status ?? config.panelStatus ?? t(ctx, 'subscription_status_unknown_short'),
          data_limit:
            remote?.data_limit == null
              ? t(ctx, 'unlimited')
              : localizedNumber(Math.round(remote.data_limit / 1024 ** 3), ctx),
          created_at: localizedDate(config.createdAt, ctx),
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(
            t(ctx, 'subscription_transfer_button'),
            callbackData('admin', 'config', 'transfer', config.id)
          ),
        }
      );
    }
    await ctx.reply(
      t(ctx, 'admin_user_subscriptions_complete', { count: localizedNumber(configs.length, ctx) }),
      {
        reply_markup: new InlineKeyboard().text(t(ctx, 'menu_back'), `admin:user:view:${targetId}`),
      }
    );
  });

  bot.callbackQuery(/^admin:user:audit:(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const targetId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    const events = await ctx.services.userService.listAuditForUser(targetId, 12);
    const text = events.length
      ? events
          .map(
            (event) =>
              `• ${localizedDate(event.createdAt, ctx)} · ${event.action} · ${event.actorTelegramId ?? 'system'}`
          )
          .join('\n')
      : t(ctx, 'admin_user_no_audit');
    await renderUserScreen(
      ctx,
      `${t(ctx, 'admin_user_audit_title')}\n\n${text}`,
      new InlineKeyboard().text(t(ctx, 'menu_back'), `admin:user:view:${targetId}`)
    );
  });

  bot.callbackQuery(/^admin:user:message:(\d+)$/u, async (ctx) => {
    ctx.session.adminDirectMessageTargetTelegramId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('adminDirectMessageConversation');
  });

  bot.callbackQuery(/^admin:config:transfer:([a-zA-Z0-9_]{3,40})$/u, async (ctx) => {
    if (!ctx.services) return;
    const config = await ctx.services.configService.getConfigById(ctx.match[1]!);
    if (!config) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'config_delete_not_found', { username: '' }),
        show_alert: true,
      });
      return;
    }
    ctx.session.transferConfigId = config.id;
    ctx.session.transferConfigOwnerTelegramId = config.telegramId;
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('transferConfigConversation');
  });

  // Compatibility for buttons emitted by older deployments.
  bot.callbackQuery(/^admin_users_page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderUserListPage(ctx, Number(ctx.match[1]) || 1);
  });
  bot.callbackQuery(/^admin_user_view:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderUserProfile(ctx, Number(ctx.match[1]));
  });
  bot.callbackQuery('admin_user_search_start', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await ctx.conversation.enter('adminSearchUserConversation');
  });
  bot.callbackQuery(/^admin_user_set_balance:(\d+)$/u, async (ctx) => {
    ctx.session.adminBalanceTargetTelegramId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await ctx.conversation.enter('adminSetBalanceConversation');
  });
  bot.callbackQuery(/^admin_user_toggle_ban:(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const targetId = Number(ctx.match[1]);
    const user = await ctx.services.userService.findProfile(String(targetId));
    if (!user) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'admin_user_not_found'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    const desired = user.isBanned ? 0 : 1;
    await renderUserScreen(
      ctx,
      t(ctx, user.isBanned ? 'admin_user_unban_confirm' : 'admin_user_ban_confirm', {
        telegram_id: targetId,
      }),
      new InlineKeyboard()
        .text(t(ctx, 'admin_confirm_button'), `admin:user:ban:${targetId}:${desired}`)
        .row()
        .text(t(ctx, 'menu_cancel'), `admin:user:view:${targetId}`)
    );
  });
}

async function renderUserProfile(ctx: MenuContext, targetId: number): Promise<void> {
  if (!ctx.services) return;
  const user = await ctx.services.userService.findProfile(String(targetId));
  if (!user) {
    await ctx.reply(t(ctx, 'admin_user_not_found'), { reply_markup: backKeyboard(ctx, 'admin') });
    return;
  }
  const displayName =
    `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || t(ctx, 'admin_name_unset');
  const text = tm(ctx, 'admin_user_profile', {
    telegram_id: user.telegramId,
    uuid: user.id,
    username: user.username ? `@${user.username}` : t(ctx, 'admin_username_unset'),
    name: displayName,
    balance: localizedNumber(user.balance, ctx),
    reserved_balance: localizedNumber(user.reservedBalance, ctx),
    total_spend: localizedNumber(user.totalSpend, ctx),
    active_subscription_count: localizedNumber(user.activeSubscriptionCount, ctx),
    registration_source: user.registrationSource,
    last_seen_at: localizedDate(user.lastSeenAt, ctx),
    referral_code: user.referralCode,
    referrer: user.referrerId ? String(user.referrerId) : t(ctx, 'admin_referrer_none'),
    referred_user_count: localizedNumber(user.referredUserCount, ctx),
    referral_bonus_earned: localizedNumber(user.referralBonusEarned, ctx),
    cashback_earned: localizedNumber(user.cashbackEarned, ctx),
    has_used_trial: user.hasUsedTrial ? t(ctx, 'admin_yes') : t(ctx, 'admin_no'),
    ban_status: user.isBanned ? t(ctx, 'admin_banned') : t(ctx, 'admin_active'),
    transaction_count: localizedNumber(user.transactionCount, ctx),
    created_at: localizedDate(user.createdAt, ctx),
  });
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_user_quick_topup_50k'), `admin:user:quick_topup:${user.telegramId}:50000`)
    .text(t(ctx, 'admin_user_quick_topup_100k'), `admin:user:quick_topup:${user.telegramId}:100000`)
    .text(t(ctx, 'admin_user_quick_topup_200k'), `admin:user:quick_topup:${user.telegramId}:200000`)
    .row()
    .text(
      t(ctx, user.isBanned ? 'admin_user_unban_button' : 'admin_user_ban_button'),
      `admin:user:ban_prompt:${user.telegramId}`
    )
    .text(t(ctx, 'admin_user_balance_button'), `admin:user:balance:${user.telegramId}`)
    .row()
    .text(t(ctx, 'admin_user_subscriptions_button'), `admin:user:subscriptions:${user.telegramId}`)
    .text(t(ctx, 'admin_user_audit_button'), `admin:user:audit:${user.telegramId}`)
    .row()
    .text(t(ctx, 'admin_user_message_button'), `admin:user:message:${user.telegramId}`)
    .row()
    .text(t(ctx, 'admin_users_back_button'), 'admin:users:page:1');
  await renderUserScreen(ctx, text, keyboard, 'Markdown');
}

function isSafePositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

async function renderUserScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard,
  parseMode?: 'Markdown'
): Promise<void> {
  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, {
      ...(parseMode ? { parse_mode: parseMode } : {}),
      reply_markup: keyboard,
    });
    return;
  }
  await ctx.reply(text, {
    ...(parseMode ? { parse_mode: parseMode } : {}),
    reply_markup: keyboard,
  });
}
