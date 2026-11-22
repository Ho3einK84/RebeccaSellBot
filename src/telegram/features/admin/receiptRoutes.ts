import { InlineKeyboard, type Bot } from 'grammy';
import type { MenuContext } from '../../types.js';
import { localizedDateTime, localizedNumber, resolveContextLocale, t } from '../../locale.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  guardAdminCallbacks,
  isMessageEditUnavailableError,
  isMessageNotModifiedError,
  rememberArtifactMessage,
  renderScreen,
  type AdminScreenNotice,
} from '../../ui.js';
import { callbackData } from '../../callbackData.js';
import { receiptDuplicatePolicy } from '../../../domain/services/FeatureSettings.js';
import { TopupVoidError } from '../../../domain/services/WalletContracts.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../rendering.js';
import {
  sendReceiptApprovalNotification,
  sendReceiptRejectionNotification,
  sendReceiptVoidedNotification,
} from './adminNotifications.js';
import { formatCardNumberGrouped } from '../../conversations/adminConversations/wallet.js';
import {
  appendAdminFooterNav,
  appendAdminPagination,
  buildAdminConfirmKeyboard,
  markAdminContext,
  peekAdminNav,
  pushAdminNav,
} from '../../admin/adminNav.js';
import { dispatchAdminRoute, registerAdminRoute } from '../../admin/adminRouter.js';
import { registerAdminInputHandler, startAdminInput } from '../../admin/adminInput.js';

const RECEIPT_PAGE_SIZE = 4;
const RECEIPT_ID_CAPTURE = '([a-zA-Z0-9_-]+)';
const TELEGRAM_CAPTION_LIMIT = 1020;

type PendingReceipt = {
  id: string;
  telegramId: number;
  amount: number;
  photoFileId?: string;
  mediaType?: 'photo' | 'document';
  status?: string;
  duplicateOfReceiptId?: string | null;
  cardId?: string | null;
  cardNumber?: string | null;
  voidedAt?: Date | null;
  voidedBy?: number | null;
  voidReason?: string | null;
  createdAt?: Date;
};

type ReceiptPage = {
  items: PendingReceipt[];
  total: number;
  page: number;
  totalPages: number;
};

export async function showReceiptQueue(
  ctx: MenuContext,
  requestedPage = 1,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const result = (await ctx.services.walletService.listPendingTopupsPage(
    requestedPage,
    RECEIPT_PAGE_SIZE
  )) as ReceiptPage;
  const breadcrumb = buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_receipts'));

  if (result.items.length === 0) {
    const emptyKb = new InlineKeyboard()
      .text(t(ctx, 'admin_receipt_history_button'), 'adm:rcpt:h:1')
      .text(t(ctx, 'admin_sales_bank_cards_button'), 'adm:rcpt:cards')
      .row();
    appendAdminFooterNav(emptyKb, ctx, {
      backCallback: 'adm:home',
      backLabel: t(ctx, 'admin_menu_back_to_admin'),
    });
    await renderReceiptText(
      ctx,
      buildAdminEmptyState(
        '📭',
        t(ctx, 'admin_receipt_queue_empty_title'),
        t(ctx, 'admin_receipt_queue_empty_body'),
        { breadcrumb, notice }
      ),
      emptyKb
    );
    return;
  }

  await renderReceiptText(
    ctx,
    buildReceiptQueueScreen(ctx, result, notice),
    buildReceiptQueueKeyboard(ctx, result)
  );
}

export type ReceiptRejectReason =
  'unclear' | 'not_received' | 'duplicate' | 'amount_mismatch' | 'other';

const REJECT_REASON_CODES: Record<ReceiptRejectReason, string> = {
  unclear: 'u',
  not_received: 'n',
  duplicate: 'd',
  amount_mismatch: 'a',
  other: 'o',
};

const REJECT_CODE_TO_REASON: Record<string, ReceiptRejectReason> = {
  u: 'unclear',
  n: 'not_received',
  d: 'duplicate',
  a: 'amount_mismatch',
  o: 'other',
  unclear: 'unclear',
  not_received: 'not_received',
  duplicate: 'duplicate',
  amount_mismatch: 'amount_mismatch',
  other: 'other',
};

function registerReceiptInputHandlers(): void {
  registerAdminInputHandler('rcpt:h:search', async (ctx, rawText) => {
    const trimmed = rawText.trim();
    if (ctx.session) {
      ctx.session.adminReceiptHistorySearch = trimmed || undefined;
    }
    return { status: 'done', redirectRoute: 'adm:rcpt:h:1' };
  });
}

