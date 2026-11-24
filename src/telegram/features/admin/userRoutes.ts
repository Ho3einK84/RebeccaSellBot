import crypto from 'node:crypto';
import { InlineKeyboard, type Bot } from 'grammy';
import type { AdminUserListFilter, MenuContext } from '../../types.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  guardAdminCallbacks,
  normalizeInputDigits,
  renderScreen,
  type AdminScreenNotice,
} from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import {
  localizedDate,
  localizedDateTime,
  localizedNumber,
  resolveContextLocale,
  t,
  tm,
} from '../../locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';
import { calculateTraffic, isConfigActive } from '../../../domain/services/ConfigLifecycle.js';
import { sendBalanceAdjustmentNotification } from './adminNotifications.js';
import {
  appendAdminFooterNav,
  appendAdminPagination,
  buildAdminConfirmKeyboard,
  markAdminContext,
  peekAdminNav,
  pushAdminNav,
} from '../../admin/adminNav.js';
import { registerAdminRoute } from '../../admin/adminRouter.js';
import {
  adminInputCancelKeyboard,
  registerAdminInputHandler,
  startAdminInput,
} from '../../admin/adminInput.js';
import { formatReceiptShortId } from './receiptRoutes.js';
import {
  formatUserGroupDisplayLabel,
  safeGetEffectiveUserPolicy,
} from '../../../domain/services/UserGroupService.js';

const USER_PAGE_SIZE = 7;
const USER_SERVICE_PAGE_SIZE = 4;

/**
 * Strip invisible/blank filler characters commonly used in Telegram names
 * (Hangul filler \u3164, Braille blank \u2800, zero-width & directional marks)
 * so `.trim()` does not treat an invisible name as non-empty.
 */
const INVISIBLE_NAME_CHARS_RE =
  /(?:\p{Cc}|\p{Cf}|\p{Zl}|\p{Zp}|\u034F|\u115F|\u1160|\u17B4|\u17B5|\u2800|\u3000|\u3164|\uFFA0)+/gu;

export function cleanVisibleUserName(firstName?: string | null, lastName?: string | null): string {
  return `${firstName ?? ''} ${lastName ?? ''}`
    .replace(INVISIBLE_NAME_CHARS_RE, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function formatUserDisplayName(user: {
  telegramId: number | string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const cleaned = cleanVisibleUserName(user.firstName, user.lastName);
  if (cleaned) return cleaned;
  const uname = user.username?.replace(INVISIBLE_NAME_CHARS_RE, '').trim().replace(/^@+/u, '');
  if (uname) return `@${uname}`;
  return `#${user.telegramId}`;
}

const USER_FILTERS: readonly { id: AdminUserListFilter; short: string; labelKey: string }[] = [
  { id: 'all', short: 'a', labelKey: 'admin_user_filter_all' },
  { id: 'active_subs', short: 's', labelKey: 'admin_user_filter_active' },
  { id: 'has_balance', short: 'w', labelKey: 'admin_user_filter_balance' },
  { id: 'negative_balance', short: 'n', labelKey: 'admin_user_filter_negative_balance' },
  { id: 'banned', short: 'b', labelKey: 'admin_user_filter_banned' },
];

function decodeUserFilter(code?: string): AdminUserListFilter {
  switch (code) {
    case 's':
    case 'active_subs':
      return 'active_subs';
    case 'w':
    case 'has_balance':
      return 'has_balance';
    case 'n':
    case 'negative_balance':
      return 'negative_balance';
    case 'b':
    case 'banned':
      return 'banned';
    default:
      return 'all';
  }
}

function encodeUserFilter(filter: AdminUserListFilter): string {
  return USER_FILTERS.find((f) => f.id === filter)?.short ?? 'a';
}

export async function renderUserListPage(
  ctx: MenuContext,
  requestedPage = 1,
  requestedFilter?: AdminUserListFilter,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const filter = requestedFilter ?? ctx.session?.adminUsersView?.filter ?? 'all';
  const result = await ctx.services.userService.listUsers(requestedPage, USER_PAGE_SIZE, {
    filter,
  });
  if (ctx.session) {
    ctx.session.adminUsersView = { filter, page: result.page };
  }

  const filterCode = encodeUserFilter(filter);
  const breadcrumb = buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_users_list_title'));

  const filterRowKb = (kb: InlineKeyboard) => {
    for (const [idx, item] of USER_FILTERS.entries()) {
      const active = item.id === filter;
      const label = active ? `• ${t(ctx, item.labelKey)}` : t(ctx, item.labelKey);
      kb.text(label, `adm:usr:p:1:${item.short}`);
      if (idx === 2) kb.row();
    }
    kb.row();
  };

  if (result.users.length === 0) {
    const emptyKb = new InlineKeyboard();
    filterRowKb(emptyKb);
    emptyKb
      .text(t(ctx, 'admin_user_search_button'), 'adm:usr:search')
      .text(t(ctx, 'admin_groups_button'), 'adm:grp:l')
      .row();
    appendAdminFooterNav(emptyKb, ctx, {
      backCallback: 'adm:home',
      backLabel: t(ctx, 'admin_menu_back_to_admin'),
    });
    await renderUserScreen(
      ctx,
      buildAdminEmptyState('📭', t(ctx, 'admin_users_list_title'), t(ctx, 'admin_user_not_found'), {
        breadcrumb,
        notice,
      }),
      emptyKb,
      'Markdown'
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  filterRowKb(keyboard);

  for (const user of result.users) {
    const displayName = formatUserDisplayName(user);
    const badge = user.isBanned
      ? '🚫 '
      : user.activeSubscriptionCount > 0
        ? '🟢 '
        : user.totalSpend >= 500_000
          ? '💎 '
          : '👤 ';
    keyboard
      .text(
        `${badge}\u200e${displayName}\u200e · ${localizedNumber(user.balance, ctx)} ${t(ctx, 'currency_toman')}`,
        `adm:usr:v:${user.telegramId}`
      )
      .row();
  }

  appendAdminPagination(keyboard, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => `adm:usr:p:${p}:${filterCode}`,
  });

  keyboard
    .text(t(ctx, 'admin_user_search_button'), 'adm:usr:search')
    .text(t(ctx, 'admin_groups_button'), 'adm:grp:l')
    .row();
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: 'adm:home',
    backLabel: t(ctx, 'admin_menu_back_to_admin'),
  });

  await renderUserScreen(
    ctx,
    buildAdminScreen({
      emoji: '👥',
      title: t(ctx, 'admin_users_list_title'),
      breadcrumb,
      notice,
      primary: {
        label: t(ctx, 'admin_users_total_label'),
        value: localizedNumber(result.total, ctx),
        inline: true,
        emphasizeValue: true,
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

function registerUserInputHandlers(): void {
  registerAdminInputHandler('usr:grp_days', async (ctx, rawText, state) => {
    const targetId = Number(state.payload?.targetId);
    const groupId = typeof state.payload?.groupId === 'string' ? state.payload.groupId : null;
    if (!ctx.services?.userGroupService || !Number.isSafeInteger(targetId) || !groupId) {
      return { status: 'done', redirectRoute: `adm:usr:v:${targetId}` };
    }
    const normalized = normalizeInputDigits(rawText);
    const days = /^\d+$/u.test(normalized) ? Number(normalized) : Number.NaN;
    if (!Number.isSafeInteger(days) || days < 0 || days > 3650) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '⏳',
          t(ctx, 'admin_user_group_assign_title'),
          t(ctx, 'admin_user_group_custom_days_prompt'),
          { error: t(ctx, 'admin_user_group_invalid_days') }
        ),
      };
    }
    const expiresAt = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
    try {
      await ctx.services.userGroupService.assignUserGroup({
        telegramId: targetId,
        groupId,
        expiresAt,
        actorAdminId: ctx.from?.id,
      });
      return {
        status: 'done',
        redirectRoute: `adm:usr:v:${targetId}`,
        notice: { tone: 'success', text: t(ctx, 'admin_user_group_updated') },
      };
    } catch {
      return {
        status: 'done',
        redirectRoute: `adm:usr:v:${targetId}`,
        notice: { tone: 'error', text: t(ctx, 'operation_failed') },
      };
    }
  });

  registerAdminInputHandler('usr:search', async (ctx, rawText, state) => {
    if (!ctx.services) return { status: 'done' };
    const candidates =
      (await ctx.services.userService.searchProfiles?.(rawText, 6)) ??
      (await (async () => {
        const single = await ctx.services!.userService.findProfile(rawText);
        return single ? [single] : [];
      })());

    if (candidates.length === 0) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '🔎',
          t(ctx, 'admin_user_search_button'),
          t(ctx, 'admin_search_prompt'),
          {
            breadcrumb: buildBreadcrumb(
              t(ctx, 'admin_home_title'),
              t(ctx, 'admin_users_list_title')
            ),
            error: t(ctx, 'admin_user_not_found'),
          }
        ),
        keyboard: adminInputCancelKeyboard(ctx),
      };
    }

    if (candidates.length === 1 && candidates[0]) {
      return { status: 'done', redirectRoute: `adm:usr:v:${candidates[0].telegramId}` };
    }

    const kb = new InlineKeyboard();
    for (const candidate of candidates) {
      const displayName = formatUserDisplayName(candidate);
      const badge = candidate.isBanned ? '🚫 ' : candidate.activeSubscriptionCount > 0 ? '🟢 ' : '';
      kb.text(
        `${badge}${displayName} (${candidate.telegramId})`,
        `adm:usr:v:${candidate.telegramId}`
      ).row();
    }
    kb.text(t(ctx, 'admin_search_again'), 'adm:usr:search').row();
    appendAdminFooterNav(kb, ctx, {
      backCallback: state.returnRoute,
      backLabel: t(ctx, 'admin_users_back_button'),
      showHome: true,
    });

    delete ctx.session.adminInput;
    await renderUserScreen(
      ctx,
      buildAdminScreen({
        emoji: '👥',
        title: t(ctx, 'admin_search_multiple_title'),
        breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_users_list_title')),
        subtitle: t(ctx, 'admin_search_multiple_subtitle'),
      }),
      kb,
      'Markdown'
    );
    return { status: 'handled' };
  });

  registerAdminInputHandler('usr:bal', async (ctx, rawText, state) => {
    const targetId = Number(state.payload?.targetId);
    const op = String(state.payload?.op ?? 'add') as 'add' | 'deduct' | 'set';
    const currentBalance = Number(state.payload?.currentBalance ?? 0);
    const displayName = String(state.payload?.displayName ?? targetId);

    const normalized = normalizeInputDigits(rawText.trim());
    const valid = op === 'set' ? /^\d+$/u.test(normalized) : /^[1-9]\d*$/u.test(normalized);
    const amount = valid ? Number(normalized) : Number.NaN;

    if (!valid || !Number.isSafeInteger(amount)) {
      return {
        status: 'retry',
        promptText: buildBalanceAmountPromptText(
          ctx,
          displayName,
          targetId,
          currentBalance,
          op,
          t(ctx, 'admin_invalid_balance')
        ),
        keyboard: buildBalanceAmountKeyboard(ctx, targetId, op),
      };
    }

    delete ctx.session.adminInput;
    await renderBalanceConfirmation(ctx, targetId, displayName, currentBalance, op, amount);
    return { status: 'handled' };
  });

  registerAdminInputHandler('usr:dm', async (ctx, rawText, state) => {
    const targetId = Number(state.payload?.targetId);
    const messageText = rawText.trim();
    if (!messageText || [...messageText].length > 4_096) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen(
          '✉️',
          t(ctx, 'admin_direct_title'),
          t(ctx, 'admin_direct_message_prompt'),
          {
            breadcrumb: buildBreadcrumb(
              t(ctx, 'admin_home_title'),
              t(ctx, 'admin_users_list_title'),
              t(ctx, 'admin_direct_title')
            ),
            error: t(ctx, 'admin_direct_too_long'),
          }
        ),
        keyboard: adminInputCancelKeyboard(ctx),
      };
    }

    delete ctx.session.adminInput;
    if (ctx.session) {
      ctx.session.adminDraft = { dmTargetId: targetId, dmText: messageText };
    }
    await renderDirectMessagePreview(ctx, targetId, messageText);
    return { status: 'handled' };
  });
}

