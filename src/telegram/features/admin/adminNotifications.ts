import { InlineKeyboard, type Api } from 'grammy';
import type { UserService } from '../../../domain/services/UserService.js';
import type {
  SupportedLocale,
  TranslationService,
} from '../../../domain/services/TranslationService.js';
import { logger } from '../../../infra/logger.js';
import { buildScreen, buildUserScreen } from '../../designSystem.js';
import { escapeTelegramMarkdown } from '../../rendering.js';
import { tForLocale, localizedNumberForLocale, resolveServiceLocale } from '../../locale.js';

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
        const baseText = simpleText || `🔔 *${briefTitle}*`;
        const fullSimpleText = duplicateBanner ? `${duplicateBanner}\n\n${baseText}` : baseText;
        await api.sendMessage(adminId, fullSimpleText, {
          parse_mode: 'Markdown',
        });
        continue;
      }

      const subtitleBase = tForLocale(ts, adminLocale, 'admin_receipt_review_subtitle');
      const caption = buildScreen({
        emoji: '🧾',
        title: tForLocale(ts, adminLocale, 'admin_receipt_review_title'),
        subtitle: duplicateBanner ? `${duplicateBanner}\n${subtitleBase}` : subtitleBase,
        primary: {
          emoji: '💰',
          label: tForLocale(ts, adminLocale, 'admin_receipt_amount_label'),
          value: `${localizedNumberForLocale(params.amount, adminLocale)} ${tForLocale(ts, adminLocale, 'currency_toman')}`,
        },
        sections: [
          {
            emoji: '👤',
            title: tForLocale(ts, adminLocale, 'admin_receipt_user_section'),
            fields: [
              {
                emoji: '🆔',
                label: tForLocale(ts, adminLocale, 'admin_receipt_user_label'),
                value: `\`${params.telegramId}\``,
              },
              {
                emoji: '🧾',
                label: tForLocale(ts, adminLocale, 'admin_receipt_id_label'),
                value: `\`#${params.receiptId}\``,
              },
              ...(params.cardSummary
                ? [
                    {
                      emoji: '🏦',
                      label: tForLocale(ts, adminLocale, 'admin_receipt_destination_card_label'),
                      value: escapeTelegramMarkdown(params.cardSummary),
                    },
                  ]
                : []),
              {
                emoji: '📅',
                label: tForLocale(ts, adminLocale, 'admin_receipt_created_label'),
                value: createdAt.toLocaleDateString(adminLocale === 'fa' ? 'fa-IR' : 'en-US'),
              },
            ],
          },
        ],
        footer: `⚡ ${tForLocale(ts, adminLocale, 'admin_receipt_approve_hint')}`,
      });
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
        .text(tForLocale(ts, adminLocale, 'admin_receipt_dismiss_button'), 'ui:dismiss');

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
        reply_markup: new InlineKeyboard().text(
          tForLocale(services.translationService, locale, 'menu_wallet'),
          'nav:wallet'
        ),
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
        reply_markup: new InlineKeyboard().text(
          tForLocale(services.translationService, locale, 'menu_wallet'),
          'nav:wallet'
        ),
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
        subtitle: tForLocale(services.translationService, locale, 'balance_adjusted_notification', {
          balance: localizedNumberForLocale(params.newBalance, locale),
        }),
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