export function registerReceiptAdminRoutes(bot: Bot<MenuContext>): void {
  const adminCallback = guardAdminCallbacks(bot);
  registerReceiptInputHandlers();

  // Unified `adm:rcpt:*` routes
  registerAdminRoute(/^adm:rcpt:q:(\d+)$/u, async (ctx, match, notice) => {
    await showReceiptQueue(ctx, Number(match?.[1]) || 1, notice);
  });

  registerAdminRoute(
    new RegExp(`^adm:rcpt:v:${RECEIPT_ID_CAPTURE}:(\\d+)$`, 'u'),
    async (ctx, match) => {
      await showReceiptReview(ctx, match![1]!, Number(match![2]) || 1);
    }
  );

  registerAdminRoute(
    new RegExp(`^adm:rcpt:ok:${RECEIPT_ID_CAPTURE}:(\\d+)$`, 'u'),
    async (ctx, match) => {
      await executeQuickApprove(ctx, match![1]!, Number(match![2]) || 1);
    }
  );

  registerAdminRoute(
    new RegExp(`^adm:rcpt:rp:${RECEIPT_ID_CAPTURE}:(\\d+)$`, 'u'),
    async (ctx, match) => {
      await promptReceiptReview(ctx, 'reject', match![1]!, Number(match![2]) || 1, false);
    }
  );

  registerAdminRoute(
    new RegExp(`^adm:rcpt:rej:${RECEIPT_ID_CAPTURE}:(\\d+):([a-z_]+)$`, 'u'),
    async (ctx, match) => {
      await executeRejectWithReason(
        ctx,
        match![1]!,
        Number(match![2]) || 1,
        REJECT_CODE_TO_REASON[match![3]!] ?? 'other'
      );
    }
  );

  registerAdminRoute(/^adm:rcpt:h:(\d+)$/u, async (ctx, match, notice) => {
    await showApprovedReceiptHistory(ctx, Number(match?.[1]) || 1, notice);
  });

  registerAdminRoute('adm:rcpt:h:search', async (ctx) => {
    await startAdminInput(ctx, {
      kind: 'rcpt:h:search',
      returnRoute: 'adm:rcpt:h:1',
      promptText: buildAdminPromptScreen(
        '🔍',
        t(ctx, 'admin_receipt_history_search_button'),
        t(ctx, 'admin_receipt_history_search_prompt'),
        {
          breadcrumb: buildBreadcrumb(
            t(ctx, 'admin_home_title'),
            t(ctx, 'admin_nav_receipts'),
            t(ctx, 'admin_receipt_history_button')
          ),
        }
      ),
    });
  });

  registerAdminRoute('adm:rcpt:h:clear', async (ctx) => {
    if (ctx.session) {
      delete ctx.session.adminReceiptHistorySearch;
    }
    await showApprovedReceiptHistory(ctx, 1);
  });

  registerAdminRoute(
    new RegExp(`^adm:rcpt:va:${RECEIPT_ID_CAPTURE}(?::(\\d+))?$`, 'u'),
    async (ctx, match) => {
      await showApprovedReceiptDetail(ctx, match![1]!, Number(match![2]) || 1);
    }
  );

  registerAdminRoute(
    new RegExp(`^adm:rcpt:vp:${RECEIPT_ID_CAPTURE}(?::(\\d+))?$`, 'u'),
    async (ctx, match) => {
      await promptReceiptVoid(ctx, match![1]!, Number(match![2]) || 1);
    }
  );

  registerAdminRoute(
    new RegExp(`^adm:rcpt:vc:${RECEIPT_ID_CAPTURE}:(\\d+):([01])$`, 'u'),
    async (ctx, match) => {
      await executeReceiptVoid(ctx, match![1]!, Number(match![2]) || 1, match![3] === '1');
    }
  );

  registerAdminRoute(/^adm:rcpt:batch:(\d+)$/u, async (ctx, match) => {
    await showBatchApprovePrompt(ctx, Number(match?.[1]) || 1);
  });

  registerAdminRoute('adm:rcpt:batch_ok', async (ctx) => {
    await executeBatchApprove(ctx);
  });

  registerAdminRoute('adm:rcpt:cards', async (ctx) => {
    if (ctx.session) {
      ctx.session.bankCardsReturnTo = 'receipts';
    }
    if (await dispatchAdminRoute(ctx, 'adm:bc:p:1')) return;
    if (typeof ctx.conversation?.enter === 'function') {
      await ctx.conversation.enter('adminBankCardsConversation');
      return;
    }
    await showBankCardsSummary(ctx);
  });

  // Backward-compatible legacy callback routes
  adminCallback(/^receipt:page:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showReceiptQueue(ctx, Number(ctx.match[1]) || 1);
  });

  adminCallback(new RegExp(`^receipt:view:${RECEIPT_ID_CAPTURE}:(\\d+)$`, 'u'), async (ctx) => {
    await showReceiptReview(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
  });

  adminCallback(/^rcpt:hist:(\d+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showApprovedReceiptHistory(ctx, Number(ctx.match[1]) || 1);
  });

  adminCallback(new RegExp(`^rcpt:va:${RECEIPT_ID_CAPTURE}(?::(\\d+))?$`, 'u'), async (ctx) => {
    await showApprovedReceiptDetail(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
  });

  adminCallback(new RegExp(`^rcpt:vp:${RECEIPT_ID_CAPTURE}(?::(\\d+))?$`, 'u'), async (ctx) => {
    await promptReceiptVoid(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
  });

  adminCallback(new RegExp(`^rcpt:vc:${RECEIPT_ID_CAPTURE}:(\\d+):([01])$`, 'u'), async (ctx) => {
    await executeReceiptVoid(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1, ctx.match[3] === '1');
  });

  adminCallback('rcpt:cards', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.session) {
      ctx.session.bankCardsReturnTo = 'receipts';
    }
    if (await dispatchAdminRoute(ctx, 'adm:bc:p:1')) return;
    if (typeof ctx.conversation?.enter === 'function') {
      await ctx.conversation.enter('adminBankCardsConversation');
      return;
    }
    await showBankCardsSummary(ctx);
  });

  adminCallback(/^(?:receipt:quick_approve|rcpt:qa):([a-zA-Z0-9_-]+)(?::(\d+))?$/u, async (ctx) => {
    await executeQuickApprove(ctx, ctx.match[1]!, Number(ctx.match[2]) || 1);
  });

  adminCallback(
    /^(?:receipt:(approve|reject)_prompt|rcpt:(ap|rp)):([a-zA-Z0-9_-]+)(?::(\d+))?$/u,
    async (ctx) => {
      const action = ctx.match[1] ?? (ctx.match[2] === 'ap' ? 'approve' : 'reject');
      await promptReceiptReview(ctx, action, ctx.match[3]!, Number(ctx.match[4]) || 1, false);
    }
  );

  adminCallback(
    /^(?:receipt:reject_confirm|rcpt:rej):([a-zA-Z0-9_-]+):(\d+):([a-z_]+)$/u,
    async (ctx) => {
      await executeRejectWithReason(
        ctx,
        ctx.match[1]!,
        Number(ctx.match[2]) || 1,
        REJECT_CODE_TO_REASON[ctx.match[3]!] ?? 'other'
      );
    }
  );

  adminCallback(
    /^(?:receipt:(approve|reject)_confirm|rcpt:(ac|rc)):([a-zA-Z0-9_-]+)(?::(\d+))?$/u,
    async (ctx) => {
      if (!ctx.services) return;
      const action = (ctx.match[1] ?? (ctx.match[2] === 'ac' ? 'approve' : 'reject')) as
        'approve' | 'reject';
      const receiptId = ctx.match[3]!;
      const page = Number(ctx.match[4]) || 1;
      await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') });

      if (action === 'approve') {
        const result = await ctx.services.walletService.approveTopup(receiptId, ctx.from.id);
        if (result) {
          await notifyReceiptResult(ctx, result.telegramId, true, result.amount, receiptId);
          await renderReceiptResult(ctx, 'approve', page, undefined, receiptId, result.telegramId);
        } else {
          await renderReceiptAlreadyReviewed(ctx, page);
        }
        return;
      }

      const result = await ctx.services.walletService.rejectTopup(receiptId, ctx.from.id);
      if (result) {
        await notifyReceiptResult(ctx, result.telegramId, false, undefined, receiptId, 'other');
        await renderReceiptResult(ctx, 'reject', page, 'other', undefined, result.telegramId);
      } else {
        await renderReceiptAlreadyReviewed(ctx, page);
      }
    }
  );

  adminCallback(/^receipt:batch_prompt:(\d+)$/u, async (ctx) => {
    await showBatchApprovePrompt(ctx, Number(ctx.match[1]) || 1);
  });

  adminCallback('receipt:batch_confirm', async (ctx) => {
    await executeBatchApprove(ctx);
  });

  // Convert buttons emitted before the confirmation refactor into review screens.
  adminCallback(/^receipt-(approve|reject):([a-zA-Z0-9_-]+)$/u, async (ctx) => {
    await promptReceiptReview(ctx, ctx.match[1]!, ctx.match[2]!, 1, true);
  });
}

