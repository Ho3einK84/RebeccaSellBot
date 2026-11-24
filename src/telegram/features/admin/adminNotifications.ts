import { InlineKeyboard, type Api } from 'grammy';
import { extractOrderTelegramMessageIds } from '../../../domain/services/AutomatedPaymentService.js';
import type { UserService } from '../../../domain/services/UserService.js';
import type {
  SupportedLocale,
  TranslationService,
} from '../../../domain/services/TranslationService.js';
import { logger } from '../../../infra/logger.js';
import { buildAdminScreen, buildUserScreen } from '../../designSystem.js';
import { escapeTelegramMarkdown } from '../../rendering.js';
import {
  localizedDateTimeForLocale,
  localizedNumberForLocale,
  resolveServiceLocale,
  tForLocale,
} from '../../locale.js';

export interface AdminNotificationServices {
  userService: UserService;
  translationService: TranslationService;
  adminIds?: number[];
}

const VALID_REJECT_REASONS = new Set([
  'unclear',
  'not_received',
  'duplicate',
  'amount_mismatch',
  'other',
]);

function defaultShortId(receiptId: string): string {
  const match = receiptId.match(/_([a-zA-Z0-9]{4,8})$/u);
  if (match) return match[1]!;
  return receiptId.length > 8 ? receiptId.slice(-6) : receiptId;
}

export function formatDuplicateReceiptBanner(
  translationService: TranslationService,
  locale: SupportedLocale,
  duplicateOfReceiptId: string | null | undefined,
  shortIdFormatter: (receiptId: string) => string = defaultShortId
): string | null {
  if (!duplicateOfReceiptId) return null;
  return tForLocale(translationService, locale, 'admin_receipt_duplicate_warning', {
    short_id: shortIdFormatter(duplicateOfReceiptId),
  });
}

