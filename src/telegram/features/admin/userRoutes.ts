import crypto from 'node:crypto';
import { InlineKeyboard, type Bot } from 'grammy';
import type { MenuContext } from '../../types.js';
import {
  backKeyboard,
  buildEmptyState,
  buildScreen,
  buildStatusBadge,
  renderScreen,
} from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { localizedDate, localizedNumber, t, tm } from '../../locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';

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
      new InlineKeyboard().text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin'),
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
    const badge = user.isBanned
      ? '🚫 '
      : user.activeSubscriptionCount > 0
        ? '🟢 '
        : user.totalSpend >= 500_000
          ? '💎 '
          : '';
    keyboard
      .text(
        t(ctx, 'admin_user_btn_format', {
          name: `${badge}${displayName}`,
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
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');
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
    delete ctx.session.adminQuickTopup;
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
    await showQuickTopupConfirmation(ctx, targetId, amount);
  });

  // Pre-upgrade confirmation callbacks lacked an idempotency token. Refresh
  // them into a new one-time confirmation without crediting the wallet.
  bot.callbackQuery(/^admin:user:quick_topup_confirm:(\d+):(\d+)$/u, async (ctx) => {
    const targetId = Number(ctx.match[1]);
    const amount = Number(ctx.match[2]);
    if (!isSafePositiveInteger(targetId) || !isSafePositiveInteger(amount)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_failed'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await showQuickTopupConfirmation(ctx, targetId, amount);
  });

  bot.callbackQuery(/^admin:q:([0-9a-f]{16})$/u, async (ctx) => {
    if (!ctx.services) return;
    const token = ctx.match[1]!;
    const pending = ctx.session.adminQuickTopup;
    if (!pending || pending.token !== token) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'button_action_failed'), show_alert: true });
      return;
    }
    pending.status = 'submitted';
    try {
      await ctx.services.walletService.adjustBalanceAdmin({
        telegramId: pending.targetTelegramId,
        operation: 'add',
        amount: pending.amount,
        adminId: ctx.from.id,
        description: 'Admin quick top-up',
        referenceId: `admin_quick_topup_${token}`,
      });
      await ctx.answerCallbackQuery({
        text: tm(ctx, 'admin_user_quick_topup_success', {
          amount: localizedNumber(pending.amount, ctx),
        }),
        show_alert: false,
      });
      if (ctx.session.adminQuickTopup?.token === token) {
        delete ctx.session.adminQuickTopup;
      }
      await renderUserProfile(ctx, pending.targetTelegramId);
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
      keyboard.text(`⚙️ ${config.configUsername}`, callbackData('config', 'view', config.id)).row();
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
            remainingStr = `${localizedNumber(gb, ctx)} ${t(ctx, 'traffic_unit_gb')}${
              traffic.isCached ? ` · ${t(ctx, 'cached_data_label')}` : ''
            }`;
          } else {
            remainingStr = t(ctx, 'traffic_unavailable');
          }

          return {
            emoji: isConfigActive(remote, config) ? '🟢' : '⚪️',
            title: `\`${sanitizeTelegramInlineCode(config.configUsername)}\``,
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

  bot.callbackQuery(/^admin:user:reports:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsHub(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^admin:user:reports:ledger:(\d+)(?::(\d+))?$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsLedger(ctx, Number(ctx.match[1]), Number(ctx.match[2]) || 1);
  });

  bot.callbackQuery(/^admin:user:reports:orders:(\d+)(?::(\d+))?$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsOrders(ctx, Number(ctx.match[1]), Number(ctx.match[2]) || 1);
  });

  bot.callbackQuery(/^admin:user:reports:receipts:(\d+)(?::(\d+))?$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsReceipts(ctx, Number(ctx.match[1]), Number(ctx.match[2]) || 1);
  });

  bot.callbackQuery(/^admin:user:reports:audit:(\d+)(?::(\d+))?$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsAudit(ctx, Number(ctx.match[1]), Number(ctx.match[2]) || 1);
  });

  bot.callbackQuery(/^admin:user:audit:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsHub(ctx, Number(ctx.match[1]));
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
      emoji: user.isBanned ? '⚠️' : '💰',
      label: t(ctx, 'admin_user_status_label'),
      value: `${user.isBanned ? buildStatusBadge(ctx, 'inactive', t(ctx, 'admin_banned')) : buildStatusBadge(ctx, 'active', t(ctx, 'admin_active'))} · ${localizedNumber(user.balance, ctx)} ${t(ctx, 'currency_toman')}`,
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
        emoji: '💳',
        title: t(ctx, 'admin_user_wallet_section'),
        fields: [
          {
            emoji: '💰',
            label: t(ctx, 'admin_user_balance_label'),
            value: `${localizedNumber(user.balance, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            emoji: '💳',
            label: t(ctx, 'admin_user_total_spend_label'),
            value: `${localizedNumber(user.totalSpend, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          ...(user.reservedBalance > 0
            ? [
                {
                  emoji: '🔒',
                  label: t(ctx, 'admin_user_reserved_balance_label'),
                  value: `${localizedNumber(user.reservedBalance, ctx)} ${t(ctx, 'currency_toman')}`,
                },
              ]
            : []),
          {
            emoji: '📦',
            label: t(ctx, 'admin_user_active_services_label'),
            value: localizedNumber(user.activeSubscriptionCount, ctx),
          },
          {
            emoji: '🎁',
            label: t(ctx, 'admin_user_trial_label'),
            value: user.hasUsedTrial ? t(ctx, 'admin_yes') : t(ctx, 'admin_no'),
          },
          {
            emoji: '🧾',
            label: t(ctx, 'admin_user_transactions_label'),
            value: localizedNumber(user.transactionCount, ctx),
          },
        ],
      },
      {
        emoji: '🎁',
        title: t(ctx, 'admin_user_history_section'),
        fields: [
          {
            emoji: '🎟️',
            label: t(ctx, 'admin_user_referral_code_label'),
            value: `\`${sanitizeTelegramInlineCode(user.referralCode)}\``,
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
        ],
      },
    ],
  });
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_user_quick_topup_50k'), `admin:user:quick_topup:${user.telegramId}:50000`)
    .text(t(ctx, 'admin_user_quick_topup_100k'), `admin:user:quick_topup:${user.telegramId}:100000`)
    .text(t(ctx, 'admin_user_quick_topup_200k'), `admin:user:quick_topup:${user.telegramId}:200000`)
    .row()
    .text(t(ctx, 'admin_user_balance_button'), `admin:user:balance:${user.telegramId}`)
    .text(t(ctx, 'admin_user_subscriptions_button'), `admin:user:subscriptions:${user.telegramId}`)
    .row()
    .text(t(ctx, 'admin_user_message_button'), `admin:user:message:${user.telegramId}`)
    .text(t(ctx, 'admin_user_audit_button'), `admin:user:reports:${user.telegramId}`)
    .row()
    .text(
      t(ctx, user.isBanned ? 'admin_user_unban_button' : 'admin_user_ban_button'),
      `admin:user:ban_prompt:${user.telegramId}`
    )
    .row()
    .text(t(ctx, 'admin_users_back_button'), 'admin:users:page:1');
  await renderUserScreen(ctx, text, keyboard, 'Markdown');
}