async function executeQuickApprove(
  ctx: MenuContext,
  receiptId: string,
  page: number
): Promise<void> {
  if (!ctx.services || !ctx.from) return;
  protectPushNotificationMedia(ctx);
  await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') }).catch(() => {});

  const result = await ctx.services.walletService.approveTopup(receiptId, ctx.from.id);
  if (result) {
    await notifyReceiptResult(ctx, result.telegramId, true, result.amount, receiptId);
    await renderReceiptResult(ctx, 'approve', page, undefined, receiptId, result.telegramId);
  } else {
    await renderReceiptAlreadyReviewed(ctx, page);
  }
}

async function executeRejectWithReason(
  ctx: MenuContext,
  receiptId: string,
  page: number,
  reason: ReceiptRejectReason
): Promise<void> {
  if (!ctx.services || !ctx.from) return;
  protectPushNotificationMedia(ctx);
  await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') }).catch(() => {});

  const reasonLabel = t(ctx, `admin_receipt_reject_reason_${reason}`);
  const result = await ctx.services.walletService.rejectTopup(receiptId, ctx.from.id, reasonLabel);
  if (result) {
    await notifyReceiptResult(ctx, result.telegramId, false, undefined, receiptId, reason);
    await renderReceiptResult(ctx, 'reject', page, reason, undefined, result.telegramId);
  } else {
    await renderReceiptAlreadyReviewed(ctx, page);
  }
}

async function showBatchApprovePrompt(ctx: MenuContext, page: number): Promise<void> {
  if (!ctx.services) return;
  const result = (await ctx.services.walletService.listPendingTopupsPage(
    page,
    RECEIPT_PAGE_SIZE
  )) as ReceiptPage;
  if (result.items.length === 0) {
    await ctx
      .answerCallbackQuery({ text: t(ctx, 'admin_receipt_queue_empty_title') })
      .catch(() => {});
    await showReceiptQueue(ctx, 1);
    return;
  }
  ctx.session.adminReceiptBatch = { ids: result.items.map((item) => item.id), page: result.page };
  await ctx.answerCallbackQuery().catch(() => {});
  const totalAmount = result.items.reduce((sum, item) => sum + item.amount, 0);
  await renderReceiptText(
    ctx,
    buildAdminScreen({
      emoji: '✅',
      title: t(ctx, 'admin_receipt_batch_title'),
      breadcrumb: buildBreadcrumb(
        t(ctx, 'admin_home_title'),
        t(ctx, 'admin_nav_receipts'),
        t(ctx, 'admin_receipt_batch_title')
      ),
      subtitle: t(ctx, 'admin_receipt_batch_subtitle'),
      primary: {
        label: t(ctx, 'admin_receipt_batch_total_label'),
        value: `${localizedNumber(totalAmount, ctx)} ${t(ctx, 'currency_toman')}`,
        inline: true,
        emphasizeValue: true,
      },
      sections: [
        {
          fields: [
            {
              label: t(ctx, 'admin_receipt_batch_count_label'),
              value: localizedNumber(result.items.length, ctx),
            },
          ],
        },
      ],
    }),
    buildAdminConfirmKeyboard(ctx, {
      confirmCallback: 'adm:rcpt:batch_ok',
      cancelCallback: `adm:rcpt:q:${result.page}`,
      confirmLabel: t(ctx, 'admin_receipt_batch_confirm_button'),
    })
  );
}

async function executeBatchApprove(ctx: MenuContext): Promise<void> {
  if (!ctx.services || !ctx.from) return;
  const batch = ctx.session.adminReceiptBatch;
  delete ctx.session.adminReceiptBatch;
  if (!batch || batch.ids.length === 0) {
    await ctx
      .answerCallbackQuery({ text: t(ctx, 'button_action_failed'), show_alert: true })
      .catch(() => {});
    return;
  }
  await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') }).catch(() => {});
  let approved = 0;
  for (const receiptId of batch.ids) {
    const result = await ctx.services.walletService.approveTopup(receiptId, ctx.from.id);
    if (!result) continue;
    approved += 1;
    await notifyReceiptResult(ctx, result.telegramId, true, result.amount, receiptId);
  }
  await showReceiptQueue(ctx, batch.page, {
    tone: 'success',
    text: t(ctx, 'admin_receipt_batch_result_subtitle', {
      count: localizedNumber(approved, ctx),
    }),
  });
}

