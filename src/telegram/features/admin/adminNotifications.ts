import { InlineKeyboard, type Api } from 'grammy';
import type { UserService } from '../../../domain/services/UserService.js';
import type { TranslationService } from '../../../domain/services/TranslationService.js';
import { logger } from '../../../infra/logger.js';
import { buildScreen } from '../../designSystem.js';
import { tForLocale, localizedNumberForLocale, resolveServiceLocale } from '../../locale.js';

export interface AdminNotificationServices {
  userService: UserService;
  translationService: TranslationService;
}

const VALID_REJECT_REASONS = new Set([
  'unclear',
  'not_received',
  'duplicate',
  'amount_mismatch',
  'other',
]);

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
      buildScreen({
        emoji: '✅',
        title: tForLocale(services.translationService, locale, 'receipt_result_approved_title'),
        subtitle: tForLocale(
          services.translationService,
          locale,
          'receipt_result_approved_subtitle'
        ),
        primary: {
          emoji: '💰',
          label: tForLocale(services.translationService, locale, 'receipt_result_amount_label'),
          value: `${localizedNumberForLocale(params.amount, locale)} ${tForLocale(services.translationService, locale, 'currency_toman')}`,
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
      buildScreen({
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
                emoji: '⚠️',
                label: tForLocale(
                  services.translationService,
                  locale,
                  'receipt_result_rejected_reason_label'
                ),
                value: reasonDetail,
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
      buildScreen({
        emoji: '💳',
        title: tForLocale(services.translationService, locale, 'wallet_dashboard_title'),
        subtitle: tForLocale(services.translationService, locale, 'balance_adjusted_notification', {
          balance: localizedNumberForLocale(params.newBalance, locale),
        }),
        primary: {
          emoji: '💰',
          label: tForLocale(services.translationService, locale, 'wallet_available_balance'),
          value: `${localizedNumberForLocale(params.newBalance, locale)} ${tForLocale(
            services.translationService,
            locale,
            'currency_toman'
          )}`,
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
