import { InlineKeyboard } from 'grammy';
import type { ConversationContext } from './types.js';
import { t } from './locale.js';

export type StatusType =
  'active' | 'inactive' | 'pending' | 'expired' | 'disabled' | 'healthy' | 'warning' | 'error';

/**
 * Format a unified header with an emoji and title, and optional italic subtitle.
 */
export function buildHeader(emoji: string, title: string, subtitle?: string): string {
  const headerLine = `${emoji} *${title}*`;
  return subtitle ? `${headerLine}\n_${subtitle}_\n` : `${headerLine}\n`;
}

/**
 * Render a standard status badge emoji and localized label.
 */
export function buildStatusBadge(status: StatusType, customLabel?: string): string {
  switch (status) {
    case 'active':
    case 'healthy':
      return `🟢 ${customLabel ?? 'فعال'}`;
    case 'inactive':
    case 'disabled':
      return `⏸️ ${customLabel ?? 'غیرفعال'}`;
    case 'pending':
    case 'warning':
      return `⏳ ${customLabel ?? 'در انتظار'}`;
    case 'expired':
    case 'error':
      return `⚠️ ${customLabel ?? 'منقضیشده'}`;
    default:
      return customLabel ?? status;
  }
}

/**
 * Helper to construct an InlineKeyboard button object.
 */
export function buildCtaButton(
  text: string,
  callbackData: string
): { text: string; callback_data: string } {
  return { text, callback_data: callbackData };
}

/**
 * Render a standardized confirmation keyboard with primary action and cancel button.
 */
export function buildConfirmationKeyboard(
  ctx: ConversationContext,
  confirmCallback: string,
  confirmLabelKey = 'buy_confirm_button',
  cancelCallback = 'conversation:cancel',
  cancelLabelKey = 'menu_cancel'
): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, confirmLabelKey), confirmCallback)
    .row()
    .text(t(ctx, cancelLabelKey), cancelCallback);
}

/**
 * Format a clean structured section card with label-value fields.
 */
export function buildSectionCard(
  title: string,
  fields: Array<{ label: string; value: string | number; emoji?: string }>
): string {
  const lines = fields.map(({ label, value, emoji }) => {
    const prefix = emoji ? `${emoji} ` : '';
    return `${prefix}*${label}:* ${value}`;
  });
  return `📌 *${title}*\n\n${lines.join('\n')}`;
}