const TRANSACTION_TYPE_MAP: Record<string, string> = {
  topup: 'tx_type_topup',
  purchase: 'tx_type_purchase',
  refund: 'tx_type_refund',
  admin_adjustment: 'tx_type_admin_adjustment',
  promo: 'tx_type_promo',
  referral_bonus: 'tx_type_referral_bonus',
  cashback: 'tx_type_cashback',
  trial: 'tx_type_trial',
  transfer_sent: 'tx_type_transfer_sent',
  transfer_received: 'tx_type_transfer_received',
  lucky_wheel: 'tx_type_lucky_wheel',
};

function transactionIcon(type: string, amount: number): string {
  switch (type) {
    case 'topup':
      return '➕';
    case 'purchase':
      return '🛍️';
    case 'refund':
      return '↩️';
    case 'referral_bonus':
      return '🎁';
    case 'cashback':
      return '💸';
    case 'transfer_sent':
      return '📤';
    case 'transfer_received':
      return '📥';
    case 'promo':
      return '🎟️';
    case 'lucky_wheel':
      return '🎡';
    default:
      return amount >= 0 ? '➕' : '➖';
  }
}

function formatAuditAction(ctx: MenuContext, action: string): string {
  switch (action) {
    case 'user_banned':
      return t(ctx, 'admin_user_audit_action_banned');
    case 'user_unbanned':
      return t(ctx, 'admin_user_audit_action_unbanned');
    case 'manual_topup':
    case 'wallet_deposit':
      return t(ctx, 'admin_user_audit_action_manual_topup');
    case 'manual_deduct':
    case 'wallet_deduct':
      return t(ctx, 'admin_user_audit_action_manual_deduct');
    case 'balance_set':
    case 'wallet_set':
      return t(ctx, 'admin_user_audit_action_balance_set');
    case 'receipt_approved':
    case 'topup_receipt_approved':
      return t(ctx, 'admin_user_audit_action_receipt_approved');
    case 'receipt_rejected':
    case 'topup_receipt_rejected':
      return t(ctx, 'admin_user_audit_action_receipt_rejected');
    case 'config_transferred_out':
    case 'subscription_transferred':
      return t(ctx, 'admin_user_audit_action_config_transfer_out');
    case 'config_transferred_in':
      return t(ctx, 'admin_user_audit_action_config_transfer_in');
    case 'refund_processed':
    case 'subscription_refunded_deleted':
      return t(ctx, 'admin_user_audit_action_refund_processed');
    case 'wallet_transfer':
      return t(ctx, 'admin_user_audit_action_wallet_transfer');
    case 'admin_added':
      return t(ctx, 'admin_user_audit_action_admin_added');
    case 'admin_removed':
      return t(ctx, 'admin_user_audit_action_admin_removed');
    case 'orphan_local_binding_removed':
      return t(ctx, 'admin_user_audit_action_orphan_removed');
    case 'orphan_remote_service_assigned':
      return t(ctx, 'admin_user_audit_action_orphan_assigned');
    default:
      return escapeTelegramMarkdown(action.replace(/_/g, ' '));
  }
}