function buildBalanceAmountPromptText(
  ctx: MenuContext,
  displayName: string,
  targetId: number,
  currentBalance: number,
  op: 'add' | 'deduct' | 'set',
  error?: string
): string {
  const opTitle =
    op === 'add'
      ? t(ctx, 'admin_balance_add')
      : op === 'deduct'
        ? t(ctx, 'admin_balance_deduct')
        : t(ctx, 'admin_balance_set');
  return buildAdminPromptScreen(
    op === 'deduct' ? '➖' : op === 'set' ? '✏️' : '➕',
    opTitle,
    t(ctx, 'admin_user_balance_preset_hint'),
    {
      breadcrumb: buildBreadcrumb(
        t(ctx, 'admin_home_title'),
        t(ctx, 'admin_users_list_title'),
        `${displayName} (${targetId})`
      ),
      currentLabel: t(ctx, 'admin_user_balance_label'),
      currentValue: `${localizedNumber(currentBalance, ctx)} ${t(ctx, 'currency_toman')}`,
      error,
    }
  );
}

function buildBalanceAmountKeyboard(
  ctx: MenuContext,
  targetId: number,
  op: 'add' | 'deduct' | 'set'
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const presets = [50_000, 100_000, 200_000, 500_000];
  presets.forEach((amount, idx) => {
    kb.text(`${localizedNumber(amount, ctx)}`, `adm:usr:balp:${targetId}:${op}:${amount}`);
    if (idx % 2 === 1) kb.row();
  });
  kb.text(t(ctx, 'menu_back'), `adm:usr:bal:${targetId}`).text(
    t(ctx, 'menu_cancel'),
    'adm:in:cancel'
  );
  return kb;
}

async function renderBalanceOpPicker(ctx: MenuContext, targetId: number): Promise<void> {
  if (!ctx.services) return;
  const user = await ctx.services.userService.findProfile(String(targetId));
  if (!user) {
    await renderUserProfile(ctx, targetId);
    return;
  }
  const displayName = formatUserDisplayName(user);
  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_balance_add'), `adm:usr:balo:${targetId}:add`)
    .text(t(ctx, 'admin_balance_deduct'), `adm:usr:balo:${targetId}:deduct`)
    .row()
    .text(t(ctx, 'admin_balance_set'), `adm:usr:balo:${targetId}:set`)
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: `adm:usr:v:${targetId}`,
    backLabel: t(ctx, 'admin_user_report_btn_back_profile'),
    showHome: true,
  });

  await renderUserScreen(
    ctx,
    buildAdminScreen({
      emoji: '💳',
      title: t(ctx, 'admin_user_balance_button'),
      breadcrumb: buildBreadcrumb(
        t(ctx, 'admin_home_title'),
        t(ctx, 'admin_users_list_title'),
        displayName
      ),
      primary: {
        label: t(ctx, 'admin_user_balance_label'),
        value: `${localizedNumber(user.balance, ctx)} ${t(ctx, 'currency_toman')}`,
        inline: true,
        emphasizeValue: true,
      },
      footer: t(ctx, 'admin_balance_operation_prompt'),
    }),
    kb,
    'Markdown'
  );
}

async function renderBalanceConfirmation(
  ctx: MenuContext,
  targetId: number,
  displayName: string,
  currentBalance: number,
  op: 'add' | 'deduct' | 'set',
  amount: number
): Promise<void> {
  const projected =
    op === 'add'
      ? currentBalance + amount
      : op === 'deduct'
        ? Math.max(0, currentBalance - amount)
        : amount;
  const opLabel =
    op === 'add'
      ? t(ctx, 'admin_balance_add')
      : op === 'deduct'
        ? t(ctx, 'admin_balance_deduct')
        : t(ctx, 'admin_balance_set');
  const opEmoji = op === 'deduct' ? '➖' : op === 'set' ? '✏️' : '➕';
  const currency = t(ctx, 'currency_toman');

  const text = buildAdminScreen({
    emoji: opEmoji,
    title: t(ctx, 'admin_balance_confirm_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_users_list_title'),
      displayName
    ),
    primary: {
      label: t(ctx, 'admin_user_balance_projected_label'),
      value: `${localizedNumber(projected, ctx)} ${currency}`,
      inline: true,
      emphasizeValue: true,
    },
    sections: [
      {
        fields: [
          { label: t(ctx, 'admin_user_id_label'), value: `\`${targetId}\`` },
          { label: opLabel, value: `${localizedNumber(amount, ctx)} ${currency}` },
          {
            label: t(ctx, 'admin_user_balance_label'),
            value: `${localizedNumber(currentBalance, ctx)} ${currency}`,
          },
        ],
      },
    ],
  });

  await renderUserScreen(
    ctx,
    text,
    buildAdminConfirmKeyboard(ctx, {
      confirmCallback: `adm:usr:balc:${targetId}:${op}:${amount}`,
      cancelCallback: `adm:usr:balo:${targetId}:${op}`,
    }),
    'Markdown'
  );
}