async function showReceiptReview(ctx: MenuContext, receiptId: string, page: number): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  protectPushNotificationMedia(ctx);
  const receipt = (await ctx.services.walletService.getPendingTopup(receiptId)) as
    PendingReceipt | undefined;
  if (!receipt) {
    const existing =
      typeof ctx.services.walletService.getTopupById === 'function'
        ? ((await ctx.services.walletService.getTopupById(receiptId)) as PendingReceipt | undefined)
        : undefined;
    if (existing && (existing.status === 'approved' || existing.status === 'voided')) {
      await showApprovedReceiptDetail(ctx, receiptId, page);
      return;
    }
    await ctx
      .answerCallbackQuery({ text: t(ctx, 'receipt_already_reviewed'), show_alert: true })
      .catch(() => {});
    await showReceiptQueue(ctx, page);
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});
  pushAdminNav(ctx.session, callbackData('adm', 'rcpt', 'v', receipt.id, page));

  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_receipt_approve'), callbackData('adm', 'rcpt', 'ok', receipt.id, page))
    .text(t(ctx, 'admin_receipt_reject'), callbackData('adm', 'rcpt', 'rp', receipt.id, page))
    .row()
    .text(t(ctx, 'admin_receipt_view_user_button'), `adm:usr:v:${receipt.telegramId}`);
  if (receipt.duplicateOfReceiptId) {
    keyboard.text(
      t(ctx, 'admin_receipt_view_duplicate_button'),
      callbackData('adm', 'rcpt', 'va', receipt.duplicateOfReceiptId, 1)
    );
  }
  keyboard.row();
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: `adm:rcpt:q:${page}`,
    backLabel: t(ctx, 'admin_receipt_back_queue'),
    showHome: true,
  });

  const text = trimTelegramCaption(buildReceiptReviewScreen(ctx, receipt));

  // If we're already on a media callback (e.g. Cancel from Reject Reason on the same photo),
  // edit caption in-place instead of re-sending a duplicate photo!
  if (isMediaCallback(ctx)) {
    await renderReceiptCaptionOrText(ctx, text, keyboard);
    return;
  }

  if (receipt.photoFileId) {
    try {
      if (receipt.mediaType === 'document') {
        await ctx.replyWithDocument(receipt.photoFileId, {
          caption: text,
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      } else {
        await ctx.replyWithPhoto(receipt.photoFileId, {
          caption: text,
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      }
      return;
    } catch {
      // Fallback safely to text card if file_id cannot be delivered
    }
  }
  await renderReceiptText(ctx, text, keyboard);
}

async function showApprovedReceiptHistory(
  ctx: MenuContext,
  requestedPage = 1,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  if (typeof ctx.services.walletService.listTopupsPage !== 'function') {
    await showReceiptQueue(ctx, 1);
    return;
  }
  const search = ctx.session?.adminReceiptHistorySearch?.trim() || undefined;
  const result = await ctx.services.walletService.listTopupsPage({
    page: requestedPage,
    pageSize: RECEIPT_PAGE_SIZE,
    status: 'approved',
    search,
  });
  const breadcrumb = buildBreadcrumb(
    t(ctx, 'admin_home_title'),
    t(ctx, 'admin_nav_receipts'),
    t(ctx, 'admin_receipt_history_button')
  );

  if (result.items.length === 0) {
    const emptyKb = new InlineKeyboard();
    if (search) {
      emptyKb.text(t(ctx, 'admin_receipt_history_clear_search'), 'adm:rcpt:h:clear').row();
    } else {
      emptyKb.text(t(ctx, 'admin_receipt_history_search_button'), 'adm:rcpt:h:search').row();
    }
    appendAdminFooterNav(emptyKb, ctx, {
      backCallback: 'adm:rcpt:q:1',
      backLabel: t(ctx, 'admin_receipt_back_queue'),
      showHome: true,
    });
    await renderReceiptText(
      ctx,
      buildAdminEmptyState(
        '📭',
        t(ctx, 'admin_receipt_history_button'),
        t(ctx, 'admin_receipt_history_empty'),
        {
          breadcrumb,
          notice,
        }
      ),
      emptyKb
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const receipt of result.items) {
    const shortId = formatReceiptShortId(receipt.id);
    keyboard
      .text(
        t(ctx, 'admin_receipt_queue_item_label', {
          amount: localizedNumber(receipt.amount, ctx),
          telegram_id: receipt.telegramId,
          short_id: shortId,
        }),
        callbackData('adm', 'rcpt', 'va', receipt.id, result.page)
      )
      .row();
  }
  appendAdminPagination(keyboard, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => `adm:rcpt:h:${p}`,
  });

  if (search) {
    keyboard
      .text(t(ctx, 'admin_receipt_history_clear_search'), 'adm:rcpt:h:clear')
      .text(t(ctx, 'admin_receipt_history_search_button'), 'adm:rcpt:h:search')
      .row();
  } else {
    keyboard.text(t(ctx, 'admin_receipt_history_search_button'), 'adm:rcpt:h:search').row();
  }
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: 'adm:rcpt:q:1',
    backLabel: t(ctx, 'admin_receipt_back_queue'),
    showHome: true,
  });

  await renderReceiptText(
    ctx,
    buildAdminScreen({
      emoji: '📜',
      title: t(ctx, 'admin_receipt_history_button'),
      breadcrumb,
      subtitle: search
        ? `🔍 \`${sanitizeTelegramInlineCode(search)}\``
        : t(ctx, 'admin_receipt_history_subtitle'),
      notice,
      primary: {
        label: t(ctx, 'admin_user_receipt_status_approved'),
        value: localizedNumber(result.total, ctx),
        inline: true,
        emphasizeValue: true,
      },
      sections: [
        {
          fields: result.items.map((receipt) => {
            const shortId = formatReceiptShortId(receipt.id);
            const duplicateSuffix = receipt.duplicateOfReceiptId
              ? `\n${formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)}`
              : '';
            return {
              label: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
              value: `\`${receipt.telegramId}\` · \`#${shortId}\`${duplicateSuffix}`,
            };
          }),
        },
      ],
    }),
    keyboard
  );
}

async function showApprovedReceiptDetail(
  ctx: MenuContext,
  receiptId: string,
  page: number
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const receipt =
    typeof ctx.services.walletService.getTopupById === 'function'
      ? ((await ctx.services.walletService.getTopupById(receiptId)) as PendingReceipt | undefined)
      : undefined;
  if (!receipt) {
    await ctx
      .answerCallbackQuery({ text: t(ctx, 'admin_receipt_void_not_approved'), show_alert: true })
      .catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});
  const shortId = formatReceiptShortId(receipt.id);
  const duplicateBanner = receipt.duplicateOfReceiptId
    ? formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)
    : undefined;
  const isVoided = receipt.status === 'voided';
  const isApproved = receipt.status === 'approved';
  const statusText = isVoided
    ? t(ctx, 'admin_user_receipt_status_voided')
    : isApproved
      ? t(ctx, 'admin_user_receipt_status_approved')
      : receipt.status === 'rejected'
        ? t(ctx, 'admin_user_receipt_status_rejected')
        : t(ctx, 'admin_user_receipt_status_pending');

  const stackedOrigin = peekAdminNav(ctx.session);
  const backCallback =
    stackedOrigin && stackedOrigin.startsWith('adm:usr:') ? 'adm:back' : `adm:rcpt:h:${page}`;
  const backLabel =
    stackedOrigin && stackedOrigin.startsWith('adm:usr:')
      ? t(ctx, 'menu_back')
      : t(ctx, 'admin_receipt_back_history');

  pushAdminNav(ctx.session, callbackData('adm', 'rcpt', 'va', receipt.id, page));

  const keyboard = new InlineKeyboard();
  if (isApproved) {
    keyboard
      .text(t(ctx, 'admin_receipt_void_button'), callbackData('rcpt', 'vp', receipt.id, page))
      .row();
  }
  keyboard.text(t(ctx, 'admin_receipt_view_user_button'), `adm:usr:v:${receipt.telegramId}`).row();
  appendAdminFooterNav(keyboard, ctx, { backCallback, backLabel, showHome: true });

  const text = buildAdminScreen({
    emoji: isVoided ? '🚫' : '🧾',
    title: isVoided ? t(ctx, 'admin_receipt_void_title') : t(ctx, 'admin_receipt_review_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_nav_receipts'),
      t(ctx, 'admin_receipt_history_button')
    ),
    subtitle: statusText,
    notice: duplicateBanner ? { tone: 'warning', text: duplicateBanner } : undefined,
    primary: {
      label: t(ctx, 'admin_receipt_amount_label'),
      value: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
      inline: true,
      emphasizeValue: true,
    },
    sections: [
      {
        title: t(ctx, 'admin_receipt_user_section'),
        fields: [
          {
            label: t(ctx, 'admin_receipt_user_label'),
            value: `\`${receipt.telegramId}\``,
          },
          {
            label: t(ctx, 'admin_receipt_id_label'),
            value: `\`${receipt.id}\` (#${shortId})`,
          },
          {
            label: t(ctx, 'admin_receipt_created_label'),
            value: receipt.createdAt ? localizedDateTime(new Date(receipt.createdAt), ctx) : '—',
          },
        ],
      },
    ],
  });

  await renderReceiptCaptionOrText(ctx, text, keyboard);
}