export async function sendAdminNewReceiptNotification(
  api: Api,
  services: AdminNotificationServices,
  params: {
    receiptId: string;
    telegramId: number;
    amount: number;
    photoFileId: string;
    mediaType?: 'photo' | 'document';
    duplicateOfReceiptId?: string | null;
    cardSummary?: string | null;
    shortIdFormatter?: (receiptId: string) => string;
  }
): Promise<void> {
  const ts = services.translationService;
  const notifyEnabled =
    typeof ts.getSettingBool === 'function'
      ? ts.getSettingBool('receipt_notify_enabled', true)
      : true;
  if (!notifyEnabled) {
    logger.info(
      { receiptId: params.receiptId },
      'Admin receipt notification skipped (disabled in settings)'
    );
    return;
  }

  const notifyAdminsSetting =
    typeof ts.getSetting === 'function' ? ts.getSetting('receipt_notify_admins', '').trim() : '';
  let targetAdminIds = services.adminIds ?? [];
  if (notifyAdminsSetting && notifyAdminsSetting !== 'all') {
    const configuredIds = notifyAdminsSetting
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (configuredIds.length > 0) {
      targetAdminIds = configuredIds;
    }
  }

  const notifyMode =
    typeof ts.getSetting === 'function'
      ? (ts.getSetting('receipt_notify_mode', 'full') as 'full' | 'simple')
      : 'full';
  const createdAt = new Date();
  const formatShortId = params.shortIdFormatter ?? defaultShortId;
  const shortId = formatShortId(params.receiptId);
  const mediaType = params.mediaType ?? 'photo';

  for (const adminId of targetAdminIds) {
    try {
      const adminLocale =
        (await services.userService.getLocale(adminId)) ?? resolveServiceLocale(ts);
      const duplicateBanner = formatDuplicateReceiptBanner(
        ts,
        adminLocale,
        params.duplicateOfReceiptId,
        formatShortId
      );

      if (notifyMode === 'simple') {
        const briefTitle = tForLocale(ts, adminLocale, 'admin_receipt_notify_simple_brief');
        const simpleText = tForLocale(ts, adminLocale, 'admin_receipt_notify_simple_message', {
          amount: localizedNumberForLocale(params.amount, adminLocale),
          currency: tForLocale(ts, adminLocale, 'currency_toman'),
          telegram_id: String(params.telegramId),
          short_id: shortId,
        });
        const screen = buildAdminScreen({
          emoji: '🔔',
          title: briefTitle || tForLocale(ts, adminLocale, 'admin_receipt_review_title'),
          notice: duplicateBanner ? { tone: 'warning', text: duplicateBanner } : undefined,
          footer: simpleText || undefined,
        });
        const simpleKb = new InlineKeyboard()
          .text(tForLocale(ts, adminLocale, 'admin_receipt_open_queue_button'), 'adm:rcpt:q:1')
          .text(
            tForLocale(ts, adminLocale, 'admin_receipt_view_user_button'),
            `adm:usr:v:${params.telegramId}`
          )
          .row()
          .text(tForLocale(ts, adminLocale, 'menu_close'), 'ui:dismiss');
        await api.sendMessage(adminId, screen, {
          parse_mode: 'Markdown',
          reply_markup: simpleKb,
        });
        continue;
      }

      const subtitleBase = tForLocale(ts, adminLocale, 'admin_receipt_review_subtitle');
      let caption = buildAdminScreen({
        emoji: '🧾',
        title: tForLocale(ts, adminLocale, 'admin_receipt_review_title'),
        subtitle: subtitleBase,
        notice: duplicateBanner ? { tone: 'warning', text: duplicateBanner } : undefined,
        primary: {
          emoji: '💰',
          label: tForLocale(ts, adminLocale, 'admin_receipt_amount_label'),
          value: `${localizedNumberForLocale(params.amount, adminLocale)} ${tForLocale(ts, adminLocale, 'currency_toman')}`,
          inline: true,
          emphasizeValue: true,
        },
        sections: [
          {
            title: tForLocale(ts, adminLocale, 'admin_receipt_user_section'),
            fields: [
              {
                label: tForLocale(ts, adminLocale, 'admin_receipt_user_label'),
                value: `\`${params.telegramId}\``,
              },
              {
                label: tForLocale(ts, adminLocale, 'admin_receipt_id_label'),
                value: `\`${params.receiptId}\` (#${shortId})`,
              },
              ...(params.cardSummary
                ? [
                    {
                      label: tForLocale(ts, adminLocale, 'admin_receipt_destination_card_label'),
                      value: escapeTelegramMarkdown(params.cardSummary),
                    },
                  ]
                : []),
              {
                label: tForLocale(ts, adminLocale, 'admin_receipt_created_label'),
                value: localizedDateTimeForLocale(createdAt, adminLocale),
              },
            ],
          },
        ],
        footer: `⚡ ${tForLocale(ts, adminLocale, 'admin_receipt_approve_hint')}`,
      });
      if (caption.length > 1020) {
        caption = `${caption.slice(0, 1017)}...`;
      }
      const receiptMenu = new InlineKeyboard()
        .text(
          tForLocale(ts, adminLocale, 'admin_receipt_approve'),
          `receipt:quick_approve:${params.receiptId}`
        )
        .text(
          tForLocale(ts, adminLocale, 'admin_receipt_reject'),
          `receipt:reject_prompt:${params.receiptId}`
        )
        .row()
        .text(
          tForLocale(ts, adminLocale, 'admin_receipt_view_user_button'),
          `adm:usr:v:${params.telegramId}`
        )
        .text(tForLocale(ts, adminLocale, 'admin_receipt_open_queue_button'), 'adm:rcpt:q:1');
      if (params.duplicateOfReceiptId) {
        receiptMenu
          .row()
          .text(
            tForLocale(ts, adminLocale, 'admin_receipt_view_duplicate_button'),
            `adm:rcpt:va:${params.duplicateOfReceiptId}:1`
          );
      }
      receiptMenu.row().text(tForLocale(ts, adminLocale, 'menu_close'), 'ui:dismiss');

      try {
        if (mediaType === 'document') {
          await api.sendDocument(adminId, params.photoFileId, {
            caption,
            parse_mode: 'Markdown',
            reply_markup: receiptMenu,
          });
        } else {
          await api.sendPhoto(adminId, params.photoFileId, {
            caption,
            parse_mode: 'Markdown',
            reply_markup: receiptMenu,
          });
        }
      } catch (mediaErr) {
        logger.warn(
          { err: mediaErr, adminId, receiptId: params.receiptId },
          'Media receipt notification failed; falling back to text alert'
        );
        await api.sendMessage(adminId, caption, {
          parse_mode: 'Markdown',
          reply_markup: receiptMenu,
        });
      }
    } catch (err) {
      logger.warn(
        { err, adminId, receiptId: params.receiptId },
        'Failed to notify admin of new receipt'
      );
    }
  }
}