async function renderDirectMessagePreview(
  ctx: MenuContext,
  targetId: number,
  messageText: string
): Promise<void> {
  const text = buildAdminScreen({
    emoji: '✉️',
    title: t(ctx, 'admin_direct_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_users_list_title'),
      t(ctx, 'admin_direct_title')
    ),
    primary: {
      label: t(ctx, 'admin_user_id_label'),
      value: `\`${targetId}\``,
      inline: true,
    },
    sections: [
      {
        bullet: '',
        fields: [{ value: escapeTelegramMarkdown(messageText) }],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_confirm_button'), `adm:usr:msgs:${targetId}`)
    .row()
    .text(t(ctx, 'admin_direct_edit_button'), `adm:usr:msge:${targetId}`)
    .text(t(ctx, 'menu_cancel'), `adm:usr:v:${targetId}`);

  await renderUserScreen(ctx, text, kb, 'Markdown');
}

export function registerAdminUserRoutes(bot: Bot<MenuContext>): void {
  const adminCallback = guardAdminCallbacks(bot);
  registerUserInputHandlers();

  // Unified `adm:usr:*` routes
  registerAdminRoute(/^adm:usr:p:(\d+)(?::([aswnb]))?$/u, async (ctx, match, notice) => {
    const page = Number(match?.[1]) || 1;
    const filter = match?.[2] ? decodeUserFilter(match[2]) : undefined;
    await renderUserListPage(ctx, page, filter, notice);
  });

  registerAdminRoute('adm:usr:search', async (ctx) => {
    const view = ctx.session?.adminUsersView;
    const returnRoute = view
      ? `adm:usr:p:${view.page}:${encodeUserFilter(view.filter)}`
      : 'adm:usr:p:1';
    await startAdminInput(ctx, {
      kind: 'usr:search',
      returnRoute,
      promptText: buildAdminPromptScreen(
        '🔎',
        t(ctx, 'admin_user_search_button'),
        t(ctx, 'admin_search_prompt'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_users_list_title')),
        }
      ),
    });
  });

  registerAdminRoute(/^adm:usr:v:(\d+)$/u, async (ctx, match, notice) => {
    delete ctx.session.adminQuickTopup;
    await renderUserProfile(ctx, Number(match![1]), notice);
  });

  registerAdminRoute(/^adm:usr:bal:(\d+)$/u, async (ctx, match) => {
    await renderBalanceOpPicker(ctx, Number(match![1]));
  });

  registerAdminRoute(/^adm:usr:balo:(\d+):(add|deduct|set)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const targetId = Number(match![1]);
    const op = match![2] as 'add' | 'deduct' | 'set';
    const user = await ctx.services.userService.findProfile(String(targetId));
    if (!user) {
      await renderUserProfile(ctx, targetId);
      return;
    }
    const displayName = formatUserDisplayName(user);
    await startAdminInput(ctx, {
      kind: 'usr:bal',
      payload: { targetId, op, currentBalance: user.balance, displayName },
      returnRoute: `adm:usr:v:${targetId}`,
      promptText: buildBalanceAmountPromptText(ctx, displayName, targetId, user.balance, op),
      keyboard: buildBalanceAmountKeyboard(ctx, targetId, op),
    });
  });

  registerAdminRoute(/^adm:usr:balp:(\d+):(add|deduct|set):(\d+)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const targetId = Number(match![1]);
    const op = match![2] as 'add' | 'deduct' | 'set';
    const amount = Number(match![3]);
    const user = await ctx.services.userService.findProfile(String(targetId));
    if (!user) {
      await renderUserProfile(ctx, targetId);
      return;
    }
    const displayName = formatUserDisplayName(user);
    await renderBalanceConfirmation(ctx, targetId, displayName, user.balance, op, amount);
  });

  registerAdminRoute(/^adm:usr:balc:(\d+):(add|deduct|set):(\d+)$/u, async (ctx, match) => {
    if (!ctx.services || !ctx.from) return;
    const targetId = Number(match![1]);
    const op = match![2] as 'add' | 'deduct' | 'set';
    const amount = Number(match![3]);
    try {
      const newBalance = await ctx.services.walletService.adjustBalanceAdmin({
        telegramId: targetId,
        operation: op,
        amount,
        adminId: ctx.from.id,
        description: `Admin balance ${op}`,
      });
      await sendBalanceAdjustmentNotification(ctx.api, ctx.services, {
        telegramId: targetId,
        newBalance,
      });
      await renderUserProfile(ctx, targetId, {
        tone: 'success',
        text: `${t(ctx, 'admin_setting_saved_title')} · ${localizedNumber(newBalance, ctx)} ${t(ctx, 'currency_toman')}`,
      });
    } catch {
      await renderUserProfile(ctx, targetId, {
        tone: 'error',
        text: t(ctx, 'operation_failed'),
      });
    }
  });

  registerAdminRoute(/^adm:usr:msg:(\d+)$/u, async (ctx, match) => {
    const targetId = Number(match![1]);
    await startAdminInput(ctx, {
      kind: 'usr:dm',
      payload: { targetId },
      returnRoute: `adm:usr:v:${targetId}`,
      promptText: buildAdminPromptScreen(
        '✉️',
        t(ctx, 'admin_direct_title'),
        t(ctx, 'admin_direct_message_prompt'),
        {
          breadcrumb: buildBreadcrumb(
            t(ctx, 'admin_home_title'),
            t(ctx, 'admin_users_list_title'),
            `#${targetId}`
          ),
        }
      ),
    });
  });

  registerAdminRoute(/^adm:usr:msge:(\d+)$/u, async (ctx, match) => {
    const targetId = Number(match![1]);
    const prev =
      typeof ctx.session?.adminDraft?.dmText === 'string' ? ctx.session.adminDraft.dmText : '';
    await startAdminInput(ctx, {
      kind: 'usr:dm',
      payload: { targetId },
      returnRoute: `adm:usr:v:${targetId}`,
      promptText: buildAdminPromptScreen(
        '✉️',
        t(ctx, 'admin_direct_title'),
        t(ctx, 'admin_direct_message_prompt'),
        {
          breadcrumb: buildBreadcrumb(
            t(ctx, 'admin_home_title'),
            t(ctx, 'admin_users_list_title'),
            `#${targetId}`
          ),
          currentLabel: t(ctx, 'admin_text_current_label'),
          currentValue: prev ? escapeTelegramMarkdown(prev.slice(0, 300)) : undefined,
        }
      ),
    });
  });

  registerAdminRoute(/^adm:usr:msgs:(\d+)$/u, async (ctx, match) => {
    const targetId = Number(match![1]);
    const draftText =
      typeof ctx.session?.adminDraft?.dmText === 'string' ? ctx.session.adminDraft.dmText : '';
    delete ctx.session.adminDraft;
    if (!draftText) {
      await renderUserProfile(ctx, targetId, { tone: 'error', text: t(ctx, 'operation_failed') });
      return;
    }
    try {
      await ctx.api.sendMessage(targetId, draftText);
      if (ctx.from) {
        await ctx.services?.userService
          ?.recordAdminAction?.({
            actorTelegramId: ctx.from.id,
            action: 'direct_message_sent',
            entityType: 'telegram_user',
            entityId: String(targetId),
            targetTelegramId: targetId,
            metadata: { messageLength: draftText.length },
          })
          .catch(() => {});
      }
      await renderUserProfile(ctx, targetId, {
        tone: 'success',
        text: t(ctx, 'admin_direct_sent'),
      });
    } catch {
      await renderUserProfile(ctx, targetId, {
        tone: 'error',
        text: t(ctx, 'admin_direct_failed'),
      });
    }
  });

  registerAdminRoute(/^adm:usr:grp:(\d+)$/u, async (ctx, match) => {
    await renderUserGroupPicker(ctx, Number(match![1]));
  });

  registerAdminRoute(/^adm:usr:grpi:(\d+):(\d+|none)$/u, async (ctx, match) => {
    const targetId = Number(match![1]);
    const choice = match![2]!;
    if (!ctx.services?.userGroupService) {
      await renderUserProfile(ctx, targetId);
      return;
    }
    if (choice === 'none') {
      await ctx.services.userGroupService.assignUserGroup({
        telegramId: targetId,
        groupId: null,
        expiresAt: null,
        actorAdminId: ctx.from?.id,
      });
      await renderUserProfile(ctx, targetId, {
        tone: 'success',
        text: t(ctx, 'admin_user_group_updated'),
      });
      return;
    }
    const idx = Number(choice);
    const ids = Array.isArray(ctx.session?.adminDraft?.assignGroupIds)
      ? (ctx.session.adminDraft.assignGroupIds as string[])
      : [];
    const groupId = Number.isSafeInteger(idx) ? ids[idx] : undefined;
    if (!groupId) {
      await renderUserGroupPicker(ctx, targetId);
      return;
    }
    await renderUserGroupExpiryPicker(ctx, targetId, groupId);
  });

  registerAdminRoute(/^adm:usr:grpd:(\d+):(\d+|custom)$/u, async (ctx, match) => {
    const targetId = Number(match![1]);
    const rawDays = match![2]!;
    const groupId =
      typeof ctx.session?.adminDraft?.assignGroupId === 'string'
        ? ctx.session.adminDraft.assignGroupId
        : null;
    if (!ctx.services?.userGroupService || !groupId) {
      await renderUserGroupPicker(ctx, targetId);
      return;
    }
    if (rawDays === 'custom') {
      await startAdminInput(ctx, {
        kind: 'usr:grp_days',
        payload: { targetId, groupId },
        returnRoute: `adm:usr:v:${targetId}`,
        promptText: buildAdminPromptScreen(
          '⏳',
          t(ctx, 'admin_user_group_assign_title'),
          t(ctx, 'admin_user_group_custom_days_prompt'),
          {
            breadcrumb: buildBreadcrumb(
              t(ctx, 'admin_home_title'),
              t(ctx, 'admin_users_list_title'),
              `#${targetId}`
            ),
          }
        ),
      });
      return;
    }
    const days = Number(rawDays);
    const expiresAt = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
    await ctx.services.userGroupService.assignUserGroup({
      telegramId: targetId,
      groupId,
      expiresAt,
      actorAdminId: ctx.from?.id,
    });
    await renderUserProfile(ctx, targetId, {
      tone: 'success',
      text: t(ctx, 'admin_user_group_updated'),
    });
  });

  registerAdminRoute(/^adm:usr:sub:(\d+)(?::(\d+))?$/u, async (ctx, match) => {
    await renderUserSubscriptions(ctx, Number(match![1]), Number(match![2]) || 1);
  });

  registerAdminRoute(/^adm:usr:rep:(\d+)$/u, async (ctx, match) => {
    await renderUserReportsHub(ctx, Number(match![1]));
  });

  registerAdminRoute(
    /^adm:usr:rep:(ledger|orders|receipts|audit):(\d+)(?::(\d+))?$/u,
    async (ctx, match) => {
      const tab = match![1]!;
      const targetId = Number(match![2]);
      const page = Number(match![3]) || 1;
      if (tab === 'ledger') await renderUserReportsLedger(ctx, targetId, page);
      else if (tab === 'orders') await renderUserReportsOrders(ctx, targetId, page);
      else if (tab === 'receipts') await renderUserReportsReceipts(ctx, targetId, page);
      else await renderUserReportsAudit(ctx, targetId, page);
    }
  );

  // Backward-compatible legacy callback routes
  adminCallback(/^admin:users:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserListPage(ctx, Number(ctx.match[1]) || 1);
  });

  adminCallback('admin:users:search', async (ctx) => {
    await ctx.answerCallbackQuery();
    const view = ctx.session?.adminUsersView;
    const returnRoute = view
      ? `adm:usr:p:${view.page}:${encodeUserFilter(view.filter)}`
      : 'adm:usr:p:1';
    await startAdminInput(ctx, {
      kind: 'usr:search',
      returnRoute,
      promptText: buildAdminPromptScreen(
        '🔎',
        t(ctx, 'admin_user_search_button'),
        t(ctx, 'admin_search_prompt'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_users_list_title')),
        }
      ),
    });
  });

  adminCallback(/^admin:user:view:(\d+)$/u, async (ctx) => {
    delete ctx.session.adminQuickTopup;
    await ctx.answerCallbackQuery();
    await renderUserProfile(ctx, Number(ctx.match[1]));
  });

  adminCallback(/^admin:user:balance:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderBalanceOpPicker(ctx, Number(ctx.match[1]));
  });

  adminCallback(/^admin:user:quick_topup:(\d+):(\d+)$/u, async (ctx) => {
    const targetId = Number(ctx.match[1]);
    const amount = Number(ctx.match[2]);
    if (!isSafePositiveInteger(targetId) || !isSafePositiveInteger(amount)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_failed'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await showQuickTopupConfirmation(ctx, targetId, amount);
  });

  // Pre-upgrade confirmation callbacks lacked an idempotency token. Refresh
  // them into a new one-time confirmation without crediting the wallet.
  adminCallback(/^admin:user:quick_topup_confirm:(\d+):(\d+)$/u, async (ctx) => {
    const targetId = Number(ctx.match[1]);
    const amount = Number(ctx.match[2]);
    if (!isSafePositiveInteger(targetId) || !isSafePositiveInteger(amount)) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_failed'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await showQuickTopupConfirmation(ctx, targetId, amount);
  });

  adminCallback(/^admin:q:([0-9a-f]{16})$/u, async (ctx) => {
    if (!ctx.services) return;
    const token = ctx.match[1]!;
    const pending = ctx.session.adminQuickTopup;
    if (!pending || pending.token !== token || pending.status !== 'pending') {
      await ctx.answerCallbackQuery({ text: t(ctx, 'button_action_failed'), show_alert: true });
      return;
    }
    pending.status = 'submitted';
    try {
      const newBalance = await ctx.services.walletService.adjustBalanceAdmin({
        telegramId: pending.targetTelegramId,
        operation: 'add',
        amount: pending.amount,
        adminId: ctx.from.id,
        description: 'Admin quick top-up',
        referenceId: `admin_quick_topup_${token}`,
      });
      await sendBalanceAdjustmentNotification(ctx.api, ctx.services, {
        telegramId: pending.targetTelegramId,
        newBalance,
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
      await renderUserProfile(ctx, pending.targetTelegramId, {
        tone: 'success',
        text: tm(ctx, 'admin_user_quick_topup_success', {
          amount: localizedNumber(pending.amount, ctx),
        }),
      });
    } catch {
      // Allow retry on transient DB failure instead of locking the token forever.
      if (ctx.session.adminQuickTopup?.token === token) {
        ctx.session.adminQuickTopup.status = 'pending';
      }
      await ctx.answerCallbackQuery({
        text: t(ctx, 'operation_failed'),
        show_alert: true,
      });
    }
  });

  adminCallback(/^admin:user:ban_prompt:(\d+)$/u, async (ctx) => {
    await promptUserBanToggle(ctx, Number(ctx.match[1]), false);
  });

  adminCallback(/^admin:user:ban:(\d+):([01])$/u, async (ctx) => {
    if (!ctx.services) return;
    const targetId = Number(ctx.match[1]);
    const banned = ctx.match[2] === '1';
    const isTargetAdmin = Boolean(
      typeof ctx.services.isAdmin === 'function' && ctx.services.isAdmin(targetId)
    );
    if (banned && isTargetAdmin) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'admin_user_cannot_ban_admin'),
        show_alert: true,
      });
      return;
    }
    const updated = await ctx.services.userService.setBanned(targetId, banned, ctx.from.id);
    await ctx.answerCallbackQuery({
      text: t(
        ctx,
        updated ? (banned ? 'admin_user_banned' : 'admin_user_unbanned') : 'operation_failed',
        { telegram_id: targetId }
      ),
      show_alert: !updated,
    });
    if (updated) {
      await renderUserProfile(ctx, targetId, {
        tone: 'success',
        text: t(ctx, banned ? 'admin_user_banned' : 'admin_user_unbanned', {
          telegram_id: targetId,
        }),
      });
    }
  });

  adminCallback(/^admin:user:subscriptions:(\d+)(?::(\d+))?$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserSubscriptions(ctx, Number(ctx.match[1]), Number(ctx.match[2]) || 1);
  });

  adminCallback(/^admin:user:reports:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsHub(ctx, Number(ctx.match[1]));
  });

  adminCallback(/^admin:user:reports:ledger:(\d+)(?::(\d+))?$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsLedger(ctx, Number(ctx.match[1]), Number(ctx.match[2]) || 1);
  });

  adminCallback(/^admin:user:reports:orders:(\d+)(?::(\d+))?$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsOrders(ctx, Number(ctx.match[1]), Number(ctx.match[2]) || 1);
  });

  adminCallback(/^admin:user:reports:receipts:(\d+)(?::(\d+))?$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsReceipts(ctx, Number(ctx.match[1]), Number(ctx.match[2]) || 1);
  });

  adminCallback(/^admin:user:reports:audit:(\d+)(?::(\d+))?$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsAudit(ctx, Number(ctx.match[1]), Number(ctx.match[2]) || 1);
  });

  adminCallback(/^admin:user:audit:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderUserReportsHub(ctx, Number(ctx.match[1]));
  });

  adminCallback(/^admin:user:message:(\d+)$/u, async (ctx) => {
    const targetId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await startAdminInput(ctx, {
      kind: 'usr:dm',
      payload: { targetId },
      returnRoute: `adm:usr:v:${targetId}`,
      promptText: buildAdminPromptScreen(
        '✉️',
        t(ctx, 'admin_direct_title'),
        t(ctx, 'admin_direct_message_prompt'),
        {
          breadcrumb: buildBreadcrumb(
            t(ctx, 'admin_home_title'),
            t(ctx, 'admin_users_list_title'),
            `#${targetId}`
          ),
        }
      ),
    });
  });

  adminCallback(/^admin:config:transfer:([a-zA-Z0-9_]{3,40})$/u, async (ctx) => {
    if (!ctx.services) return;
    const config = await ctx.services.configService.getConfigById(ctx.match[1]!);
    if (!config) {
      await ctx.answerCallbackQuery({
        text: t(ctx, 'config_not_owned'),
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
  adminCallback(/^admin_users_page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderUserListPage(ctx, Number(ctx.match[1]) || 1);
  });
  adminCallback(/^admin_user_view:(\d+)$/u, async (ctx) => {
    delete ctx.session.adminQuickTopup;
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderUserProfile(ctx, Number(ctx.match[1]));
  });
  adminCallback('admin_user_search_start', async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await startAdminInput(ctx, {
      kind: 'usr:search',
      returnRoute: 'adm:usr:p:1',
      promptText: buildAdminPromptScreen(
        '🔎',
        t(ctx, 'admin_user_search_button'),
        t(ctx, 'admin_search_prompt'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_users_list_title')),
        }
      ),
    });
  });
  adminCallback(/^admin_user_set_balance:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: t(ctx, 'button_refreshed') });
    await renderBalanceOpPicker(ctx, Number(ctx.match[1]));
  });
  adminCallback(/^admin_user_toggle_ban:(\d+)$/u, async (ctx) => {
    await promptUserBanToggle(ctx, Number(ctx.match[1]), true);
  });
}