async function promptReceiptVoid(ctx: MenuContext, receiptId: string, page: number): Promise<void> {
  if (!ctx.services) return;
  const receipt =
    typeof ctx.services.walletService.getTopupById === 'function'
      ? ((await ctx.services.walletService.getTopupById(receiptId)) as PendingReceipt | undefined)
      : undefined;

  if (!receipt || receipt.status !== 'approved') {
    await ctx
      .answerCallbackQuery({
        text: t(
          ctx,
          receipt?.status === 'voided'
            ? 'admin_receipt_void_already_voided'
            : 'admin_receipt_void_not_approved'
        ),
        show_alert: true,
      })
      .catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});
  const shortId = formatReceiptShortId(receipt.id);
  const currency = t(ctx, 'currency_toman');
  const duplicateBanner = receipt.duplicateOfReceiptId
    ? formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)
    : undefined;
  const confirmPrompt = t(ctx, 'admin_receipt_void_confirm_prompt', {
    short_id: shortId,
    amount: localizedNumber(receipt.amount, ctx),
    currency,
    telegram_id: String(receipt.telegramId),
  });

  const text = buildAdminScreen({
    emoji: '🚫',
    title: t(ctx, 'admin_receipt_void_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_nav_receipts'),
      t(ctx, 'admin_receipt_void_title')
    ),
    notice: duplicateBanner ? { tone: 'warning', text: duplicateBanner } : undefined,
    primary: {
      label: t(ctx, 'admin_receipt_amount_label'),
      value: `${localizedNumber(receipt.amount, ctx)} ${currency}`,
      inline: true,
      emphasizeValue: true,
    },
    sections: [
      {
        title: t(ctx, 'admin_receipt_user_section'),
        fields: [
          {
            label: t(ctx, 'admin_receipt_user_label'),
            value: `\`${receipt.telegramId}\``,
          },
          {
            label: t(ctx, 'admin_receipt_id_label'),
            value: `\`${receipt.id}\` (#${shortId})`,
          },
        ],
      },
    ],
    footer: confirmPrompt,
  });

  // Cancel properly returns to the parent Approved Receipt Detail screen!
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_receipt_void_only_button'), callbackData('rcpt', 'vc', receipt.id, page, 0))
    .row()
    .text(
      t(ctx, 'admin_receipt_void_and_disable_button'),
      callbackData('rcpt', 'vc', receipt.id, page, 1)
    )
    .row()
    .text(t(ctx, 'admin_receipt_view_user_button'), `adm:usr:v:${receipt.telegramId}`)
    .text(t(ctx, 'menu_cancel'), callbackData('rcpt', 'va', receipt.id, page));

  await renderReceiptCaptionOrText(ctx, text, keyboard);
}