export async function sendReceiptApprovalNotification(
  api: Api,
  services: AdminNotificationServices,
  params: {
    telegramId: number;
    amount: number;
    receiptId: string;
  }
): Promise<void> {
  try {
    const locale =
      (await services.userService.getLocale(params.telegramId)) ??
      resolveServiceLocale(services.translationService);

    await api.sendMessage(
      params.telegramId,
      buildUserScreen({
        emoji: '✅',
        title: tForLocale(services.translationService, locale, 'receipt_result_approved_title'),
        subtitle: tForLocale(
          services.translationService,
          locale,
          'receipt_result_approved_subtitle'
        ),
        primary: {
          label: tForLocale(services.translationService, locale, 'receipt_result_amount_label'),
          value: `${localizedNumberForLocale(params.amount, locale)} ${tForLocale(services.translationService, locale, 'currency_toman')}`,
          emphasizeValue: true,
        },
        footer: tForLocale(services.translationService, locale, 'receipt_result_next_hint'),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(
            tForLocale(services.translationService, locale, 'receipt_approved_shop_button'),
            'nav:shop'
          )
          .text(
            tForLocale(services.translationService, locale, 'receipt_approved_services_button'),
            'subs:page:1'
          )
          .row()
          .text(tForLocale(services.translationService, locale, 'menu_wallet'), 'nav:wallet'),
      }
    );
  } catch (err) {
    logger.warn(
      { err, telegramId: params.telegramId, receiptId: params.receiptId },
      'Failed to deliver receipt approval to user'
    );
  }
}

export async function sendReceiptRejectionNotification(
  api: Api,
  services: AdminNotificationServices,
  params: {
    telegramId: number;
    receiptId: string;
    reason?: string;
  }
): Promise<void> {
  try {
    const locale =
      (await services.userService.getLocale(params.telegramId)) ??
      resolveServiceLocale(services.translationService);

    const normalizedReason = params.reason === 'mismatch' ? 'amount_mismatch' : params.reason;
    const reason =
      normalizedReason && VALID_REJECT_REASONS.has(normalizedReason) ? normalizedReason : undefined;
    const reasonDetailKey = reason ? `receipt_result_rejected_reason_${reason}` : undefined;
    const reasonDetail = reasonDetailKey
      ? tForLocale(services.translationService, locale, reasonDetailKey)
      : params.reason;

    await api.sendMessage(
      params.telegramId,
      buildUserScreen({
        emoji: '⚠️',
        title: tForLocale(services.translationService, locale, 'receipt_result_rejected_title'),
        subtitle: tForLocale(
          services.translationService,
          locale,
          'receipt_result_rejected_subtitle'
        ),
        ...(reasonDetail
          ? {
              primary: {
                label: tForLocale(
                  services.translationService,
                  locale,
                  'receipt_result_rejected_reason_label'
                ),
                value: reason ? reasonDetail : escapeTelegramMarkdown(reasonDetail),
              },
            }
          : {}),
        footer: tForLocale(services.translationService, locale, 'receipt_result_next_hint'),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(
            tForLocale(services.translationService, locale, 'admin_receipt_resubmit_button'),
            'topup:direct'
          )
          .row()
          .text(tForLocale(services.translationService, locale, 'menu_wallet'), 'nav:wallet'),
      }
    );
  } catch (err) {
    logger.warn(
      { err, telegramId: params.telegramId, receiptId: params.receiptId },
      'Failed to deliver receipt rejection to user'
    );
  }
}

export async function sendReceiptVoidedNotification(
  api: Api,
  services: AdminNotificationServices,
  params: {
    telegramId: number;
    receiptId: string;
    amount: number;
    deductedAmount?: number;
    disabledConfigsCount?: number;
    shortId?: string;
  }
): Promise<void> {
  try {
    const locale =
      (await services.userService.getLocale(params.telegramId)) ??
      resolveServiceLocale(services.translationService);
    const ts = services.translationService;
    const shortId = params.shortId ?? defaultShortId(params.receiptId);
    const effectiveAmount = params.deductedAmount ?? params.amount;
    const currency = tForLocale(ts, locale, 'currency_toman');
    const disabledCount = params.disabledConfigsCount ?? 0;

    await api.sendMessage(
      params.telegramId,
      buildUserScreen({
        emoji: '🚫',
        title: tForLocale(ts, locale, 'receipt_result_voided_title'),
        subtitle: tForLocale(ts, locale, 'receipt_result_voided_subtitle', {
          short_id: shortId,
          amount: localizedNumberForLocale(effectiveAmount, locale),
          currency,
        }),
        primary: {
          label: tForLocale(ts, locale, 'receipt_result_amount_label'),
          value: `${localizedNumberForLocale(effectiveAmount, locale)} ${currency}`,
          emphasizeValue: true,
        },
        footer:
          disabledCount > 0
            ? tForLocale(ts, locale, 'receipt_result_voided_disabled_configs', {
                count: localizedNumberForLocale(disabledCount, locale),
              })
            : tForLocale(ts, locale, 'receipt_result_next_hint'),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(
          tForLocale(ts, locale, 'menu_wallet'),
          'nav:wallet'
        ),
      }
    );
  } catch (err) {
    logger.warn(
      { err, telegramId: params.telegramId, receiptId: params.receiptId },
      'Failed to deliver receipt void notification to user'
    );
  }
}

export async function sendBalanceAdjustmentNotification(
  api: Api,
  services: AdminNotificationServices,
  params: {
    telegramId: number;
    newBalance: number;
  }
): Promise<void> {
  try {
    const locale =
      (await services.userService.getLocale(params.telegramId)) ??
      resolveServiceLocale(services.translationService);

    await api.sendMessage(
      params.telegramId,
      buildUserScreen({
        emoji: '💳',
        title: tForLocale(services.translationService, locale, 'wallet_dashboard_title'),
        subtitle: tForLocale(services.translationService, locale, 'tx_type_admin_adjustment'),
        primary: {
          label: tForLocale(services.translationService, locale, 'wallet_available_balance'),
          value: `${localizedNumberForLocale(params.newBalance, locale)} ${tForLocale(
            services.translationService,
            locale,
            'currency_toman'
          )}`,
          emphasizeValue: true,
        },
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(
          tForLocale(services.translationService, locale, 'menu_wallet'),
          'nav:wallet'
        ),
      }
    );
  } catch (err) {
    logger.warn(
      { err, telegramId: params.telegramId },
      'Failed to deliver balance adjustment notification to user'
    );
  }
}

function resolveNotificationAdminIds(services: AdminNotificationServices): number[] {
  const ts = services.translationService;
  const notifyEnabled =
    typeof ts.getSettingBool === 'function'
      ? ts.getSettingBool('receipt_notify_enabled', true)
      : true;
  if (!notifyEnabled) return [];

  const notifyAdminsSetting =
    typeof ts.getSetting === 'function' ? ts.getSetting('receipt_notify_admins', '').trim() : '';
  let targetAdminIds = services.adminIds ?? [];
  if (notifyAdminsSetting && notifyAdminsSetting !== 'all') {
    const configuredIds = notifyAdminsSetting
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (configuredIds.length > 0) {
      targetAdminIds = configuredIds;
    }
  }
  return targetAdminIds;
}

/**
 * Best-effort deletion of temporary pending invoice / reminder messages linked
 * to an automated payment order once it completes, cancels, or is superseded.
 * Never deletes the permanent completion receipt message.
 */
export async function deleteOrderTelegramMessages(
  api: Pick<Api, 'deleteMessage'> | { deleteMessage?: Api['deleteMessage'] },
  telegramId: number,
  metadata: string | null | undefined,
  extraMessageIds: readonly number[] = []
): Promise<void> {
  if (typeof api.deleteMessage !== 'function') return;
  const ids = new Set<number>(extractOrderTelegramMessageIds(metadata));
  for (const id of extraMessageIds) {
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  for (const msgId of ids) {
    try {
      await api.deleteMessage(telegramId, msgId);
    } catch {
      // Message may already be deleted or older than Telegram's 48h delete window
    }
  }
}

export async function sendAutomatedTopupSuccessNotification(
  api: Api,
  services: AdminNotificationServices,
  params: {
    telegramId: number;
    amount: number;
    cashbackAmount?: number;
    balanceAfter?: number;
    provider: 'forapp_card' | 'nowpayments';
    orderId: string;
    orderMetadata?: string | null;
  }
): Promise<void> {
  try {
    // Delete stale pending invoice/nudge messages before delivering the durable receipt.
    await deleteOrderTelegramMessages(api, params.telegramId, params.orderMetadata);

    const ts = services.translationService;
    const locale =
      (await services.userService.getLocale(params.telegramId)) ?? resolveServiceLocale(ts);
    const currency = tForLocale(ts, locale, 'currency_toman');
    const providerLabel =
      params.provider === 'nowpayments'
        ? tForLocale(ts, locale, 'payment_method_nowpayments')
        : tForLocale(ts, locale, 'payment_method_forapp_auto');
    const shortId = defaultShortId(params.orderId);

    const fields: Array<{ label: string; value: string }> = [
      {
        label: tForLocale(ts, locale, 'auto_pay_method_label'),
        value: escapeTelegramMarkdown(providerLabel),
      },
      {
        label: tForLocale(ts, locale, 'auto_pay_order_id_label'),
        value: `\`#${shortId}\``,
      },
    ];
    if (params.cashbackAmount && params.cashbackAmount > 0) {
      fields.push({
        label: tForLocale(ts, locale, 'auto_pay_cashback_label'),
        value: `+${localizedNumberForLocale(params.cashbackAmount, locale)} ${currency}`,
      });
    }
    if (params.balanceAfter !== undefined) {
      fields.push({
        label: tForLocale(ts, locale, 'wallet_available_balance'),
        value: `${localizedNumberForLocale(params.balanceAfter, locale)} ${currency}`,
      });
    }

    await api.sendMessage(
      params.telegramId,
      buildUserScreen({
        emoji: '✅',
        title: tForLocale(ts, locale, 'auto_pay_credited_title'),
        subtitle: tForLocale(ts, locale, 'auto_pay_credited_subtitle'),
        primary: {
          label: tForLocale(ts, locale, 'receipt_result_amount_label'),
          value: `+${localizedNumberForLocale(params.amount, locale)} ${currency}`,
          emphasizeValue: true,
        },
        sections: [{ fields }],
        footer: tForLocale(ts, locale, 'receipt_result_next_hint'),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(tForLocale(ts, locale, 'receipt_approved_shop_button'), 'nav:shop')
          .text(tForLocale(ts, locale, 'receipt_approved_services_button'), 'subs:page:1')
          .row()
          .text(tForLocale(ts, locale, 'menu_wallet'), 'nav:wallet'),
      }
    );
  } catch (err) {
    logger.warn(
      { err, telegramId: params.telegramId, orderId: params.orderId },
      'Failed to deliver automated top-up success notification to user'
    );
  }
}

export async function sendAdminAutomatedTopupReport(
  api: Api,
  services: AdminNotificationServices,
  params: {
    telegramId: number;
    amount: number;
    cashbackAmount?: number;
    provider: 'forapp_card' | 'nowpayments';
    orderId: string;
    bank?: string | null;
    payCurrency?: string | null;
  }
): Promise<void> {
  const ts = services.translationService;
  const targetAdminIds = resolveNotificationAdminIds(services);
  const shortId = defaultShortId(params.orderId);

  for (const adminId of targetAdminIds) {
    try {
      const adminLocale =
        (await services.userService.getLocale(adminId)) ?? resolveServiceLocale(ts);
      const currency = tForLocale(ts, adminLocale, 'currency_toman');
      const providerLabel =
        params.provider === 'nowpayments'
          ? tForLocale(ts, adminLocale, 'payment_method_nowpayments')
          : tForLocale(ts, adminLocale, 'payment_method_forapp_auto');

      const fields: Array<{ label: string; value: string }> = [
        {
          label: tForLocale(ts, adminLocale, 'admin_receipt_user_label'),
          value: `\`${params.telegramId}\``,
        },
        {
          label: tForLocale(ts, adminLocale, 'auto_pay_method_label'),
          value: escapeTelegramMarkdown(providerLabel),
        },
        {
          label: tForLocale(ts, adminLocale, 'auto_pay_order_id_label'),
          value: `\`#${shortId}\``,
        },
      ];
      if (params.bank) {
        fields.push({
          label: tForLocale(ts, adminLocale, 'topup_card_bank_label'),
          value: escapeTelegramMarkdown(params.bank),
        });
      }
      if (params.payCurrency) {
        fields.push({
          label: tForLocale(ts, adminLocale, 'auto_pay_crypto_currency_label'),
          value: `\`${params.payCurrency.toUpperCase()}\``,
        });
      }
      if (params.cashbackAmount && params.cashbackAmount > 0) {
        fields.push({
          label: tForLocale(ts, adminLocale, 'auto_pay_cashback_label'),
          value: `+${localizedNumberForLocale(params.cashbackAmount, adminLocale)} ${currency}`,
        });
      }

      const screen = buildAdminScreen({
        emoji: '⚡',
        title: tForLocale(ts, adminLocale, 'admin_auto_pay_report_title'),
        primary: {
          emoji: '💰',
          label: tForLocale(ts, adminLocale, 'admin_receipt_amount_label'),
          value: `${localizedNumberForLocale(params.amount, adminLocale)} ${currency}`,
          inline: true,
          emphasizeValue: true,
        },
        sections: [{ fields }],
      });

      await api.sendMessage(adminId, screen, {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(
            tForLocale(ts, adminLocale, 'admin_receipt_view_user_button'),
            `adm:usr:v:${params.telegramId}`
          )
          .text(tForLocale(ts, adminLocale, 'menu_close'), 'ui:dismiss'),
      });
    } catch (err) {
      logger.warn(
        { err, adminId, orderId: params.orderId },
        'Failed to deliver automated top-up report to admin'
      );
    }
  }
}

export async function sendAdminForAppUnmatchedDepositAlert(
  api: Api,
  services: AdminNotificationServices,
  params: {
    depositId: string;
    amountRial: number;
    amountToman: number | null;
    bank?: string | null;
    sender?: string | null;
    note?: string | null;
    relatedOrderId?: string | null;
    relatedTelegramId?: number | null;
  }
): Promise<void> {
  const ts = services.translationService;
  const targetAdminIds = resolveNotificationAdminIds(services);
  const shortId = defaultShortId(params.depositId);

  for (const adminId of targetAdminIds) {
    try {
      const adminLocale =
        (await services.userService.getLocale(adminId)) ?? resolveServiceLocale(ts);
      const currency = tForLocale(ts, adminLocale, 'currency_toman');
      const rialLabel = tForLocale(ts, adminLocale, 'currency_rial');
      const amountDisplay =
        params.amountToman !== null
          ? `${localizedNumberForLocale(params.amountToman, adminLocale)} ${currency} (${localizedNumberForLocale(params.amountRial, adminLocale)} ${rialLabel})`
          : `${localizedNumberForLocale(params.amountRial, adminLocale)} ${rialLabel}`;

      const fields: Array<{ label: string; value: string }> = [
        {
          label: tForLocale(ts, adminLocale, 'admin_forapp_deposit_id_label'),
          value: `\`#${shortId}\``,
        },
      ];
      if (params.relatedOrderId) {
        fields.push({
          label: tForLocale(ts, adminLocale, 'auto_pay_order_id_label'),
          value: `\`#${defaultShortId(params.relatedOrderId)}\``,
        });
      }
      if (params.relatedTelegramId) {
        fields.push({
          label: tForLocale(ts, adminLocale, 'admin_forapp_candidate_user_label'),
          value: `\`${params.relatedTelegramId}\``,
        });
      }
      if (params.bank) {
        fields.push({
          label: tForLocale(ts, adminLocale, 'topup_card_bank_label'),
          value: escapeTelegramMarkdown(params.bank),
        });
      }
      if (params.sender) {
        fields.push({
          label: tForLocale(ts, adminLocale, 'admin_forapp_sender_label'),
          value: `\`${params.sender}\``,
        });
      }

      const screen = buildAdminScreen({
        emoji: '⚠️',
        title: tForLocale(ts, adminLocale, 'admin_forapp_unmatched_alert_title'),
        subtitle: tForLocale(ts, adminLocale, 'admin_forapp_unmatched_alert_subtitle'),
        primary: {
          emoji: '💰',
          label: tForLocale(ts, adminLocale, 'admin_receipt_amount_label'),
          value: amountDisplay,
          inline: true,
        },
        sections: [{ fields }],
      });

      await api.sendMessage(adminId, screen, {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(
            tForLocale(ts, adminLocale, 'admin_forapp_open_unmatched_button'),
            `adm:pg:fad:v:${params.depositId}`
          )
          .row()
          .text(tForLocale(ts, adminLocale, 'menu_close'), 'ui:dismiss'),
      });
    } catch (err) {
      logger.warn(
        { err, adminId, depositId: params.depositId },
        'Failed to deliver ForApp unmatched deposit alert to admin'
      );
    }
  }
}

export async function sendNowPaymentsPartialPaymentNotification(
  api: Api,
  services: AdminNotificationServices,
  params: {
    telegramId: number;
    orderId: string;
    expectedAmountToman: number;
    payCurrency?: string | null;
    payAmount?: string | null;
    actuallyPaid?: string | null;
  }
): Promise<void> {
  const ts = services.translationService;
  const shortId = defaultShortId(params.orderId);

  try {
    const userLocale =
      (await services.userService.getLocale(params.telegramId)) ?? resolveServiceLocale(ts);
    const currency = tForLocale(ts, userLocale, 'currency_toman');
    await api.sendMessage(
      params.telegramId,
      buildUserScreen({
        emoji: '⚠️',
        title: tForLocale(ts, userLocale, 'nowpayments_partially_paid_title'),
        subtitle: tForLocale(ts, userLocale, 'nowpayments_partially_paid_subtitle'),
        primary: {
          label: tForLocale(ts, userLocale, 'auto_pay_order_id_label'),
          value: `\`#${shortId}\``,
          inline: true,
        },
        sections: [
          {
            fields: [
              {
                label: tForLocale(ts, userLocale, 'receipt_result_amount_label'),
                value: `${localizedNumberForLocale(params.expectedAmountToman, userLocale)} ${currency}`,
              },
              ...(params.actuallyPaid
                ? [
                    {
                      label: tForLocale(ts, userLocale, 'nowpayments_actually_paid_label'),
                      value: `\`${params.actuallyPaid}${params.payCurrency ? ` ${params.payCurrency.toUpperCase()}` : ''}\``,
                    },
                  ]
                : []),
            ],
          },
        ],
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(
          tForLocale(ts, userLocale, 'menu_wallet'),
          'nav:wallet'
        ),
      }
    );
  } catch (err) {
    logger.warn(
      { err, telegramId: params.telegramId, orderId: params.orderId },
      'Failed to deliver NOWPayments partial payment notice to user'
    );
  }

  const targetAdminIds = resolveNotificationAdminIds(services);
  for (const adminId of targetAdminIds) {
    try {
      const adminLocale =
        (await services.userService.getLocale(adminId)) ?? resolveServiceLocale(ts);
      await api.sendMessage(
        adminId,
        buildAdminScreen({
          emoji: '⚠️',
          title: tForLocale(ts, adminLocale, 'nowpayments_partially_paid_title'),
          sections: [
            {
              fields: [
                {
                  label: tForLocale(ts, adminLocale, 'admin_receipt_user_label'),
                  value: `\`${params.telegramId}\``,
                },
                {
                  label: tForLocale(ts, adminLocale, 'auto_pay_order_id_label'),
                  value: `\`#${shortId}\``,
                },
                {
                  label: tForLocale(ts, adminLocale, 'nowpayments_actually_paid_label'),
                  value: `\`${params.actuallyPaid ?? '—'} / ${params.payAmount ?? '—'}${params.payCurrency ? ` ${params.payCurrency.toUpperCase()}` : ''}\``,
                },
              ],
            },
          ],
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(
              tForLocale(ts, adminLocale, 'admin_receipt_view_user_button'),
              `adm:usr:v:${params.telegramId}`
            )
            .text(tForLocale(ts, adminLocale, 'menu_close'), 'ui:dismiss'),
        }
      );
    } catch (err) {
      logger.warn(
        { err, adminId, orderId: params.orderId },
        'Failed to deliver NOWPayments partial payment alert to admin'
      );
    }
  }
}