async function promptUserBanToggle(
  ctx: MenuContext,
  targetId: number,
  isLegacyRefresh: boolean
): Promise<void> {
  if (!ctx.services) return;
  const user = await ctx.services.userService.findProfile(String(targetId));
  if (!user) {
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_user_not_found'), show_alert: true });
    return;
  }
  const isTargetAdmin = Boolean(
    typeof ctx.services.isAdmin === 'function' && ctx.services.isAdmin(targetId)
  );
  if (!user.isBanned && isTargetAdmin) {
    await ctx.answerCallbackQuery({
      text: t(ctx, 'admin_user_cannot_ban_admin'),
      show_alert: true,
    });
    return;
  }
  await ctx.answerCallbackQuery(isLegacyRefresh ? { text: t(ctx, 'button_refreshed') } : undefined);
  const desired = user.isBanned ? 0 : 1;
  await renderUserScreen(
    ctx,
    buildAdminScreen({
      emoji: user.isBanned ? '✅' : '🚫',
      title: t(ctx, 'admin_user_profile_title'),
      breadcrumb: buildBreadcrumb(
        t(ctx, 'admin_home_title'),
        t(ctx, 'admin_users_list_title'),
        `#${targetId}`
      ),
      subtitle: t(ctx, user.isBanned ? 'admin_user_unban_confirm' : 'admin_user_ban_confirm', {
        telegram_id: targetId,
      }),
      primary: {
        label: t(ctx, 'admin_user_result_status_label'),
        value: user.isBanned
          ? buildStatusBadge(ctx, 'active', t(ctx, 'admin_active'))
          : buildStatusBadge(ctx, 'inactive', t(ctx, 'admin_banned')),
        inline: true,
      },
      footer: t(ctx, user.isBanned ? 'admin_user_unban_consequence' : 'admin_user_ban_consequence'),
    }),
    buildAdminConfirmKeyboard(ctx, {
      confirmCallback: `admin:user:ban:${targetId}:${desired}`,
      cancelCallback: `adm:usr:v:${targetId}`,
    })
  );
}