async function executeReceiptVoid(
  ctx: MenuContext,
  receiptId: string,
  page: number,
  disablePurchasedConfigs: boolean
): Promise<void> {
  if (!ctx.services || !ctx.from) return;
  await ctx.answerCallbackQuery({ text: t(ctx, 'operation_in_progress') }).catch(() => {});

  const buildResultKeyboard = (targetUserId?: number) => {
    const kb = new InlineKeyboard();
    if (targetUserId) {
      kb.text(t(ctx, 'admin_receipt_view_user_button'), `adm:usr:v:${targetUserId}`).row();
    }
    kb.text(t(ctx, 'admin_receipt_back_history'), `adm:rcpt:h:${page}`)
      .text(t(ctx, 'admin_receipt_back_queue'), 'adm:rcpt:q:1')
      .row()
      .text(t(ctx, 'admin_menu_back_to_admin'), 'adm:home');
    return kb;
  };

  try {
    const result = await ctx.services.walletService.voidApprovedTopup({
      receiptId,
      adminId: ctx.from.id,
      disablePurchasedConfigs,
      disableConfig: (username, panelId) =>
        ctx.services!.configService.disableConfig(username, panelId),
    });

    if (result.alreadyVoided) {
      await renderReceiptCaptionOrText(
        ctx,
        buildAdminEmptyState(
          'ℹ️',
          t(ctx, 'admin_receipt_void_title'),
          t(ctx, 'admin_receipt_void_already_voided')
        ),
        buildResultKeyboard(result.telegramId)
      );
      return;
    }

    const shortId = formatReceiptShortId(result.receiptId);
    const currency = t(ctx, 'currency_toman');
    await sendReceiptVoidedNotification(ctx.api, ctx.services, {
      telegramId: result.telegramId,
      receiptId: result.receiptId,
      amount: result.originalAmount,
      deductedAmount: result.deductedAmount,
      disabledConfigsCount: result.disabledConfigs.length,
      shortId,
    });

    const subtitle =
      result.disabledConfigs.length > 0
        ? t(ctx, 'admin_receipt_void_success_with_disabled', {
            short_id: shortId,
            amount: localizedNumber(result.deductedAmount, ctx),
            currency,
            count: localizedNumber(result.disabledConfigs.length, ctx),
          })
        : t(ctx, 'admin_receipt_void_success', {
            short_id: shortId,
            amount: localizedNumber(result.deductedAmount, ctx),
            currency,
          });

    await renderReceiptCaptionOrText(
      ctx,
      buildAdminScreen({
        emoji: '🚫',
        title: t(ctx, 'admin_user_audit_action_receipt_voided'),
        breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_receipts')),
        notice: { tone: 'success', text: subtitle },
        primary: {
          label: t(ctx, 'tx_type_topup_void'),
          value: t(ctx, 'admin_user_receipt_status_voided'),
          inline: true,
        },
        sections: [
          {
            title: t(ctx, 'admin_receipt_user_section'),
            fields: [
              {
                label: t(ctx, 'admin_receipt_user_label'),
                value: `\`${result.telegramId}\``,
              },
              {
                label: t(ctx, 'admin_receipt_amount_label'),
                value: `${localizedNumber(result.deductedAmount, ctx)} ${currency}`,
              },
            ],
          },
        ],
      }),
      buildResultKeyboard(result.telegramId)
    );
  } catch (err) {
    if (
      err instanceof TopupVoidError ||
      (err instanceof Error &&
        ((err as { code?: string }).code === 'TOPUP_VOID_NOT_APPROVED' ||
          (err as { code?: string }).code === 'TOPUP_VOID_NOT_FOUND'))
    ) {
      await renderReceiptCaptionOrText(
        ctx,
        buildAdminEmptyState(
          '⚠️',
          t(ctx, 'admin_receipt_void_title'),
          t(ctx, 'admin_receipt_void_not_approved')
        ),
        buildResultKeyboard()
      );
      return;
    }
    throw err;
  }
}

async function showBankCardsSummary(ctx: MenuContext): Promise<void> {
  if (!ctx.services) return;
  const paymentService = ctx.services.paymentService;
  const configuredCards =
    typeof paymentService?.getConfiguredBankCards === 'function'
      ? paymentService.getConfiguredBankCards()
      : [];

  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_sales_bank_cards_add_button'), 'adm:rcpt:cards')
    .row();
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: 'adm:rcpt:q:1',
    backLabel: t(ctx, 'admin_receipt_back_queue'),
    showHome: true,
  });

  if (configuredCards.length === 0) {
    await renderReceiptText(
      ctx,
      buildAdminEmptyState(
        '💳',
        t(ctx, 'admin_sales_bank_cards_title'),
        t(ctx, 'admin_sales_bank_cards_empty')
      ),
      keyboard
    );
    return;
  }

  await renderReceiptText(
    ctx,
    buildAdminScreen({
      emoji: '💳',
      title: t(ctx, 'admin_sales_bank_cards_title'),
      breadcrumb: buildBreadcrumb(
        t(ctx, 'admin_home_title'),
        t(ctx, 'admin_nav_receipts'),
        t(ctx, 'admin_sales_bank_cards_title')
      ),
      primary: {
        label: t(ctx, 'admin_setting_bank_cards_json'),
        value: localizedNumber(configuredCards.length, ctx),
        inline: true,
      },
      sections: configuredCards.map((card) => ({
        emoji: card.enabled ? '🟢' : '⚪️',
        title: escapeTelegramMarkdown(card.bankName || card.cardHolder || card.id),
        fields: [
          {
            label: t(ctx, 'topup_card_number_label'),
            value: `\`${sanitizeTelegramInlineCode(formatCardNumberGrouped(card.cardNumber))}\``,
          },
          {
            label: t(ctx, 'topup_card_holder_label'),
            value: escapeTelegramMarkdown(card.cardHolder || '—'),
          },
        ],
      })),
    }),
    keyboard
  );
}