function formatAuditActor(ctx: MenuContext, actorId?: number | null): string {
  if (!actorId) {
    return t(ctx, 'admin_user_audit_actor_system');
  }
  return tm(ctx, 'admin_user_audit_actor_admin', { id: actorId });
}

function formatAuditMetadata(ctx: MenuContext, rawMetadata?: string | null): string | undefined {
  if (!rawMetadata) return undefined;
  try {
    const meta = JSON.parse(rawMetadata) as Record<string, unknown>;
    const parts: string[] = [];
    if (meta.amount !== undefined) {
      parts.push(`${localizedNumber(Number(meta.amount), ctx)} ${t(ctx, 'currency_toman')}`);
    }
    if (typeof meta.reason === 'string' && meta.reason.trim()) {
      parts.push(escapeTelegramMarkdown(meta.reason.trim()));
    }
    if (typeof meta.configUsername === 'string' && meta.configUsername.trim()) {
      parts.push(`\`${sanitizeTelegramInlineCode(meta.configUsername.trim())}\``);
    }
    if (typeof meta.description === 'string' && meta.description.trim()) {
      parts.push(escapeTelegramMarkdown(meta.description.trim()));
    }
    return parts.length > 0 ? parts.join(' · ') : undefined;
  } catch {
    return undefined;
  }
}