async function renderUserSubscriptions(
  ctx: MenuContext,
  targetId: number,
  requestedPage = 1
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const configs = await ctx.services.configService.listConfigsForOwner(targetId);
  const breadcrumb = buildBreadcrumb(
    t(ctx, 'admin_home_title'),
    t(ctx, 'admin_users_list_title'),
    `#${targetId}`,
    t(ctx, 'admin_user_services_section')
  );

  if (configs.length === 0) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: `adm:usr:v:${targetId}`,
      backLabel: t(ctx, 'admin_user_report_btn_back_profile'),
      showHome: true,
    });
    await renderUserScreen(
      ctx,
      buildAdminEmptyState(
        '📭',
        t(ctx, 'admin_user_services_section'),
        t(ctx, 'admin_user_no_subscriptions'),
        { breadcrumb }
      ),
      kb,
      'Markdown'
    );
    return;
  }

  const totalPages = Math.max(1, Math.ceil(configs.length / USER_SERVICE_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage)), totalPages);
  const offset = (page - 1) * USER_SERVICE_PAGE_SIZE;
  const pageConfigs = configs.slice(offset, offset + USER_SERVICE_PAGE_SIZE);
  const details = await Promise.all(
    pageConfigs.map(async (config) => {
      try {
        return await ctx.services!.configService.getRemoteConfigDetail(config);
      } catch {
        return undefined;
      }
    })
  );

  // Align each remote detail strictly with its own config ID (fixes page 2+ miscount bug).
  const remoteByConfigId = new Map(pageConfigs.map((cfg, idx) => [cfg.id, details[idx]]));
  const activeCount = configs.filter((c) => isConfigActive(remoteByConfigId.get(c.id), c)).length;

  const keyboard = new InlineKeyboard();
  for (const config of pageConfigs) {
    keyboard.text(`⚙️ ${config.configUsername}`, callbackData('config', 'view', config.id)).row();
  }
  appendAdminPagination(keyboard, ctx, {
    page,
    totalPages,
    pageCallback: (p) => `adm:usr:sub:${targetId}:${p}`,
  });
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: `adm:usr:v:${targetId}`,
    backLabel: t(ctx, 'admin_user_report_btn_back_profile'),
    showHome: true,
  });

  await renderUserScreen(
    ctx,
    buildAdminScreen({
      emoji: '📱',
      title: t(ctx, 'admin_user_services_section'),
      breadcrumb,
      primary: {
        label: t(ctx, 'admin_user_active_services_label'),
        value: localizedNumber(activeCount, ctx),
        inline: true,
        emphasizeValue: true,
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
              label: t(ctx, 'subscription_status_label'),
              value: escapeTelegramMarkdown(
                remote?.status ?? config.panelStatus ?? t(ctx, 'subscription_status_unknown_short')
              ),
            },
            {
              label: t(ctx, 'remaining'),
              value: remainingStr,
            },
            {
              label: t(ctx, 'admin_receipt_created_label'),
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
}

export async function renderUserProfile(
  ctx: MenuContext,
  targetId: number,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const view = ctx.session?.adminUsersView;
  const usersListRoute = view
    ? `adm:usr:p:${view.page}:${encodeUserFilter(view.filter)}`
    : 'adm:usr:p:1';
  const stackedOrigin = peekAdminNav(ctx.session);
  const backCallback = stackedOrigin ? 'adm:back' : usersListRoute;
  const backLabel = stackedOrigin ? t(ctx, 'menu_back') : t(ctx, 'admin_users_back_button');

  const user = await ctx.services.userService.findProfile(String(targetId));
  if (!user) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, { backCallback, backLabel, showHome: true });
    await renderUserScreen(
      ctx,
      buildAdminEmptyState(
        '⚠️',
        t(ctx, 'admin_user_profile_title'),
        t(ctx, 'admin_user_not_found'),
        {
          breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_users_list_title')),
          notice,
        }
      ),
      kb,
      'Markdown'
    );
    return;
  }

  const displayName =
    cleanVisibleUserName(user.firstName, user.lastName) || t(ctx, 'admin_name_unset');
  const statusBadge = user.isBanned
    ? buildStatusBadge(ctx, 'inactive', t(ctx, 'admin_banned'))
    : buildStatusBadge(ctx, 'active', t(ctx, 'admin_active'));
  const groupPolicy = await safeGetEffectiveUserPolicy(
    ctx.services.userGroupService,
    user.telegramId
  );
  const groupDisplayLabel = formatUserGroupDisplayLabel(groupPolicy);
  const groupSummaryValue = groupDisplayLabel
    ? `${escapeTelegramMarkdown(groupDisplayLabel)}${
        groupPolicy.isAssigned && groupPolicy.expiresAt
          ? ` (${t(ctx, 'admin_user_group_expires_on', { date: localizedDate(groupPolicy.expiresAt, ctx) })})`
          : !groupPolicy.isAssigned && groupPolicy.isDefaultGroup
            ? ` (${t(ctx, 'admin_groups_default_tag')})`
            : ''
      }`
    : t(ctx, 'admin_user_group_none');
  const debtAmount = Math.max(0, -user.balance);
  const usableCredit = Math.max(0, user.balance - user.reservedBalance + groupPolicy.creditLimit);

  const text = buildAdminScreen({
    emoji: '👤',
    title: t(ctx, 'admin_user_profile_title'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_users_list_title')),
    notice,
    primary: {
      label: t(ctx, 'admin_user_status_label'),
      value: `${statusBadge} · ${localizedNumber(user.balance, ctx)} ${t(ctx, 'currency_toman')}`,
      inline: true,
    },
    sections: [
      {
        title: t(ctx, 'admin_user_identity_section'),
        fields: [
          { label: t(ctx, 'admin_user_id_label'), value: `\`${user.telegramId}\`` },
          {
            label: t(ctx, 'admin_user_username_label'),
            value: user.username
              ? `@${escapeTelegramMarkdown(user.username)}`
              : t(ctx, 'admin_username_unset'),
          },
          {
            label: t(ctx, 'admin_user_name_label'),
            value: escapeTelegramMarkdown(displayName),
          },
          {
            label: t(ctx, 'admin_user_group_label'),
            value: groupSummaryValue,
          },
          {
            label: t(ctx, 'admin_user_joined_label'),
            value: localizedDate(user.createdAt, ctx),
          },
        ],
      },
      {
        title: t(ctx, 'admin_user_wallet_section'),
        fields: [
          {
            label: t(ctx, 'admin_user_balance_label'),
            value: `${localizedNumber(user.balance, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          ...(debtAmount > 0
            ? [
                {
                  label: t(ctx, 'wallet_debt_label'),
                  value: `${localizedNumber(debtAmount, ctx)} ${t(ctx, 'currency_toman')}`,
                },
              ]
            : []),
          ...(groupPolicy.creditLimit > 0
            ? [
                {
                  label: t(ctx, 'wallet_credit_limit_label'),
                  value: `${localizedNumber(groupPolicy.creditLimit, ctx)} ${t(ctx, 'currency_toman')}`,
                },
                {
                  label: t(ctx, 'wallet_purchasing_power_label'),
                  value: `${localizedNumber(usableCredit, ctx)} ${t(ctx, 'currency_toman')}`,
                },
              ]
            : []),
          {
            label: t(ctx, 'admin_user_total_spend_label'),
            value: `${localizedNumber(user.totalSpend, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          ...(user.reservedBalance > 0
            ? [
                {
                  label: t(ctx, 'admin_user_reserved_balance_label'),
                  value: `${localizedNumber(user.reservedBalance, ctx)} ${t(ctx, 'currency_toman')}`,
                },
              ]
            : []),
          {
            label: t(ctx, 'admin_user_active_services_label'),
            value: localizedNumber(user.activeSubscriptionCount, ctx),
          },
          {
            label: t(ctx, 'admin_user_trial_label'),
            value: user.hasUsedTrial ? t(ctx, 'admin_yes') : t(ctx, 'admin_no'),
          },
          {
            label: t(ctx, 'admin_user_transactions_label'),
            value: localizedNumber(user.transactionCount, ctx),
          },
        ],
      },
      {
        title: t(ctx, 'admin_user_history_section'),
        fields: [
          {
            label: t(ctx, 'admin_user_referral_code_label'),
            value: `\`${sanitizeTelegramInlineCode(user.referralCode)}\``,
          },
          {
            label: t(ctx, 'admin_user_referred_count_label'),
            value: localizedNumber(user.referredUserCount, ctx),
          },
          {
            label: t(ctx, 'admin_user_referral_bonus_label'),
            value: `${localizedNumber(user.referralBonusEarned, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
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
    .text(t(ctx, 'admin_user_balance_button'), `adm:usr:bal:${user.telegramId}`)
    .text(t(ctx, 'admin_user_subscriptions_button'), `adm:usr:sub:${user.telegramId}:1`)
    .row()
    .text(t(ctx, 'admin_user_message_button'), `adm:usr:msg:${user.telegramId}`)
    .text(t(ctx, 'admin_user_audit_button'), `adm:usr:rep:${user.telegramId}`)
    .row()
    .text(t(ctx, 'admin_user_group_button'), `adm:usr:grp:${user.telegramId}`)
    .text(
      t(ctx, user.isBanned ? 'admin_user_unban_button' : 'admin_user_ban_button'),
      `admin:user:ban_prompt:${user.telegramId}`
    )
    .row();
  appendAdminFooterNav(keyboard, ctx, { backCallback, backLabel, showHome: true });

  await renderUserScreen(ctx, text, keyboard, 'Markdown');
}

async function renderUserGroupPicker(ctx: MenuContext, targetId: number): Promise<void> {
  if (!ctx.services?.userGroupService) {
    await renderUserProfile(ctx, targetId);
    return;
  }
  markAdminContext(ctx);
  const [groups, policy] = await Promise.all([
    ctx.services.userGroupService.listGroups(),
    safeGetEffectiveUserPolicy(ctx.services.userGroupService, targetId),
  ]);

  if (ctx.session) {
    ctx.session.adminDraft = {
      ...(ctx.session.adminDraft ?? {}),
      assignGroupIds: groups.map((g) => g.id),
    };
  }

  const kb = new InlineKeyboard();
  for (const [idx, g] of groups.entries()) {
    const activeMark = policy.isAssigned && policy.groupId === g.id ? '✅ ' : '';
    const badge = g.badge ? `${g.badge} ` : '';
    kb.text(`${activeMark}${badge}${g.name}`, `adm:usr:grpi:${targetId}:${idx}`).row();
  }
  kb.text(t(ctx, 'admin_user_group_clear_btn'), `adm:usr:grpi:${targetId}:none`).row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: `adm:usr:v:${targetId}`,
    backLabel: t(ctx, 'admin_user_report_btn_back_profile'),
    showHome: true,
  });

  const currentLabel = formatUserGroupDisplayLabel(policy) ?? t(ctx, 'admin_user_group_none');
  const text = buildAdminScreen({
    emoji: '👥',
    title: t(ctx, 'admin_user_group_assign_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_users_list_title'),
      `#${targetId}`
    ),
    primary: {
      label: t(ctx, 'admin_user_group_label'),
      value: escapeTelegramMarkdown(currentLabel),
      inline: true,
    },
    footer:
      groups.length > 0 ? t(ctx, 'admin_user_group_select_prompt') : t(ctx, 'admin_groups_empty'),
  });

  await renderUserScreen(ctx, text, kb, 'Markdown');
}

async function renderUserGroupExpiryPicker(
  ctx: MenuContext,
  targetId: number,
  groupId: string
): Promise<void> {
  if (!ctx.services?.userGroupService) {
    await renderUserProfile(ctx, targetId);
    return;
  }
  const group = await ctx.services.userGroupService.getGroupById(groupId);
  if (!group) {
    await renderUserGroupPicker(ctx, targetId);
    return;
  }
  if (ctx.session) {
    ctx.session.adminDraft = {
      ...(ctx.session.adminDraft ?? {}),
      assignGroupId: group.id,
    };
  }

  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_user_group_expiry_permanent'), `adm:usr:grpd:${targetId}:0`)
    .row()
    .text(t(ctx, 'admin_user_group_expiry_7d'), `adm:usr:grpd:${targetId}:7`)
    .text(t(ctx, 'admin_user_group_expiry_30d'), `adm:usr:grpd:${targetId}:30`)
    .text(t(ctx, 'admin_user_group_expiry_90d'), `adm:usr:grpd:${targetId}:90`)
    .row()
    .text(t(ctx, 'admin_user_group_expiry_custom'), `adm:usr:grpd:${targetId}:custom`)
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: `adm:usr:grp:${targetId}`,
    backLabel: t(ctx, 'menu_back'),
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: '⏳',
    title: t(ctx, 'admin_user_group_assign_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_users_list_title'),
      `#${targetId}`
    ),
    primary: {
      label: t(ctx, 'admin_user_group_label'),
      value: escapeTelegramMarkdown(group.name),
      inline: true,
    },
    footer: t(ctx, 'admin_user_group_expiry_prompt'),
  });

  await renderUserScreen(ctx, text, kb, 'Markdown');
}

const TRANSACTION_TYPE_MAP: Record<string, string> = {
  topup: 'tx_type_topup',
  topup_void: 'tx_type_topup_void',
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
    case 'topup_void':
      return '🚫';
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
    case 'trial':
      return '🎁';
    default:
      return amount >= 0 ? '➕' : '➖';
  }
}

function getAuditActionEmoji(action: string): string {
  switch (action) {
    case 'manual_topup':
    case 'wallet_deposit':
    case 'wallet_add':
      return '➕';
    case 'manual_deduct':
    case 'wallet_deduct':
      return '➖';
    case 'balance_set':
    case 'wallet_set':
      return '💳';
    case 'receipt_approved':
    case 'topup_receipt_approved':
      return '✅';
    case 'receipt_rejected':
    case 'topup_receipt_rejected':
      return '❌';
    case 'receipt_voided':
    case 'topup_receipt_voided':
      return '🚫';
    case 'user_banned':
      return '🚫';
    case 'user_unbanned':
      return '🟢';
    case 'config_transferred_out':
    case 'subscription_transferred':
    case 'config_transferred_in':
    case 'wallet_transfer':
      return '🔁';
    case 'refund_processed':
    case 'subscription_refunded_deleted':
      return '↩️';
    case 'direct_message_sent':
      return '✉️';
    case 'broadcast_created':
    case 'broadcast_cancelled':
      return '📣';
    case 'admin_added':
    case 'admin_removed':
      return '👑';
    default:
      return '🛡️';
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
    case 'wallet_add':
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
    case 'receipt_voided':
    case 'topup_receipt_voided':
      return t(ctx, 'admin_user_audit_action_receipt_voided');
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
    case 'direct_message_sent':
      return t(ctx, 'admin_user_audit_action_direct_message');
    case 'broadcast_created':
      return t(ctx, 'admin_user_audit_action_broadcast_created');
    case 'broadcast_cancelled':
      return t(ctx, 'admin_user_audit_action_broadcast_cancelled');
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
  markAdminContext(ctx);
  const summary = await ctx.services.userService.getUserReportSummary(targetId);
  if (!summary) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:usr:p:1',
      backLabel: t(ctx, 'admin_users_back_button'),
      showHome: true,
    });
    await renderUserScreen(
      ctx,
      buildAdminEmptyState(
        '⚠️',
        t(ctx, 'admin_user_reports_title'),
        t(ctx, 'admin_user_not_found')
      ),
      kb,
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
    .row();
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: `admin:user:view:${targetId}`,
    backLabel: t(ctx, 'admin_user_report_btn_back_profile'),
    showHome: true,
  });

  const screen = buildAdminScreen({
    emoji: '📜',
    title: t(ctx, 'admin_user_reports_title'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_users_list_title')),
    subtitle: tm(ctx, 'admin_user_reports_subtitle', { telegram_id: targetId }),
    primary: {
      label: t(ctx, 'admin_user_balance_label'),
      value: `${localizedNumber(summary.user.balance, ctx)} ${t(ctx, 'currency_toman')}`,
      inline: true,
      emphasizeValue: true,
    },
    sections: [
      {
        title: t(ctx, 'admin_user_reports_financial_section'),
        fields: [
          {
            label: t(ctx, 'admin_user_reports_total_deposit_label'),
            value: `${localizedNumber(summary.totalDeposit, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_user_reports_total_spend_label'),
            value: `${localizedNumber(summary.totalSpend, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          ...(summary.totalRefund > 0
            ? [
                {
                  label: t(ctx, 'admin_user_reports_total_refund_label'),
                  value: `${localizedNumber(summary.totalRefund, ctx)} ${t(ctx, 'currency_toman')}`,
                },
              ]
            : []),
          {
            label: t(ctx, 'admin_user_transactions_label'),
            value: localizedNumber(summary.totalTransactions, ctx),
          },
        ],
      },
      {
        title: t(ctx, 'admin_user_reports_activity_section'),
        fields: [
          {
            label: t(ctx, 'admin_user_reports_configs_stat_label'),
            value: tm(ctx, 'admin_user_reports_configs_stat_value', {
              active: localizedNumber(summary.activeConfigsCount, ctx),
              total: localizedNumber(summary.totalConfigsCount, ctx),
            }),
          },
          {
            label: t(ctx, 'admin_user_reports_total_orders_label'),
            value: localizedNumber(summary.totalOrdersCount, ctx),
          },
          ...(summary.totalLuckyWheel > 0
            ? [
                {
                  label: t(ctx, 'admin_user_reports_lucky_wheel_label'),
                  value: `${localizedNumber(summary.totalLuckyWheel, ctx)} ${t(ctx, 'currency_toman')}`,
                },
              ]
            : []),
        ],
      },
      {
        title: t(ctx, 'admin_user_reports_receipts_section'),
        fields: [
          {
            label: t(ctx, 'admin_user_reports_receipts_stat_label'),
            value: tm(ctx, 'admin_user_reports_receipts_stat_value', {
              approved: localizedNumber(summary.receiptsApprovedCount, ctx),
              rejected: localizedNumber(summary.receiptsRejectedCount, ctx),
              pending: localizedNumber(summary.receiptsPendingCount, ctx),
            }),
          },
        ],
      },
      {
        title: t(ctx, 'admin_user_reports_referral_section'),
        fields: [
          {
            label: t(ctx, 'admin_user_referred_count_label'),
            value: localizedNumber(summary.user.referredUserCount, ctx),
          },
          {
            label: t(ctx, 'admin_user_referral_bonus_label'),
            value: `${localizedNumber(summary.totalReferralBonus, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_user_cashback_label'),
            value: `${localizedNumber(summary.totalCashback, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
    ],
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
  const breadcrumb = buildBreadcrumb(
    t(ctx, 'admin_home_title'),
    t(ctx, 'admin_user_reports_title'),
    t(ctx, 'admin_user_ledger_title')
  );

  if (result.transactions.length === 0) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: `adm:usr:rep:${targetId}`,
      backLabel: t(ctx, 'admin_user_report_btn_back_hub'),
      showHome: true,
    });
    await renderUserScreen(
      ctx,
      buildAdminEmptyState(
        '💳',
        t(ctx, 'admin_user_ledger_title'),
        t(ctx, 'admin_user_ledger_empty'),
        {
          breadcrumb,
        }
      ),
      kb,
      'Markdown'
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  appendAdminPagination(keyboard, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => `adm:usr:rep:ledger:${targetId}:${p}`,
  });
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: `adm:usr:rep:${targetId}`,
    backLabel: t(ctx, 'admin_user_report_btn_back_hub'),
    showHome: true,
  });

  const isFa = resolveContextLocale(ctx) === 'fa';
  const screen = buildAdminScreen({
    emoji: '💳',
    title: t(ctx, 'admin_user_ledger_title'),
    breadcrumb,
    subtitle: t(ctx, 'admin_user_audit_subtitle', { telegram_id: targetId }),
    sections: result.transactions.map((tx) => {
      const icon = transactionIcon(tx.type, tx.amount);
      const sign = tx.amount > 0 ? (isFa ? '\u200e+' : '+') : '';
      const typeKey = TRANSACTION_TYPE_MAP[tx.type];
      const typeLabel = typeKey ? t(ctx, typeKey) : escapeTelegramMarkdown(tx.type);
      return {
        emoji: icon,
        title: `${typeLabel} · ${localizedDateTime(new Date(tx.createdAt), ctx)}`,
        fields: [
          {
            label: t(ctx, 'wallet_pending_amount'),
            value: `${sign}${localizedNumber(tx.amount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'wallet_transfer_balance_after_label'),
            value: `${localizedNumber(tx.balanceAfter, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          ...(tx.referenceId
            ? [
                {
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
  const breadcrumb = buildBreadcrumb(
    t(ctx, 'admin_home_title'),
    t(ctx, 'admin_user_reports_title'),
    t(ctx, 'admin_user_orders_title')
  );

  if (result.orders.length === 0) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: `adm:usr:rep:${targetId}`,
      backLabel: t(ctx, 'admin_user_report_btn_back_hub'),
      showHome: true,
    });
    await renderUserScreen(
      ctx,
      buildAdminEmptyState(
        '🛍️',
        t(ctx, 'admin_user_orders_title'),
        t(ctx, 'admin_user_orders_empty'),
        {
          breadcrumb,
        }
      ),
      kb,
      'Markdown'
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  appendAdminPagination(keyboard, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => `adm:usr:rep:orders:${targetId}:${p}`,
  });
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: `adm:usr:rep:${targetId}`,
    backLabel: t(ctx, 'admin_user_report_btn_back_hub'),
    showHome: true,
  });

  const screen = buildAdminScreen({
    emoji: '🛍️',
    title: t(ctx, 'admin_user_orders_title'),
    breadcrumb,
    subtitle: t(ctx, 'admin_user_audit_subtitle', { telegram_id: targetId }),
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
        title: `${typeLabel} · ${localizedDateTime(new Date(order.createdAt), ctx)}`,
        fields: [
          {
            label: t(ctx, 'checkout_total_label'),
            value: `${localizedNumber(order.amount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          ...(order.gbAmount && order.durationDays
            ? [
                {
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
                  label: t(ctx, 'admin_user_order_config_label'),
                  value: `\`${sanitizeTelegramInlineCode(order.configUsername)}\``,
                },
              ]
            : []),
          {
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
  const breadcrumb = buildBreadcrumb(
    t(ctx, 'admin_home_title'),
    t(ctx, 'admin_user_reports_title'),
    t(ctx, 'admin_user_receipts_title')
  );

  if (result.receipts.length === 0) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: `adm:usr:rep:${targetId}`,
      backLabel: t(ctx, 'admin_user_report_btn_back_hub'),
      showHome: true,
    });
    await renderUserScreen(
      ctx,
      buildAdminEmptyState(
        '🧾',
        t(ctx, 'admin_user_receipts_title'),
        t(ctx, 'admin_user_receipts_empty'),
        { breadcrumb }
      ),
      kb,
      'Markdown'
    );
    return;
  }

  // Record return path so tapping a receipt from user history can jump straight back.
  pushAdminNav(ctx.session, `adm:usr:rep:receipts:${targetId}:${result.page}`);

  const keyboard = new InlineKeyboard();
  const actionable = result.receipts.filter(
    (rec) => rec.status === 'pending' || rec.status === 'approved' || rec.status === 'voided'
  );
  actionable.forEach((rec, idx) => {
    const shortId = formatReceiptShortId(rec.id);
    const cb =
      rec.status === 'pending'
        ? callbackData('adm', 'rcpt', 'v', rec.id, 1)
        : callbackData('adm', 'rcpt', 'va', rec.id, 1);
    keyboard.text(t(ctx, 'admin_user_view_receipt_button', { short_id: shortId }), cb);
    if (idx % 2 === 1 || idx === actionable.length - 1) keyboard.row();
  });

  appendAdminPagination(keyboard, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => `adm:usr:rep:receipts:${targetId}:${p}`,
  });
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: `adm:usr:rep:${targetId}`,
    backLabel: t(ctx, 'admin_user_report_btn_back_hub'),
    showHome: true,
  });

  const screen = buildAdminScreen({
    emoji: '🧾',
    title: t(ctx, 'admin_user_receipts_title'),
    breadcrumb,
    subtitle: t(ctx, 'admin_user_audit_subtitle', { telegram_id: targetId }),
    sections: result.receipts.map((rec) => {
      let statusEmoji = '✅';
      let statusLabel = t(ctx, 'admin_user_receipt_status_approved');
      if (rec.status === 'rejected') {
        statusEmoji = '❌';
        statusLabel = t(ctx, 'admin_user_receipt_status_rejected');
      } else if (rec.status === 'pending') {
        statusEmoji = '⏳';
        statusLabel = t(ctx, 'admin_user_receipt_status_pending');
      } else if (rec.status === 'voided') {
        statusEmoji = '🚫';
        statusLabel = t(ctx, 'admin_user_receipt_status_voided');
      }

      return {
        emoji: statusEmoji,
        title: `${statusLabel} · ${localizedDateTime(new Date(rec.createdAt), ctx)}`,
        fields: [
          {
            label: t(ctx, 'receipt_result_amount_label'),
            value: `${localizedNumber(rec.amount, ctx)} ${t(ctx, 'currency_toman')}`,
          },
          {
            label: t(ctx, 'admin_receipt_id_label'),
            value: `\`${sanitizeTelegramInlineCode(rec.id)}\``,
          },
          ...(rec.reviewedBy
            ? [
                {
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
  const breadcrumb = buildBreadcrumb(
    t(ctx, 'admin_home_title'),
    t(ctx, 'admin_user_reports_title'),
    t(ctx, 'admin_user_audit_tab_title')
  );

  if (result.logs.length === 0) {
    const kb = new InlineKeyboard();
    appendAdminFooterNav(kb, ctx, {
      backCallback: `adm:usr:rep:${targetId}`,
      backLabel: t(ctx, 'admin_user_report_btn_back_hub'),
      showHome: true,
    });
    await renderUserScreen(
      ctx,
      buildAdminEmptyState(
        '🛡️',
        t(ctx, 'admin_user_audit_tab_title'),
        t(ctx, 'admin_user_no_audit'),
        {
          breadcrumb,
        }
      ),
      kb,
      'Markdown'
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  appendAdminPagination(keyboard, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => `adm:usr:rep:audit:${targetId}:${p}`,
  });
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: `adm:usr:rep:${targetId}`,
    backLabel: t(ctx, 'admin_user_report_btn_back_hub'),
    showHome: true,
  });

  const screen = buildAdminScreen({
    emoji: '🛡️',
    title: t(ctx, 'admin_user_audit_tab_title'),
    breadcrumb,
    subtitle: t(ctx, 'admin_user_audit_subtitle', { telegram_id: targetId }),
    sections: result.logs.map((log) => {
      const actionLabel = formatAuditAction(ctx, log.action);
      const actionEmoji = getAuditActionEmoji(log.action);
      const actorLabel = formatAuditActor(ctx, log.actorTelegramId);
      const details = formatAuditMetadata(ctx, log.metadata);
      return {
        emoji: actionEmoji,
        title: `${actionLabel} · ${localizedDateTime(new Date(log.createdAt), ctx)}`,
        fields: [
          {
            label: t(ctx, 'admin_user_receipt_reviewer_label'),
            value: actorLabel,
          },
          ...(details
            ? [
                {
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
    buildAdminScreen({
      emoji: '💳',
      title: t(ctx, 'admin_user_wallet_section'),
      breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_users_list_title')),
      subtitle: t(ctx, 'admin_user_quick_topup_confirm', {
        telegram_id: targetId,
        amount: localizedNumber(amount, ctx),
      }),
      primary: {
        label: t(ctx, 'admin_balance_add'),
        value: `${localizedNumber(amount, ctx)} ${t(ctx, 'currency_toman')}`,
        inline: true,
        emphasizeValue: true,
      },
      sections: [
        {
          fields: [
            {
              label: t(ctx, 'admin_user_id_label'),
              value: `\`${targetId}\``,
            },
          ],
        },
      ],
      footer: t(ctx, 'admin_user_quick_topup_consequence'),
    }),
    buildAdminConfirmKeyboard(ctx, {
      confirmCallback: callbackData('admin', 'q', token),
      cancelCallback: `adm:usr:v:${targetId}`,
    }),
    'Markdown'
  );
}

async function renderUserScreen(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard,
  parseMode: 'Markdown' | undefined = 'Markdown'
): Promise<void> {
  await renderScreen(ctx, text, {
    parse_mode: parseMode,
    reply_markup: keyboard,
  });
}