async function promptReceiptReview(
  ctx: MenuContext,
  action: 'approve' | 'reject' | string,
  receiptId: string,
  page = 1,
  isLegacyRefresh = false
): Promise<void> {
  if (!ctx.services) return;
  protectPushNotificationMedia(ctx);
  const receipt = (await ctx.services.walletService.getPendingTopup(receiptId)) as
    PendingReceipt | undefined;
  if (!receipt) {
    await ctx
      .answerCallbackQuery({ text: t(ctx, 'receipt_already_reviewed'), show_alert: true })
      .catch(() => {});
    return;
  }

  const normalizedAction = action === 'approve' ? 'approve' : 'reject';
  const duplicateBanner = receipt.duplicateOfReceiptId
    ? formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)
    : undefined;
  await ctx
    .answerCallbackQuery(isLegacyRefresh ? { text: t(ctx, 'button_refreshed') } : undefined)
    .catch(() => {});

  if (normalizedAction === 'reject') {
    const reasons: ReceiptRejectReason[] = [
      'unclear',
      'not_received',
      'duplicate',
      'amount_mismatch',
      'other',
    ];

    const keyboard = new InlineKeyboard();
    for (const reason of reasons) {
      keyboard
        .text(
          t(ctx, `admin_receipt_reject_reason_${reason}`),
          callbackData('adm', 'rcpt', 'rej', receipt.id, page, REJECT_REASON_CODES[reason])
        )
        .row();
    }
    keyboard.text(t(ctx, 'menu_cancel'), callbackData('adm', 'rcpt', 'v', receipt.id, page));

    const text = buildAdminScreen({
      emoji: '⛔',
      title: t(ctx, 'admin_receipt_reject_title'),
      breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_receipts')),
      subtitle: t(ctx, 'admin_receipt_reject_select_reason'),
      notice: duplicateBanner ? { tone: 'warning', text: duplicateBanner } : undefined,
      primary: {
        label: t(ctx, 'admin_receipt_amount_label'),
        value: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
        inline: true,
        emphasizeValue: true,
      },
      sections: [
        {
          title: t(ctx, 'admin_receipt_user_section'),
          fields: [
            { label: t(ctx, 'admin_receipt_id_label'), value: `\`${receipt.id}\`` },
            { label: t(ctx, 'admin_receipt_user_label'), value: `\`${receipt.telegramId}\`` },
          ],
        },
      ],
      footer: t(ctx, 'admin_receipt_reject_consequence'),
    });

    await renderReceiptCaptionOrText(ctx, text, keyboard);
    return;
  }

  const text = buildAdminScreen({
    emoji: '✅',
    title: t(ctx, 'admin_receipt_approve_title'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_receipts')),
    subtitle: t(ctx, 'admin_receipt_review_subtitle'),
    notice: duplicateBanner ? { tone: 'warning', text: duplicateBanner } : undefined,
    primary: {
      label: t(ctx, 'admin_receipt_amount_label'),
      value: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
      inline: true,
      emphasizeValue: true,
    },
    sections: [
      {
        title: t(ctx, 'admin_receipt_user_section'),
        fields: [
          { label: t(ctx, 'admin_receipt_id_label'), value: `\`${receipt.id}\`` },
          { label: t(ctx, 'admin_receipt_user_label'), value: `\`${receipt.telegramId}\`` },
        ],
      },
    ],
    footer: t(ctx, 'admin_receipt_approve_consequence'),
  });
  const keyboard = buildAdminConfirmKeyboard(ctx, {
    confirmCallback: callbackData('rcpt', 'ac', receipt.id, page),
    cancelCallback: callbackData('adm', 'rcpt', 'v', receipt.id, page),
  });
  await renderReceiptCaptionOrText(ctx, text, keyboard);
}

export function formatReceiptShortId(receiptId: string): string {
  const match = receiptId.match(/_([a-zA-Z0-9]{4,8})$/u);
  if (match) return match[1]!;
  return receiptId.length > 8 ? receiptId.slice(-6) : receiptId;
}

function formatReceiptDuplicateWarning(ctx: MenuContext, duplicateOfReceiptId: string): string {
  return t(ctx, 'admin_receipt_duplicate_warning', {
    short_id: formatReceiptShortId(duplicateOfReceiptId),
  });
}

function buildReceiptQueueScreen(
  ctx: MenuContext,
  result: ReceiptPage,
  notice?: AdminScreenNotice
): string {
  const duplicatePolicy = ctx.services?.translationService
    ? receiptDuplicatePolicy(ctx.services.translationService)
    : 'warn';
  const policyLabel = t(
    ctx,
    duplicatePolicy === 'block'
      ? 'admin_receipt_duplicate_policy_block'
      : 'admin_receipt_duplicate_policy_warn'
  );

  return buildAdminScreen({
    emoji: '🧾',
    title: t(ctx, 'admin_receipt_queue_title'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_receipts')),
    notice,
    primary: {
      label: t(ctx, 'admin_receipt_queue_pending_label'),
      value: `${buildStatusBadge(ctx, 'pending')} · ${localizedNumber(result.total, ctx)}`,
      inline: true,
    },
    sections: [
      {
        fields: result.items.map((receipt) => {
          const shortId = formatReceiptShortId(receipt.id);
          const duplicateSuffix = receipt.duplicateOfReceiptId
            ? `\n${formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)}`
            : '';
          return {
            emoji: receipt.duplicateOfReceiptId ? '⚠️' : undefined,
            label: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
            value: `\`${receipt.telegramId}\` · \`#${shortId}\`${duplicateSuffix}`,
          };
        }),
      },
    ],
    footer: `${t(ctx, 'admin_setting_receipt_duplicate_policy')}: ${policyLabel}`,
  });
}

function buildReceiptQueueKeyboard(ctx: MenuContext, result: ReceiptPage): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const receipt of result.items) {
    const shortId = formatReceiptShortId(receipt.id);
    const label = t(ctx, 'admin_receipt_queue_item_label', {
      amount: localizedNumber(receipt.amount, ctx),
      telegram_id: receipt.telegramId,
      short_id: shortId,
    });
    keyboard
      .text(
        receipt.duplicateOfReceiptId ? `⚠️ ${label}` : label,
        callbackData('adm', 'rcpt', 'v', receipt.id, result.page)
      )
      .row();
  }
  appendAdminPagination(keyboard, ctx, {
    page: result.page,
    totalPages: result.totalPages,
    pageCallback: (p) => `adm:rcpt:q:${p}`,
  });
  keyboard
    .text(
      t(ctx, 'admin_receipt_batch_page_button', {
        count: localizedNumber(result.items.length, ctx),
      }),
      `adm:rcpt:batch:${result.page}`
    )
    .row()
    .text(t(ctx, 'admin_receipt_history_button'), 'adm:rcpt:h:1')
    .text(t(ctx, 'admin_sales_bank_cards_button'), 'adm:rcpt:cards')
    .row();
  return appendAdminFooterNav(keyboard, ctx, {
    backCallback: 'adm:home',
    backLabel: t(ctx, 'admin_menu_back_to_admin'),
  });
}

