/**
 * Telegram chat artifacts, P2P notifications, and Telegram-hosted receipt upload
 * triggered by User WebApp actions so Bot and Mini App stay completely synchronized.
 */

import { InlineKeyboard, InputFile, type Api } from 'grammy';
import type { UserService } from '../domain/services/UserService.js';
import type { TranslationService } from '../domain/services/TranslationService.js';
import { logger } from '../infra/logger.js';
import { buildUserScreen, stripLeadingEmoji } from './designSystem.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from './rendering.js';
import {
  formatSubscriptionLink,
  localizedNumberForLocale,
  resolveServiceLocale,
  tForLocale,
} from './locale.js';

export interface WebAppNotificationServices {
  userService: UserService;
  translationService: TranslationService;
}

function hasCatalogGet(ts: TranslationService | undefined): ts is TranslationService {
  return Boolean(ts && typeof ts.get === 'function');
}

function resolveSafeLocale(
  userLocale: 'fa' | 'en' | null | undefined,
  ts: TranslationService | undefined
): 'fa' | 'en' {
  if (userLocale === 'fa' || userLocale === 'en') return userLocale;
  try {
    return resolveServiceLocale(ts);
  } catch {
    return 'fa';
  }
}

function buildWebAppButtonUrl(webAppUrl: string | undefined, query?: string): string | undefined {
  if (!webAppUrl) return undefined;
  try {
    const url = new URL(webAppUrl);
    if (query) {
      const extra = new URLSearchParams(query);
      for (const [k, v] of extra.entries()) {
        url.searchParams.set(k, v);
      }
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Sends a clean, permanent subscription artifact to the user's Telegram chat
 * after a WebApp purchase, free trial claim, renewal, or link revocation.
 * Non-fatal: silently logs if the user blocked the bot or hasn't started it.
 */
export async function sendWebAppConfigArtifact(
  api: Api | undefined,
  services: WebAppNotificationServices,
  params: {
    telegramId: number;
    kind: 'new_config' | 'renew_config' | 'trial' | 'revoke';
    configUsername: string;
    configId?: string;
    subUrl?: string;
    gbAmount?: number;
    durationDays?: number;
    startOnFirstUse?: boolean;
    webAppUrl?: string;
  }
): Promise<void> {
  if (!api || typeof api.sendMessage !== 'function') return;

  try {
    const ts = services.translationService;
    const locale = resolveSafeLocale(await services.userService.getLocale(params.telegramId), ts);
    const currencyAwareFa = locale === 'fa';
    const canTranslate = hasCatalogGet(ts);

    const title =
      params.kind === 'trial'
        ? canTranslate
          ? tForLocale(ts, locale, 'trial_preview_heading')
          : currencyAwareFa
            ? 'سرویس تست رایگان آماده است'
            : 'Your Free Trial Is Ready'
        : params.kind === 'revoke'
          ? (canTranslate ? tForLocale(ts, locale, 'subscription_revoke_success_title') : '') ||
            (currencyAwareFa ? 'لینک اشتراک جدید صادر شد' : 'New Subscription Link Issued')
          : params.kind === 'renew_config'
            ? (canTranslate ? tForLocale(ts, locale, 'renewal_success_title') : '') ||
              (currencyAwareFa ? 'تمدید اشتراک با موفقیت انجام شد' : 'Subscription Renewed')
            : (canTranslate ? tForLocale(ts, locale, 'purchase_success_title') : '') ||
              (currencyAwareFa ? 'سرویس جدید شما آماده است' : 'Your New Service Is Ready');

    const emoji =
      params.kind === 'trial'
        ? '🎁'
        : params.kind === 'revoke'
          ? '🔄'
          : params.kind === 'renew_config'
            ? '♻️'
            : '🎉';

    const fields: Array<{ emoji?: string; label: string; value: string }> = [
      {
        emoji: '🆔',
        label: currencyAwareFa ? 'نام سرویس' : 'Service',
        value: `\`${sanitizeTelegramInlineCode(params.configUsername)}\``,
      },
    ];

    if (params.gbAmount && params.gbAmount > 0) {
      const gbUnit = canTranslate
        ? tForLocale(ts, locale, 'traffic_unit_gb')
        : currencyAwareFa
          ? 'گیگابایت'
          : 'GB';
      fields.push({
        emoji: '📦',
        label: currencyAwareFa ? 'حجم' : 'Volume',
        value: `${localizedNumberForLocale(params.gbAmount, locale)} ${gbUnit}`,
      });
    }
    if (params.durationDays && params.durationDays > 0) {
      const daysUnit = canTranslate
        ? tForLocale(ts, locale, 'days_unit')
        : currencyAwareFa
          ? 'روز'
          : 'days';
      fields.push({
        emoji: '⏳',
        label: currencyAwareFa ? 'مدت' : 'Duration',
        value: `${localizedNumberForLocale(params.durationDays, locale)} ${daysUnit}`,
      });
    }

    const unavailableLabel = canTranslate
      ? tForLocale(ts, locale, 'subscription_link_unavailable')
      : currencyAwareFa
        ? 'در دسترس نیست'
        : 'Unavailable';
    const linkLabel = canTranslate
      ? tForLocale(ts, locale, 'subscription_link_label')
      : currencyAwareFa
        ? 'لینک اتصال'
        : 'Subscription Link';
    const primary = params.subUrl
      ? {
          emoji: '🔗',
          label: linkLabel,
          value: formatSubscriptionLink(params.subUrl, unavailableLabel),
        }
      : undefined;

    const footer = params.startOnFirstUse
      ? currencyAwareFa
        ? '⏱ مدت اشتراک از اولین اتصال شما محاسبه می‌شود.'
        : '⏱ Validity starts upon your first connection.'
      : undefined;

    const subtitleRaw =
      params.kind === 'trial' && canTranslate
        ? stripLeadingEmoji(tForLocale(ts, locale, 'trial_success'))
        : undefined;
    const text = buildUserScreen({
      emoji,
      title,
      ...(subtitleRaw ? { subtitle: subtitleRaw } : {}),
      primary,
      sections: [{ fields }],
      footer,
    });

    const kb = new InlineKeyboard();
    const targetWebAppUrl = buildWebAppButtonUrl(
      params.webAppUrl,
      params.configId
        ? `tab=services&config=${encodeURIComponent(params.configId)}`
        : 'tab=services'
    );
    if (targetWebAppUrl) {
      kb.webApp(
        currencyAwareFa ? '📱 مشاهده در وب‌اپ' : '📱 Open in WebApp',
        targetWebAppUrl
      ).row();
    }
    kb.text(
      canTranslate
        ? tForLocale(ts, locale, 'menu_my_configs')
        : currencyAwareFa
          ? 'سرویس‌های من'
          : 'My Services',
      'subs:page:1'
    );

    await api.sendMessage(params.telegramId, text, {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  } catch (err) {
    logger.debug(
      { err, telegramId: params.telegramId, kind: params.kind },
      'Non-fatal: could not deliver WebApp config artifact message to Telegram chat'
    );
  }
}

/**
 * Notifies a recipient in Telegram when another user transfers wallet balance to them via WebApp.
 */
export async function sendWebAppWalletTransferNotification(
  api: Api | undefined,
  services: WebAppNotificationServices,
  params: {
    fromTelegramId: number;
    fromDisplayName?: string;
    toTelegramId: number;
    amount: number;
    recipientBalanceAfter: number;
    webAppUrl?: string;
  }
): Promise<void> {
  if (!api || typeof api.sendMessage !== 'function') return;

  try {
    const ts = services.translationService;
    const locale = resolveSafeLocale(await services.userService.getLocale(params.toTelegramId), ts);
    const isFa = locale === 'fa';
    const canTranslate = hasCatalogGet(ts);
    const currency = canTranslate
      ? tForLocale(ts, locale, 'currency_toman')
      : isFa
        ? 'تومان'
        : 'Toman';
    const senderLabel = params.fromDisplayName
      ? `${escapeTelegramMarkdown(params.fromDisplayName)} (\`${params.fromTelegramId}\`)`
      : `\`${params.fromTelegramId}\``;

    const text = buildUserScreen({
      emoji: '💸',
      title: isFa ? 'دریافت موجودی کیف پول' : 'Wallet Transfer Received',
      primary: {
        emoji: '💰',
        label: isFa ? 'مبلغ واریزی' : 'Amount Received',
        value: `+${localizedNumberForLocale(params.amount, locale)} ${currency}`,
        emphasizeValue: true,
      },
      sections: [
        {
          fields: [
            {
              emoji: '👤',
              label: isFa ? 'فرستنده' : 'From',
              value: senderLabel,
            },
            {
              emoji: '🏦',
              label: canTranslate
                ? tForLocale(ts, locale, 'wallet_available_balance')
                : isFa
                  ? 'موجودی قابل استفاده'
                  : 'Available Balance',
              value: `${localizedNumberForLocale(params.recipientBalanceAfter, locale)} ${currency}`,
            },
          ],
        },
      ],
    });

    const kb = new InlineKeyboard();
    const walletUrl = buildWebAppButtonUrl(params.webAppUrl, 'tab=wallet');
    if (walletUrl) {
      kb.webApp(isFa ? '👛 مشاهده کیف پول' : '👛 Open Wallet', walletUrl).row();
    }
    kb.text(
      canTranslate ? tForLocale(ts, locale, 'menu_close') : isFa ? 'بستن' : 'Close',
      'ui:dismiss'
    );

    await api.sendMessage(params.toTelegramId, text, {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  } catch (err) {
    logger.debug(
      { err, toTelegramId: params.toTelegramId },
      'Non-fatal: could not notify wallet transfer recipient'
    );
  }
}

/**
 * Notifies a recipient in Telegram when another user transfers a VPN service to them via WebApp.
 */
export async function sendWebAppConfigTransferNotification(
  api: Api | undefined,
  services: WebAppNotificationServices,
  params: {
    fromTelegramId: number;
    toTelegramId: number;
    configUsername: string;
    configId?: string;
    webAppUrl?: string;
  }
): Promise<void> {
  if (!api || typeof api.sendMessage !== 'function') return;

  try {
    const ts = services.translationService;
    const locale = resolveSafeLocale(await services.userService.getLocale(params.toTelegramId), ts);
    const isFa = locale === 'fa';
    const canTranslate = hasCatalogGet(ts);

    const text = buildUserScreen({
      emoji: '🎁',
      title: isFa ? 'سرویس جدید به حساب شما منتقل شد' : 'A Service Was Transferred to You',
      primary: {
        emoji: '🆔',
        label: isFa ? 'نام سرویس' : 'Service',
        value: `\`${sanitizeTelegramInlineCode(params.configUsername)}\``,
        emphasizeValue: true,
      },
      sections: [
        {
          fields: [
            {
              emoji: '👤',
              label: isFa ? 'فرستنده' : 'From',
              value: `\`${params.fromTelegramId}\``,
            },
          ],
        },
      ],
    });

    const kb = new InlineKeyboard();
    const servicesUrl = buildWebAppButtonUrl(
      params.webAppUrl,
      params.configId
        ? `tab=services&config=${encodeURIComponent(params.configId)}`
        : 'tab=services'
    );
    if (servicesUrl) {
      kb.webApp(isFa ? '📱 مشاهده در وب‌اپ' : '📱 Open in WebApp', servicesUrl).row();
    }
    kb.text(
      canTranslate
        ? tForLocale(ts, locale, 'menu_my_configs')
        : isFa
          ? 'سرویس‌های من'
          : 'My Services',
      'subs:page:1'
    );

    await api.sendMessage(params.toTelegramId, text, {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  } catch (err) {
    logger.debug(
      { err, toTelegramId: params.toTelegramId },
      'Non-fatal: could not notify config transfer recipient'
    );
  }
}

/**
 * Uploads a WebApp receipt buffer to Telegram via Bot API to obtain a genuine
 * Telegram `file_id` and `file_unique_id` (zero local disk storage, 100% compatible
 * with Telegram Admin Bot review and Admin WebApp photo streaming).
 *
 * Primary target: user's own Telegram chat (also acts as a permanent receipt artifact).
 * Fallback target: primary admin chat if the user hasn't started or blocked the bot.
 */
export async function uploadReceiptMediaToTelegram(
  api: Api,
  services: WebAppNotificationServices,
  params: {
    telegramId: number;
    amount: number;
    buffer: Buffer;
    mediaType: 'photo' | 'document';
    fileName: string;
    fallbackAdminIds?: number[];
  }
): Promise<{ fileId: string; fileUniqueId?: string }> {
  const ts = services.translationService;
  const locale = resolveSafeLocale(await services.userService.getLocale(params.telegramId), ts);
  const isFa = locale === 'fa';
  const currency = hasCatalogGet(ts)
    ? tForLocale(ts, locale, 'currency_toman')
    : isFa
      ? 'تومان'
      : 'Toman';
  const caption = isFa
    ? `🧾 رسید واریز شما به مبلغ *${localizedNumberForLocale(params.amount, locale)} ${currency}* از طریق وب‌اپ ثبت شد و در صف بررسی قرار گرفت.`
    : `🧾 Your top-up receipt for *${localizedNumberForLocale(params.amount, locale)} ${currency}* was submitted via WebApp and is pending review.`;

  const sendToChat = async (chatId: number, textCaption: string) => {
    const inputFile = new InputFile(params.buffer, params.fileName);
    if (params.mediaType === 'document') {
      const msg = await api.sendDocument(chatId, inputFile, {
        caption: textCaption,
        parse_mode: 'Markdown',
      });
      const doc = msg.document;
      if (!doc?.file_id) throw new Error('TELEGRAM_UPLOAD_NO_FILE_ID');
      return { fileId: doc.file_id, fileUniqueId: doc.file_unique_id };
    }
    const msg = await api.sendPhoto(chatId, inputFile, {
      caption: textCaption,
      parse_mode: 'Markdown',
    });
    const largest = msg.photo?.[msg.photo.length - 1];
    if (!largest?.file_id) throw new Error('TELEGRAM_UPLOAD_NO_FILE_ID');
    return { fileId: largest.file_id, fileUniqueId: largest.file_unique_id };
  };

  try {
    return await sendToChat(params.telegramId, caption);
  } catch (userChatErr) {
    logger.warn(
      { err: userChatErr, telegramId: params.telegramId },
      'Could not send WebApp receipt artifact to user chat; trying fallback admin chat'
    );
    const fallbackAdminId = params.fallbackAdminIds?.[0];
    if (fallbackAdminId) {
      return sendToChat(
        fallbackAdminId,
        `🧾 WebApp receipt upload for user \`${params.telegramId}\` (${params.amount})`
      );
    }
    throw userChatErr;
  }
}
