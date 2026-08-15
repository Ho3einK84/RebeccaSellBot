import { InlineKeyboard } from 'grammy';
import type { ConversationContext } from './types.js';
import { ensurePersianLineDirection, t } from './locale.js';

export type StatusType =
  'active' | 'inactive' | 'pending' | 'expired' | 'disabled' | 'healthy' | 'warning' | 'error';

export type ScreenField = { label: string; value: string | number; emoji?: string };
export type ScreenSection = { title: string; emoji?: string; fields: ScreenField[] };
export type ScreenDefinition = {
  emoji: string;
  title: string;
  subtitle?: string;
  primary?: { label: string; value: string | number; emoji?: string };
  sections?: ScreenSection[];
  footer?: string;
};

/**
 * Format a unified header with an emoji and title, and optional italic subtitle.
 */
export function buildHeader(emoji: string, title: string, subtitle?: string): string {
  const headerLine = `${emoji} *${title}*`;
  return subtitle ? `${headerLine}\n_${subtitle}_\n` : `${headerLine}\n`;
}

/**
 * Render a standard status badge with copy resolved in the current locale.
 */
export function buildStatusBadge(
  ctx: ConversationContext,
  status: StatusType,
  customLabel?: string
): string {
  const labelKey =
    status === 'active' || status === 'healthy'
      ? 'ui_status_active'
      : status === 'inactive' || status === 'disabled'
        ? 'ui_status_inactive'
        : status === 'pending'
          ? 'ui_status_pending'
          : status === 'warning'
            ? 'ui_status_attention'
            : status === 'expired'
              ? 'ui_status_expired'
              : 'ui_status_error';
  switch (status) {
    case 'active':
    case 'healthy':
      return `🟢 ${customLabel ?? t(ctx, labelKey)}`;
    case 'inactive':
    case 'disabled':
      return `⚪️ ${customLabel ?? t(ctx, labelKey)}`;
    case 'pending':
      return `⏳ ${customLabel ?? t(ctx, labelKey)}`;
    case 'warning':
      return `⚠️ ${customLabel ?? t(ctx, labelKey)}`;
    case 'expired':
      return `⌛ ${customLabel ?? t(ctx, labelKey)}`;
    case 'error':
      return `🔴 ${customLabel ?? t(ctx, labelKey)}`;
    default:
      return customLabel ?? t(ctx, labelKey);
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
  fields: ScreenField[],
  sectionEmoji = '📌'
): string {
  const lines = fields.map(({ label, value, emoji }) => {
    const renderedValue = String(value);
    const hasSameStatusPrefix = emoji ? renderedValue.trimStart().startsWith(emoji) : false;
    const prefix = emoji && !hasSameStatusPrefix ? `${emoji} ` : '';
    return `${prefix}*${label}:* ${renderedValue}`;
  });
  const heading = sectionEmoji ? `${sectionEmoji} *${title}*` : `*${title}*`;
  return `${heading}\n\n${lines.join('\n')}`;
}

/**
 * Compose a scannable Telegram screen: one header, one primary state, then
 * compact supporting cards. Callers supply already-localized and markdown-safe
 * values; this helper owns hierarchy and icon discipline only.
 */
export function buildScreen(definition: ScreenDefinition): string {
  const blocks = [buildHeader(definition.emoji, definition.title, definition.subtitle).trimEnd()];
  if (definition.primary) {
    const primaryValue = String(definition.primary.value);
    const repeatsPrimaryEmoji = definition.primary.emoji
      ? primaryValue.trimStart().startsWith(definition.primary.emoji)
      : false;
    const icon =
      definition.primary.emoji && !repeatsPrimaryEmoji ? `${definition.primary.emoji} ` : '';
    blocks.push(`${icon}*${definition.primary.label}*\n${primaryValue}`);
  }
  for (const section of definition.sections ?? []) {
    blocks.push(buildSectionCard(section.title, section.fields, section.emoji ?? '📌'));
  }
  if (definition.footer) blocks.push(definition.footer);
  return ensurePersianLineDirection(blocks.join('\n\n'));
}

/** A friendly, actionable empty state built with the same screen hierarchy. */
export function buildEmptyState(
  emoji: string,
  title: string,
  body: string,
  actionHint?: string
): string {
  return buildScreen({ emoji, title, footer: [body, actionHint].filter(Boolean).join('\n\n') });
}

/** A focused input step for conversations that need the user to type or upload something. */
export function buildPromptScreen(
  emoji: string,
  title: string,
  body: string,
  subtitle?: string
): string {
  return buildScreen({ emoji, title, subtitle, footer: body });
}