function buildReceiptReviewScreen(ctx: MenuContext, receipt: PendingReceipt): string {
  const shortId = formatReceiptShortId(receipt.id);
  const duplicateBanner = receipt.duplicateOfReceiptId
    ? formatReceiptDuplicateWarning(ctx, receipt.duplicateOfReceiptId)
    : undefined;
  const locale = resolveContextLocale(ctx);
  const cardLabel =
    receipt.cardNumber || receipt.cardId
      ? (ctx.services?.paymentService?.resolveCardDisplayLabel?.(
          { cardId: receipt.cardId, cardNumber: receipt.cardNumber },
          locale
        ) ?? (receipt.cardNumber ? formatCardNumberGrouped(receipt.cardNumber) : null))
      : null;

  return buildAdminScreen({
    emoji: '🧾',
    title: t(ctx, 'admin_receipt_review_title'),
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_receipts')),
    notice: duplicateBanner ? { tone: 'warning', text: duplicateBanner } : undefined,
    primary: {
      label: t(ctx, 'admin_receipt_amount_label'),
      value: `${localizedNumber(receipt.amount, ctx)} ${t(ctx, 'currency_toman')}`,
      inline: true,
      emphasizeValue: true,
    },
    sections: [
      {
        title: t(ctx, 'admin_receipt_user_section'),
        fields: [
          {
            label: t(ctx, 'admin_receipt_user_label'),
            value: `\`${receipt.telegramId}\``,
          },
          {
            label: t(ctx, 'admin_receipt_id_label'),
            value: `\`${receipt.id}\` (#${shortId})`,
          },
          ...(cardLabel
            ? [
                {
                  label: t(ctx, 'admin_receipt_destination_card_label'),
                  value: escapeTelegramMarkdown(cardLabel),
                },
              ]
            : []),
          {
            label: t(ctx, 'admin_receipt_created_label'),
            value: receipt.createdAt ? localizedDateTime(new Date(receipt.createdAt), ctx) : '—',
          },
        ],
      },
    ],
    footer: `⚡ ${t(ctx, 'admin_receipt_approve_hint')}`,
  });
}

async function renderReceiptResult(
  ctx: MenuContext,
  action: 'approve' | 'reject',
  page: number,
  reason?: ReceiptRejectReason,
  approvedReceiptId?: string,
  targetUserId?: number
): Promise<void> {
  const reasonLabelKey = reason ? `admin_receipt_reject_reason_${reason}` : undefined;
  const reasonLabel = reasonLabelKey ? t(ctx, reasonLabelKey) : undefined;

  const keyboard = new InlineKeyboard();
  if (action === 'approve' && approvedReceiptId) {
    keyboard.text(
      t(ctx, 'admin_receipt_void_button'),
      callbackData('adm', 'rcpt', 'vp', approvedReceiptId, 1)
    );
  }
  if (targetUserId) {
    keyboard.text(t(ctx, 'admin_receipt_view_user_button'), `adm:usr:v:${targetUserId}`);
  }
  if ((action === 'approve' && approvedReceiptId) || targetUserId) {
    keyboard.row();
  }
  appendAdminFooterNav(keyboard, ctx, {
    backCallback: `adm:rcpt:q:${page}`,
    backLabel: t(ctx, 'admin_receipt_back_queue'),
    showHome: true,
  });

  await renderReceiptCaptionOrText(
    ctx,
    buildAdminScreen({
      emoji: action === 'approve' ? '✅' : '⛔',
      title: t(
        ctx,
        action === 'approve'
          ? 'admin_receipt_result_approved_title'
          : 'admin_receipt_result_rejected_title'
      ),
      breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), t(ctx, 'admin_nav_receipts')),
      primary: {
        label: t(ctx, 'admin_receipt_result_status_label'),
        value: buildStatusBadge(
          ctx,
          action === 'approve' ? 'active' : 'inactive',
          t(
            ctx,
            action === 'approve' ? 'admin_receipt_result_approved' : 'admin_receipt_result_rejected'
          )
        ),
        inline: true,
      },
      ...(action === 'reject' && reasonLabel
        ? {
            sections: [
              {
                fields: [
                  {
                    label: t(ctx, 'admin_receipt_reject_reason_label'),
                    value: reasonLabel,
                  },
                ],
              },
            ],
          }
        : {}),
    }),
    keyboard
  );
}

async function renderReceiptAlreadyReviewed(ctx: MenuContext, page: number): Promise<void> {
  const kb = new InlineKeyboard();
  appendAdminFooterNav(kb, ctx, {
    backCallback: `adm:rcpt:q:${page}`,
    backLabel: t(ctx, 'admin_receipt_back_queue'),
    showHome: true,
  });
  await renderReceiptCaptionOrText(
    ctx,
    buildAdminEmptyState(
      '⚠️',
      t(ctx, 'admin_receipt_already_reviewed_title'),
      t(ctx, 'receipt_already_reviewed')
    ),
    kb
  );
}

async function notifyReceiptResult(
  ctx: MenuContext,
  telegramId: number,
  approved: boolean,
  amount: number | undefined,
  receiptId: string,
  reason?: ReceiptRejectReason
): Promise<void> {
  if (!ctx.services) return;
  if (approved && amount !== undefined) {
    await sendReceiptApprovalNotification(ctx.api, ctx.services, {
      telegramId,
      amount,
      receiptId,
    });
  } else {
    await sendReceiptRejectionNotification(ctx.api, ctx.services, {
      telegramId,
      receiptId,
      reason,
    });
  }
}

/**
 * Background push receipt notifications are not tracked as replaceable screens.
 * Promote them to durable artifacts on review so navigating back to the queue
 * never deletes the original receipt image from the admin's chat history.
 */
function protectPushNotificationMedia(ctx: MenuContext): void {
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (!messageId || !isMediaCallback(ctx) || !ctx.session) return;
  const trackedUi = ctx.session.uiMessageIds ?? [];
  if (!trackedUi.includes(messageId)) {
    rememberArtifactMessage(ctx.session, messageId);
  }
}

function trimTelegramCaption(text: string): string {
  return text.length > TELEGRAM_CAPTION_LIMIT
    ? `${text.slice(0, TELEGRAM_CAPTION_LIMIT - 3)}...`
    : text;
}

async function renderReceiptCaptionOrText(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  if (isMediaCallback(ctx)) {
    try {
      await ctx.editMessageCaption({
        caption: trimTelegramCaption(text),
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    } catch (error) {
      if (isMessageNotModifiedError(error)) return;
      if (!isMessageEditUnavailableError(error)) throw error;
    }
  }
  await renderReceiptText(ctx, text, keyboard);
}

async function renderReceiptText(
  ctx: MenuContext,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

function isMediaCallback(ctx: MenuContext): boolean {
  const message = ctx.callbackQuery?.message;
  return Boolean(message && ('photo' in message || 'document' in message));
}
