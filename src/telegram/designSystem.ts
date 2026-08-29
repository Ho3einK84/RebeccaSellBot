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

const EMOJI_PREFIX_REGEX =
  /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\uE0020-\uE007F])*\s*)+/u;

/**
 * Render a visual progress bar with emojis.
 */
export function renderProgressBar(
  used: number,
  total: number,
  options: { barLength?: number; theme?: 'traffic' | 'time' } = {}
): string {
  const { barLength = 8, theme = 'traffic' } = options;
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used) || used < 0) return '';
  const ratio = Math.max(0, Math.min(1, used / total));
  const percent = Math.round(ratio * 100);
  const filledCount = Math.round(ratio * barLength);
  const emptyCount = Math.max(0, barLength - filledCount);
  const fillIcon = theme === 'time' ? '🟪' : percent > 85 ? '🟥' : percent > 60 ? '🟨' : '🟩';
  const emptyIcon = '⬜️';
  return `[${fillIcon.repeat(filledCount)}${emptyIcon.repeat(emptyCount)}] ${percent}%`;
}

/**
 * Strips leading emoji characters and following whitespace from a string.
 */
export function stripLeadingEmoji(text: string): string {
  return text.replace(EMOJI_PREFIX_REGEX, '').trimStart();
}

/**
 * Format a unified header with an emoji and title, and optional italic subtitle.
 * Prevents emoji duplication if the title string already contains a leading emoji.
 */
export function buildHeader(emoji: string, title: string, subtitle?: string): string {
  const cleanTitle = title.trim();
  const titleWithoutEmoji = stripLeadingEmoji(cleanTitle);
  const effectiveEmoji =
    emoji ||
    (cleanTitle !== titleWithoutEmoji
      ? cleanTitle.slice(0, cleanTitle.length - titleWithoutEmoji.length).trim()
      : '');
  const unstarredTitle = titleWithoutEmoji.replace(/^\*+|\*+$/g, '').trim();
  const headerLine = effectiveEmoji
    ? `${effectiveEmoji} *${unstarredTitle}*`
    : `*${unstarredTitle}*`;
  if (!subtitle) return `${headerLine}\n`;
  const trimmedSubtitle = subtitle.trim();
  const isAlreadyItalic = trimmedSubtitle.startsWith('_') && trimmedSubtitle.endsWith('_');
  const hasUnderscore = trimmedSubtitle.includes('_');
  if (isAlreadyItalic || hasUnderscore) {
    return `${headerLine}\n${trimmedSubtitle}\n`;
  }
  return `${headerLine}\n_${trimmedSubtitle}_\n`;
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
  const cleanTitle = title.trim();
  const titleWithoutEmoji = stripLeadingEmoji(cleanTitle);
  const effectiveEmoji =
    sectionEmoji ||
    (cleanTitle !== titleWithoutEmoji
      ? cleanTitle.slice(0, cleanTitle.length - titleWithoutEmoji.length).trim()
      : '');
  const unstarredTitle = titleWithoutEmoji.replace(/^\*+|\*+$/g, '').trim();
  const heading = effectiveEmoji ? `${effectiveEmoji} *${unstarredTitle}*` : `*${unstarredTitle}*`;
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