export async function renderUserReportsHub(ctx: MenuContext, targetId: number): Promise<void> {
  if (!ctx.services) return;
  const summary = await ctx.services.userService.getUserReportSummary(targetId);
  if (!summary) {
    await renderUserScreen(
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_user_reports_title'), t(ctx, 'admin_user_not_found')),
      new InlineKeyboard().text(t(ctx, 'admin_users_back_button'), 'admin:users:page:1'),
      'Markdown'
    );
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_user_report_btn_ledger'), `admin:user:reports:ledger:${targetId}:1`)
    .text(t(ctx, 'admin_user_report_btn_orders'), `admin:user:reports:orders:${targetId}:1`)
    .row()
    .text(t(ctx, 'admin_user_report_btn_receipts'), `admin:user:reports:receipts:${targetId}:1`)
    .text(t(ctx, 'admin_user_report_btn_audit'), `admin:user:reports:audit:${targetId}:1`)
    .row()
    .text(t(ctx, 'admin_user_report_btn_back_profile'), `admin:user:view:${targetId}`);

  const financialFields = [
    {
      emoji: '💳',
      label: t(ctx, 'admin_user_reports_total_deposit_label'),
      value: `${localizedNumber(summary.totalDeposit, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    {
      emoji: '🛍️',
      label: t(ctx, 'admin_user_reports_total_spend_label'),
      value: `${localizedNumber(summary.totalSpend, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    ...(summary.totalRefund > 0
      ? [
          {
            emoji: '↩️',
            label: t(ctx, 'admin_user_reports_total_refund_label'),
            value: `${localizedNumber(summary.totalRefund, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ]
      : []),
    {
      emoji: '🧾',
      label: t(ctx, 'admin_user_transactions_label'),
      value: localizedNumber(summary.totalTransactions, ctx),
    },
  ];

  const activityFields = [
    {
      emoji: '📦',
      label: t(ctx, 'admin_user_reports_configs_stat_label'),
      value: tm(ctx, 'admin_user_reports_configs_stat_value', {
        active: localizedNumber(summary.activeConfigsCount, ctx),
        total: localizedNumber(summary.totalConfigsCount, ctx),
      }),
    },
    {
      emoji: '🏷️',
      label: t(ctx, 'admin_user_reports_total_orders_label'),
      value: localizedNumber(summary.totalOrdersCount, ctx),
    },
    ...(summary.totalLuckyWheel > 0
      ? [
          {
            emoji: '🎡',
            label: t(ctx, 'admin_user_reports_lucky_wheel_label'),
            value: `${localizedNumber(summary.totalLuckyWheel, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ]
      : []),
  ];

  const receiptsFields = [
    {
      emoji: '🧾',
      label: t(ctx, 'admin_user_reports_receipts_stat_label'),
      value: tm(ctx, 'admin_user_reports_receipts_stat_value', {
        approved: localizedNumber(summary.receiptsApprovedCount, ctx),
        rejected: localizedNumber(summary.receiptsRejectedCount, ctx),
        pending: localizedNumber(summary.receiptsPendingCount, ctx),
      }),
    },
  ];

  const referralFields = [
    {
      emoji: '👥',
      label: t(ctx, 'admin_user_referred_count_label'),
      value: localizedNumber(summary.user.referredUserCount, ctx),
    },
    {
      emoji: '🎁',
      label: t(ctx, 'admin_user_referral_bonus_label'),
      value: `${localizedNumber(summary.totalReferralBonus, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    {
      emoji: '💸',
      label: t(ctx, 'admin_user_cashback_label'),
      value: `${localizedNumber(summary.totalCashback, ctx)} ${t(ctx, 'currency_toman')}`,
    },
  ];

  const screen = buildScreen({
    emoji: '📜',
    title: t(ctx, 'admin_user_reports_title'),
    subtitle: tm(ctx, 'admin_user_reports_subtitle', { telegram_id: targetId }),
    primary: {
      emoji: '💰',
      label: t(ctx, 'admin_user_balance_label'),
      value: `${localizedNumber(summary.user.balance, ctx)} ${t(ctx, 'currency_toman')}`,
    },
    sections: [
      {
        emoji: '💳',
        title: t(ctx, 'admin_user_reports_financial_section'),
        fields: financialFields,
      },
      {
        emoji: '📱',
        title: t(ctx, 'admin_user_reports_activity_section'),
        fields: activityFields,
      },
      {
        emoji: '🧾',
        title: t(ctx, 'admin_user_reports_receipts_section'),
        fields: receiptsFields,
      },
      {
        emoji: '👥',
        title: t(ctx, 'admin_user_reports_referral_section'),
        fields: referralFields,
      },
    ],
    footer: `ℹ️ ${t(ctx, 'admin_user_reports_hint')}`,
  });

  await renderUserScreen(ctx, screen, keyboard, 'Markdown');
}

export async function renderUserReportsLedger(
  ctx: MenuContext,
  targetId: number,
  requestedPage = 1
): Promise<void> {
  if (!ctx.services) return;
  const result = await ctx.services.walletService.listTransactionsForUser(
    targetId,
    requestedPage,
    5
  );

  if (result.transactions.length === 0) {
    await renderUserScreen(
      ctx,
      buildEmptyState('💳', t(ctx, 'admin_user_ledger_title'), t(ctx, 'admin_user_ledger_empty')),
      new InlineKeyboard().text(
        t(ctx, 'admin_user_report_btn_back_hub'),
        `admin:user:reports:${targetId}`
      ),
      'Markdown'
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  if (result.totalPages > 1) {
    if (result.page > 1) {
      keyboard.text(
        t(ctx, 'pagination_previous'),
        `admin:user:reports:ledger:${targetId}:${result.page - 1}`
      );
    }
    keyboard.text(
      `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
      'ui:noop'
    );
    if (result.page < result.totalPages) {
      keyboard.text(
        t(ctx, 'pagination_next'),
        `admin:user:reports:ledger:${targetId}:${result.page + 1}`
      );
    }
    keyboard.row();
  }
  keyboard.text(t(ctx, 'admin_user_report_btn_back_hub'), `admin:user:reports:${targetId}`);

  const screen = buildScreen({
    emoji: '💳',
    title: t(ctx, 'admin_user_ledger_title'),
    subtitle: `\`${targetId}\``,
    sections: result.transactions.map((tx) => {
      const icon = transactionIcon(tx.type, tx.amount);
      const sign = tx.amount > 0 ? '+' : '';
      const typeKey = TRANSACTION_TYPE_MAP[tx.type];
      const typeLabel = typeKey ? t(ctx, typeKey) : tx.type;
      return {
        emoji: icon,
        title: `${typeLabel} · ${localizedDate(new Date(tx.createdAt), ctx)}`,
        fields: [
          {
            emoji: '💰',
            label: t(ctx, 'wallet_pending_amount'),
            value: `${sign}${localizedNumber(tx.amount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            emoji: '👛',
            label: t(ctx, 'wallet_available_balance'),
            value: `${localizedNumber(tx.balanceAfter, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          ...(tx.referenceId
            ? [
                {
                  emoji: '🏷️',
                  label: t(ctx, 'admin_user_ledger_ref_id'),
                  value: `\`${sanitizeTelegramInlineCode(tx.referenceId)}\``,
                },
              ]
            : []),
        ],
      };
    }),
    footer: `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
  });

  await renderUserScreen(ctx, screen, keyboard, 'Markdown');
}

export async function renderUserReportsOrders(
  ctx: MenuContext,
  targetId: number,
  requestedPage = 1
): Promise<void> {
  if (!ctx.services) return;
  const result = await ctx.services.userService.listOrdersForUser(targetId, requestedPage, 5);

  if (result.orders.length === 0) {
    await renderUserScreen(
      ctx,
      buildEmptyState('🛍️', t(ctx, 'admin_user_orders_title'), t(ctx, 'admin_user_orders_empty')),
      new InlineKeyboard().text(
        t(ctx, 'admin_user_report_btn_back_hub'),
        `admin:user:reports:${targetId}`
      ),
      'Markdown'
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  if (result.totalPages > 1) {
    if (result.page > 1) {
      keyboard.text(
        t(ctx, 'pagination_previous'),
        `admin:user:reports:orders:${targetId}:${result.page - 1}`
      );
    }
    keyboard.text(
      `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
      'ui:noop'
    );
    if (result.page < result.totalPages) {
      keyboard.text(
        t(ctx, 'pagination_next'),
        `admin:user:reports:orders:${targetId}:${result.page + 1}`
      );
    }
    keyboard.row();
  }
  keyboard.text(t(ctx, 'admin_user_report_btn_back_hub'), `admin:user:reports:${targetId}`);

  const screen = buildScreen({
    emoji: '🛍️',
    title: t(ctx, 'admin_user_orders_title'),
    subtitle: `\`${targetId}\``,
    sections: result.orders.map((order) => {
      const typeLabel =
        order.type === 'renew_config'
          ? t(ctx, 'admin_user_order_type_renew')
          : t(ctx, 'admin_user_order_type_new');

      let statusEmoji = '🟢';
      let statusLabel = t(ctx, 'admin_user_order_status_completed');
      if (order.status === 'pending' || order.status === 'reconciliation_required') {
        statusEmoji = '🟡';
        statusLabel = t(ctx, 'admin_user_order_status_pending');
      } else if (order.status === 'failed') {
        statusEmoji = '🔴';
        statusLabel = t(ctx, 'admin_user_order_status_failed');
      } else if (order.status === 'refunded') {
        statusEmoji = '↩️';
        statusLabel = t(ctx, 'admin_user_order_status_refunded');
      }

      return {
        emoji: statusEmoji,
        title: `${typeLabel} · ${localizedDate(new Date(order.createdAt), ctx)}`,
        fields: [
          {
            emoji: '💰',
            label: t(ctx, 'checkout_total_label'),
            value: `${localizedNumber(order.amount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          ...(order.gbAmount && order.durationDays
            ? [
                {
                  emoji: '📦',
                  label: t(ctx, 'checkout_package_section'),
                  value: tm(ctx, 'admin_user_order_package_spec', {
                    gb: localizedNumber(order.gbAmount, ctx),
                    days: localizedNumber(order.durationDays, ctx),
                  }),
                },
              ]
            : []),
          ...(order.configUsername
            ? [
                {
                  emoji: '📱',
                  label: t(ctx, 'admin_user_order_config_label'),
                  value: `\`${sanitizeTelegramInlineCode(order.configUsername)}\``,
                },
              ]
            : []),
          {
            emoji: '⚡',
            label: t(ctx, 'subscription_status_label'),
            value: statusLabel,
          },
        ],
      };
    }),
    footer: `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
  });

  await renderUserScreen(ctx, screen, keyboard, 'Markdown');
}

export async function renderUserReportsReceipts(
  ctx: MenuContext,
  targetId: number,
  requestedPage = 1
): Promise<void> {
  if (!ctx.services) return;
  const result = await ctx.services.userService.listReceiptsForUser(targetId, requestedPage, 5);

  if (result.receipts.length === 0) {
    await renderUserScreen(
      ctx,
      buildEmptyState(
        '🧾',
        t(ctx, 'admin_user_receipts_title'),
        t(ctx, 'admin_user_receipts_empty')
      ),
      new InlineKeyboard().text(
        t(ctx, 'admin_user_report_btn_back_hub'),
        `admin:user:reports:${targetId}`
      ),
      'Markdown'
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  if (result.totalPages > 1) {
    if (result.page > 1) {
      keyboard.text(
        t(ctx, 'pagination_previous'),
        `admin:user:reports:receipts:${targetId}:${result.page - 1}`
      );
    }
    keyboard.text(
      `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
      'ui:noop'
    );
    if (result.page < result.totalPages) {
      keyboard.text(
        t(ctx, 'pagination_next'),
        `admin:user:reports:receipts:${targetId}:${result.page + 1}`
      );
    }
    keyboard.row();
  }
  keyboard.text(t(ctx, 'admin_user_report_btn_back_hub'), `admin:user:reports:${targetId}`);

  const screen = buildScreen({
    emoji: '🧾',
    title: t(ctx, 'admin_user_receipts_title'),
    subtitle: `\`${targetId}\``,
    sections: result.receipts.map((rec) => {
      let statusEmoji = '✅';
      let statusLabel = t(ctx, 'admin_user_receipt_status_approved');
      if (rec.status === 'rejected') {
        statusEmoji = '❌';
        statusLabel = t(ctx, 'admin_user_receipt_status_rejected');
      } else if (rec.status === 'pending') {
        statusEmoji = '⏳';
        statusLabel = t(ctx, 'admin_user_receipt_status_pending');
      }

      return {
        emoji: statusEmoji,
        title: `${statusLabel} · ${localizedDate(new Date(rec.createdAt), ctx)}`,
        fields: [
          {
            emoji: '💰',
            label: t(ctx, 'receipt_result_amount_label'),
            value: `${localizedNumber(rec.amount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            emoji: '🏷️',
            label: t(ctx, 'admin_user_ledger_tx_id'),
            value: `\`${sanitizeTelegramInlineCode(rec.id)}\``,
          },
          ...(rec.reviewedBy
            ? [
                {
                  emoji: '👤',
                  label: t(ctx, 'admin_user_receipt_reviewer_label'),
                  value: formatAuditActor(ctx, rec.reviewedBy),
                },
              ]
            : []),
        ],
      };
    }),
    footer: `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
  });

  await renderUserScreen(ctx, screen, keyboard, 'Markdown');
}

export async function renderUserReportsAudit(
  ctx: MenuContext,
  targetId: number,
  requestedPage = 1
): Promise<void> {
  if (!ctx.services) return;
  const result = await ctx.services.userService.listAuditLogsForUser(targetId, requestedPage, 5);

  if (result.logs.length === 0) {
    await renderUserScreen(
      ctx,
      buildEmptyState('🛡️', t(ctx, 'admin_user_audit_tab_title'), t(ctx, 'admin_user_no_audit')),
      new InlineKeyboard().text(
        t(ctx, 'admin_user_report_btn_back_hub'),
        `admin:user:reports:${targetId}`
      ),
      'Markdown'
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  if (result.totalPages > 1) {
    if (result.page > 1) {
      keyboard.text(
        t(ctx, 'pagination_previous'),
        `admin:user:reports:audit:${targetId}:${result.page - 1}`
      );
    }
    keyboard.text(
      `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
      'ui:noop'
    );
    if (result.page < result.totalPages) {
      keyboard.text(
        t(ctx, 'pagination_next'),
        `admin:user:reports:audit:${targetId}:${result.page + 1}`
      );
    }
    keyboard.row();
  }
  keyboard.text(t(ctx, 'admin_user_report_btn_back_hub'), `admin:user:reports:${targetId}`);

  const screen = buildScreen({
    emoji: '🛡️',
    title: t(ctx, 'admin_user_audit_tab_title'),
    subtitle: `\`${targetId}\``,
    sections: result.logs.map((log) => {
      const actionLabel = formatAuditAction(ctx, log.action);
      const actorLabel = formatAuditActor(ctx, log.actorTelegramId);
      const details = formatAuditMetadata(ctx, log.metadata);
      return {
        emoji: '•',
        title: `${actionLabel} · ${localizedDate(new Date(log.createdAt), ctx)}`,
        fields: [
          {
            emoji: '👤',
            label: t(ctx, 'admin_user_receipt_reviewer_label'),
            value: actorLabel,
          },
          ...(details
            ? [
                {
                  emoji: '📝',
                  label: t(ctx, 'admin_user_audit_details_label'),
                  value: details,
                },
              ]
            : []),
        ],
      };
    }),
    footer: `${localizedNumber(result.page, ctx)} / ${localizedNumber(result.totalPages, ctx)}`,
  });

  await renderUserScreen(ctx, screen, keyboard, 'Markdown');
}

function isSafePositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

async function showQuickTopupConfirmation(
  ctx: MenuContext,
  targetId: number,
  amount: number
): Promise<void> {
  const token = crypto.randomBytes(8).toString('hex');
  ctx.session.adminQuickTopup = {
    token,
    targetTelegramId: targetId,
    amount,
    status: 'pending',
  };
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
              value: `\`${targetId}\``,
            },
          ],
        },
      ],
      footer: `⚠️ ${t(ctx, 'admin_confirm_button')}`,
    }),
    new InlineKeyboard()
      .text(t(ctx, 'admin_confirm_button'), callbackData('admin', 'q', token))
      .row()
      .text(t(ctx, 'menu_cancel'), callbackData('admin', 'user', 'view', targetId)),
    'Markdown'
  );
}

async function renderUserScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard,
  parseMode?: 'Markdown'
): Promise<void> {
  await renderScreen(ctx, text, {
    ...(parseMode ? { parse_mode: parseMode } : {}),
    reply_markup: keyboard,
  });
}
