import { InlineKeyboard, type Bot } from 'grammy';
import type { MenuContext } from '../../types.js';
import { backKeyboard, buildEmptyState, buildScreen } from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { localizedDate, localizedNumber, t, tm } from '../../locale.js';
import { escapeTelegramMarkdown } from '../../rendering.js';

import { calculateTraffic, isConfigActive } from '../../../domain/services/ConfigLifecycle.js';

const USER_PAGE_SIZE = 7;
const USER_SERVICE_PAGE_SIZE = 4;

export async function renderUserListPage(ctx: MenuContext, requestedPage = 1): Promise<void> {
  if (!ctx.services) return;
  const result = await ctx.services.userService.listUsers(requestedPage, USER_PAGE_SIZE);
  if (result.users.length === 0) {
    await renderUserScreen(
      ctx,
      buildEmptyState('📭', t(ctx, 'admin_users_list_title'), t(ctx, 'admin_user_not_found')),
      new InlineKeyboard().text(t(ctx, 'menu_back'), 'nav:admin'),
      'Markdown'
    );
    return;
  }
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
      'ui:noop'
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
    buildScreen({
      emoji: '👥',
      title: t(ctx, 'admin_users_list_title'),
      subtitle: t(ctx, 'admin_users_list_subtitle'),
      primary: {
        emoji: '👤',
        label: t(ctx, 'admin_users_total_label'),
        value: localizedNumber(result.total, ctx),
      },
      footer: t(ctx, 'admin_users_page_label', {
        page: localizedNumber(result.page, ctx),
        total_pages: localizedNumber(result.totalPages, ctx),
      }),
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
      buildScreen({
        emoji: '💳',
        title: t(ctx, 'admin_user_wallet_section'),
        subtitle: t(ctx, 'admin_user_quick_topup_confirm', {
          telegram_id: targetId,
          amount: localizedNumber(amount, ctx),
        }),
        primary: {
          emoji: '➕',
          label: t(ctx, 'admin_balance_add'),
          value: `${localizedNumber(amount, ctx)} ${t(ctx, 'currency_toman')}`,
        },
        sections: [
          {
            emoji: '👤',
            title: t(ctx, 'admin_user_identity_section'),
            fields: [
              {
                emoji: '🆔',
                label: t(ctx, 'admin_user_id_label'),
                value: `\`${localizedNumber(targetId, ctx)}\``,
              },
            ],
          },
        ],
        footer: `⚠️ ${t(ctx, 'admin_confirm_button')}`,
      }),
      new InlineKeyboard()
        .text(
          t(ctx, 'admin_confirm_button'),
          `admin:user:quick_topup_confirm:${targetId}:${amount}`
        )
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
      buildScreen({
        emoji: user.isBanned ? '✅' : '🚫',
        title: t(ctx, 'admin_user_profile_title'),
        subtitle: t(ctx, user.isBanned ? 'admin_user_unban_confirm' : 'admin_user_ban_confirm', {
          telegram_id: targetId,
        }),
        primary: {
          emoji: user.isBanned ? '🟢' : '⚠️',
          label: t(ctx, 'admin_user_result_status_label'),
          value: user.isBanned ? t(ctx, 'admin_active') : t(ctx, 'admin_banned'),
        },
        footer: `⚠️ ${t(ctx, 'admin_confirm_button')}`,
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

  bot.callbackQuery(/^admin:user:subscriptions:(\d+)(?::(\d+))?$/u, async (ctx) => {
    if (!ctx.services) return;
    const targetId = Number(ctx.match[1]);
    const requestedPage = Number(ctx.match[2]) || 1;
    await ctx.answerCallbackQuery();
    const configs = await ctx.services.configService.listConfigsForOwner(targetId);
    if (configs.length === 0) {
      await renderUserScreen(
        ctx,
        buildEmptyState(
          '📭',
          t(ctx, 'admin_user_services_section'),
          t(ctx, 'admin_user_no_subscriptions')
        ),
        new InlineKeyboard().text(t(ctx, 'menu_back'), `admin:user:view:${targetId}`),
        'Markdown'
      );
      return;
    }

    const totalPages = Math.max(1, Math.ceil(configs.length / USER_SERVICE_PAGE_SIZE));
    const page = Math.min(Math.max(1, Math.trunc(requestedPage)), totalPages);
    const pageConfigs = configs.slice(
      (page - 1) * USER_SERVICE_PAGE_SIZE,
      page * USER_SERVICE_PAGE_SIZE
    );
    const details = await Promise.all(
      pageConfigs.map(async (config) => {
        try {
          return await ctx.services!.configService.getRemoteConfigDetail(config);
        } catch {
          return undefined;
        }
      })
    );
    const keyboard = new InlineKeyboard();
    for (const config of pageConfigs) {
      keyboard
        .text(
          `${t(ctx, 'subscription_transfer_button')} · ${config.configUsername}`,
          callbackData('admin', 'config', 'transfer', config.id)
        )
        .row();
    }
    if (totalPages > 1) {
      if (page > 1) {
        keyboard.text(
          t(ctx, 'pagination_previous'),
          `admin:user:subscriptions:${targetId}:${page - 1}`
        );
      }
      keyboard.text(
        `${localizedNumber(page, ctx)} / ${localizedNumber(totalPages, ctx)}`,
        'ui:noop'
      );
      if (page < totalPages) {
        keyboard.text(
          t(ctx, 'pagination_next'),
          `admin:user:subscriptions:${targetId}:${page + 1}`
        );
      }
      keyboard.row();
    }
    keyboard.text(t(ctx, 'menu_back'), `admin:user:view:${targetId}`);
    const activeCount = configs.filter((c, i) => isConfigActive(details[i], c)).length;
    await renderUserScreen(
      ctx,
      buildScreen({
        emoji: '📱',
        title: t(ctx, 'admin_user_services_section'),
        subtitle: `\`${targetId}\``,
        primary: {
          emoji: '📦',
          label: t(ctx, 'admin_user_active_services_label'),
          value: localizedNumber(activeCount, ctx),
        },
        sections: pageConfigs.map((config, index) => {
          const remote = details[index];
          const traffic = calculateTraffic(remote, config);
          let remainingStr: string;
          if (traffic.isUnavailable) {
            remainingStr = t(ctx, 'traffic_unavailable');
          } else if (traffic.isUnlimited) {
            remainingStr = t(ctx, 'unlimited');
          } else if (traffic.remainingBytes != null) {
            const gb = Number((traffic.remainingBytes / 1024 ** 3).toFixed(2));
            remainingStr = `${localizedNumber(gb, ctx)} ${t(ctx, 'traffic_unit_gb')}${traffic.isCached ? ' (cached)' : ''}`;
          } else {
            remainingStr = t(ctx, 'traffic_unavailable');
          }

          return {
            emoji: isConfigActive(remote, config) ? '🟢' : '⚪️',
            title: escapeTelegramMarkdown(config.configUsername),
            fields: [
              {
                emoji: '⚡',
                label: t(ctx, 'subscription_status_label'),
                value: escapeTelegramMarkdown(
                  remote?.status ??
                    config.panelStatus ??
                    t(ctx, 'subscription_status_unknown_short')
                ),
              },
              {
                emoji: '📊',
                label: t(ctx, 'remaining'),
                value: remainingStr,
              },
              {
                emoji: '📅',
                label: t(ctx, 'admin_user_joined_label'),
                value: localizedDate(config.createdAt, ctx),
              },
            ],
          };
        }),
        footer:
          totalPages > 1
            ? `${localizedNumber(page, ctx)} / ${localizedNumber(totalPages, ctx)}`
            : undefined,
      }),
      keyboard,
      'Markdown'
    );
  });

  bot.callbackQuery(/^admin:user:audit:(\d+)$/u, async (ctx) => {
    if (!ctx.services) return;
    const targetId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    const events = await ctx.services.userService.listAuditForUser(targetId, 12);
    await renderUserScreen(
      ctx,
      events.length
        ? buildScreen({
            emoji: '📜',
            title: t(ctx, 'admin_user_audit_title'),
            subtitle: `\`${targetId}\``,
            primary: {
              emoji: '🧾',
              label: t(ctx, 'admin_user_transactions_label'),
              value: localizedNumber(events.length, ctx),
            },
            sections: [
              {
                emoji: '🕒',
                title: t(ctx, 'admin_user_audit_title'),
                fields: events.map((event) => ({
                  emoji: '•',
                  label: localizedDate(event.createdAt, ctx),
                  value: `${escapeTelegramMarkdown(event.action)} · ${event.actorTelegramId ?? 'system'}`,
                })),
              },
            ],
          })
        : buildEmptyState('📭', t(ctx, 'admin_user_audit_title'), t(ctx, 'admin_user_no_audit')),
      new InlineKeyboard().text(t(ctx, 'menu_back'), `admin:user:view:${targetId}`),
      'Markdown'
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
      buildScreen({
        emoji: user.isBanned ? '✅' : '🚫',
        title: t(ctx, 'admin_user_profile_title'),
        subtitle: t(ctx, user.isBanned ? 'admin_user_unban_confirm' : 'admin_user_ban_confirm', {
          telegram_id: targetId,
        }),
        primary: {
          emoji: user.isBanned ? '🟢' : '⚠️',
          label: t(ctx, 'admin_user_result_status_label'),
          value: user.isBanned ? t(ctx, 'admin_active') : t(ctx, 'admin_banned'),
        },
        footer: `⚠️ ${t(ctx, 'admin_confirm_button')}`,
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
    await renderUserScreen(
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_user_profile_title'), t(ctx, 'admin_user_not_found')),
      backKeyboard(ctx, 'admin'),
      'Markdown'
    );
    return;
  }
  const displayName =
    `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || t(ctx, 'admin_name_unset');
  const text = buildScreen({
    emoji: '👤',
    title: t(ctx, 'admin_user_profile_title'),
    subtitle: `\`${user.telegramId}\``,
    primary: {
      emoji: user.isBanned ? '⚠️' : '🟢',
      label: t(ctx, 'admin_user_status_label'),
      value: user.isBanned ? t(ctx, 'admin_banned') : t(ctx, 'admin_active'),
    },
    sections: [
      {
        emoji: '👤',
        title: t(ctx, 'admin_user_identity_section'),
        fields: [
          { emoji: '🆔', label: t(ctx, 'admin_user_id_label'), value: `\`${user.telegramId}\`` },
          {
            emoji: '🔗',
            label: t(ctx, 'admin_user_username_label'),
            value: user.username
              ? `@${escapeTelegramMarkdown(user.username)}`
              : t(ctx, 'admin_username_unset'),
          },
          {
            emoji: '🏷️',
            label: t(ctx, 'admin_user_name_label'),
            value: escapeTelegramMarkdown(displayName),
          },
          {
            emoji: '📅',
            label: t(ctx, 'admin_user_joined_label'),
            value: localizedDate(user.createdAt, ctx),
          },
        ],
      },
      {
        emoji: '👛',
        title: t(ctx, 'admin_user_wallet_section'),
        fields: [
          {
            emoji: '💰',
            label: t(ctx, 'admin_user_balance_label'),
            value: `${localizedNumber(user.balance, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            emoji: '🔒',
            label: t(ctx, 'admin_user_reserved_balance_label'),
            value: `${localizedNumber(user.reservedBalance, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            emoji: '💳',
            label: t(ctx, 'admin_user_total_spend_label'),
            value: `${localizedNumber(user.totalSpend, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
      {
        emoji: '📱',
        title: t(ctx, 'admin_user_services_section'),
        fields: [
          {
            emoji: '🟢',
            label: t(ctx, 'admin_user_active_services_label'),
            value: localizedNumber(user.activeSubscriptionCount, ctx),
          },
          {
            emoji: '🎁',
            label: t(ctx, 'admin_user_trial_label'),
            value: user.hasUsedTrial ? t(ctx, 'admin_yes') : t(ctx, 'admin_no'),
          },
        ],
      },
      {
        emoji: '📜',
        title: t(ctx, 'admin_user_history_section'),
        fields: [
          {
            emoji: '🎟️',
            label: t(ctx, 'admin_user_referral_code_label'),
            value: `\`${escapeTelegramMarkdown(user.referralCode)}\``,
          },
          {
            emoji: '👥',
            label: t(ctx, 'admin_user_referred_count_label'),
            value: localizedNumber(user.referredUserCount, ctx),
          },
          {
            emoji: '🎁',
            label: t(ctx, 'admin_user_referral_bonus_label'),
            value: `${localizedNumber(user.referralBonusEarned, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            emoji: '💸',
            label: t(ctx, 'admin_user_cashback_label'),
            value: `${localizedNumber(user.cashbackEarned, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            emoji: '🧾',
            label: t(ctx, 'admin_user_transactions_label'),
            value: localizedNumber(user.transactionCount, ctx),
          },
        ],
      },
    ],
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
