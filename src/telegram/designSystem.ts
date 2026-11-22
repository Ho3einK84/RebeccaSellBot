import { InlineKeyboard } from 'grammy';
import type { ConversationContext } from './types.js';
import {
  EMOJI_PREFIX_REGEX,
  ensureEnglishLineDirection,
  formatPersianScreen,
  t,
} from './locale.js';
import { escapeTelegramMarkdown } from './rendering.js';

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
  direction?: 'rtl' | 'ltr' | 'auto';
};

export type UserScreenField = {
  label?: string;
  value: string | number;
  emoji?: string;
  bullet?: string;
};
export type UserScreenSection = {
  title?: string;
  emoji?: string;
  bullet?: string;
  fields: UserScreenField[];
};
export type UserScreenDefinition = {
  emoji: string;
  title: string;
  subtitle?: string;
  primary?: {
    label: string;
    value: string | number;
    emoji?: string;
    inline?: boolean;
    emphasizeValue?: boolean;
  };
  sections?: UserScreenSection[];
  footer?: string;
  direction?: 'rtl' | 'ltr' | 'auto';
};

export type AdminScreenNoticeTone = 'success' | 'warning' | 'error' | 'info';
export type AdminScreenNotice = {
  tone: AdminScreenNoticeTone;
  text: string;
};
export type AdminScreenDefinition = {
  emoji: string;
  title: string;
  breadcrumb?: string;
  subtitle?: string;
  notice?: AdminScreenNotice;
  primary?: UserScreenDefinition['primary'];
  sections?: UserScreenSection[];
  footer?: string;
  direction?: 'rtl' | 'ltr' | 'auto';
};

export { EMOJI_PREFIX_REGEX };

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
 * Render a sleek, bracket-free progress bar for user-facing subscription cards.
 */
export function renderSleekProgressBar(
  used: number,
  total: number,
  options: { barLength?: number; theme?: 'traffic' | 'time'; locale?: 'fa' | 'en' } = {}
): string {
  const { barLength = 8, theme = 'traffic', locale = 'fa' } = options;
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used) || used < 0) return '';
  const ratio = Math.max(0, Math.min(1, used / total));
  const percent = Math.round(ratio * 100);
  const filledCount = Math.round(ratio * barLength);
  const emptyCount = Math.max(0, barLength - filledCount);
  const fillIcon = theme === 'time' ? '🟪' : percent > 85 ? '🟥' : percent > 60 ? '🟨' : '🟩';
  const emptyIcon = '⬜️';
  const percentText =
    locale === 'fa' ? `${percent.toLocaleString('fa-IR')}٪` : `${percent.toLocaleString('en-US')}%`;
  return `${fillIcon.repeat(filledCount)}${emptyIcon.repeat(emptyCount)} · ${percentText}`;
}

/**
 * Strips leading emoji characters and following whitespace from a string.
 */
export function stripLeadingEmoji(text: string): string {
  return text.replace(EMOJI_PREFIX_REGEX, '').trimStart();
}

function resolveHeadingParts(
  emoji: string,
  title: string
): { effectiveEmoji: string; unstarredTitle: string } {
  const cleanTitle = title.trim();
  const titleWithoutEmoji = stripLeadingEmoji(cleanTitle);
  const effectiveEmoji =
    emoji ||
    (cleanTitle !== titleWithoutEmoji
      ? cleanTitle.slice(0, cleanTitle.length - titleWithoutEmoji.length).trim()
      : '');
  const unstarredTitle = titleWithoutEmoji.replace(/^\*+|\*+$/g, '').trim();
  return { effectiveEmoji, unstarredTitle };
}

/**
 * Format a unified header with an emoji and title, and optional italic subtitle.
 * Prevents emoji duplication if the title string already contains a leading emoji.
 */
export function buildHeader(emoji: string, title: string, subtitle?: string): string {
  const { effectiveEmoji, unstarredTitle } = resolveHeadingParts(emoji, title);
  const headerLine = effectiveEmoji
    ? `${effectiveEmoji} *${unstarredTitle}*`
    : `*${unstarredTitle}*`;
  if (!subtitle) return `${headerLine}\n`;
  const trimmedSubtitle = subtitle.trim();
  const isAlreadyItalic =
    trimmedSubtitle.length >= 2 &&
    trimmedSubtitle.startsWith('_') &&
    trimmedSubtitle.endsWith('_') &&
    !hasOddTrailingBackslashes(trimmedSubtitle, trimmedSubtitle.length - 1);
  // Legacy Telegram Markdown v1 terminates italics on `_` even if preceded by `\`,
  // so any subtitle containing `_` must stay outside `_..._` wrappers.
  if (isAlreadyItalic || trimmedSubtitle.includes('_')) {
    return `${headerLine}\n${trimmedSubtitle}\n`;
  }
  return `${headerLine}\n_${trimmedSubtitle}_\n`;
}

/**
 * Format a clean, modern user-facing header with a plain subtitle.
 * Avoids italic wrappers that distort Persian typography and break on underscores.
 */
export function buildUserHeader(emoji: string, title: string, subtitle?: string): string {
  const { effectiveEmoji, unstarredTitle } = resolveHeadingParts(emoji, title);
  const headerLine = effectiveEmoji
    ? `${effectiveEmoji} *${unstarredTitle}*`
    : `*${unstarredTitle}*`;
  const trimmedSubtitle = subtitle?.trim();
  if (!trimmedSubtitle) {
    return headerLine;
  }
  return `${headerLine}\n${trimmedSubtitle}`;
}

function hasOddTrailingBackslashes(value: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i--) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
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
    const cleanLabel = label.trim();
    if (!cleanLabel || cleanLabel === '—') {
      return `${prefix}${renderedValue}`;
    }
    return `${prefix}*${cleanLabel}:* ${renderedValue}`;
  });
  const { effectiveEmoji, unstarredTitle } = resolveHeadingParts(sectionEmoji, title);
  const heading = effectiveEmoji ? `${effectiveEmoji} *${unstarredTitle}*` : `*${unstarredTitle}*`;
  return `${heading}\n\n${lines.join('\n')}`;
}

/**
 * Determine whether a screen definition represents a Persian (RTL) or English (LTR) screen.
 */
export function isPersianScreen(definition: ScreenDefinition | UserScreenDefinition): boolean {
  if (definition.direction === 'rtl') return true;
  if (definition.direction === 'ltr') return false;
  if (/[\u0600-\u06ff]/u.test(definition.title)) return true;
  if (definition.primary?.label && /[\u0600-\u06ff]/u.test(String(definition.primary.label))) {
    return true;
  }
  if (
    definition.sections?.some(
      (s) =>
        (s.title && /[\u0600-\u06ff]/u.test(s.title)) ||
        (!s.title && s.fields.some((f) => f.label && /[\u0600-\u06ff]/u.test(f.label)))
    )
  ) {
    return true;
  }
  if (definition.footer && /[\u0600-\u06ff]/u.test(definition.footer)) {
    return true;
  }
  return false;
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
  const content = blocks.join('\n\n');
  return isPersianScreen(definition)
    ? formatPersianScreen(content)
    : ensureEnglishLineDirection(content);
}

/** A friendly, actionable empty state built with the same screen hierarchy. */
export function buildEmptyState(
  emoji: string,
  title: string,
  body: string,
  actionHint?: string,
  direction?: 'rtl' | 'ltr' | 'auto'
): string {
  const cleanBody = emoji ? stripLeadingEmoji(body) : body;
  return buildScreen({
    emoji,
    title,
    footer: [cleanBody, actionHint].filter(Boolean).join('\n\n'),
    direction,
  });
}

/** A focused input step for conversations that need the user to type or upload something. */
export function buildPromptScreen(
  emoji: string,
  title: string,
  body: string,
  subtitle?: string,
  direction?: 'rtl' | 'ltr' | 'auto'
): string {
  return buildScreen({ emoji, title, subtitle, footer: body, direction });
}

/** Format a sleek, minimal user-facing section with tight spacing and crisp bullets. */
export function buildUserSection(section: UserScreenSection): string {
  const defaultBullet = section.bullet ?? '•';
  const lines = section.fields
    .filter((field) => String(field.value).length > 0)
    .map(({ label, value, emoji, bullet }) => {
      const renderedValue = String(value);
      const cleanLabel = label?.trim() ?? '';
      const hasSameStatusPrefix = emoji ? renderedValue.trimStart().startsWith(emoji) : false;
      const effectiveBullet = bullet ?? defaultBullet;
      const prefix =
        emoji && !hasSameStatusPrefix
          ? `${emoji} `
          : !emoji && effectiveBullet
            ? `${effectiveBullet} `
            : '';
      if (!cleanLabel || cleanLabel === '—') {
        return `${prefix}${renderedValue}`;
      }
      return `${prefix}*${cleanLabel}:* ${renderedValue}`;
    });

  const body = lines.join('\n');
  if (!section.title) return body;

  const { effectiveEmoji, unstarredTitle } = resolveHeadingParts(
    section.emoji ?? '',
    section.title
  );
  const heading = effectiveEmoji ? `${effectiveEmoji} *${unstarredTitle}*` : `*${unstarredTitle}*`;
  return body ? `${heading}\n${body}` : heading;
}

function formatPrimaryHeroValue(rawValue: string, emphasizeValue?: boolean): string {
  if (!emphasizeValue) return rawValue;
  const trimmed = rawValue.trim();
  if (!trimmed || /[*_`[\]()]/u.test(trimmed) || EMOJI_PREFIX_REGEX.test(trimmed)) {
    return rawValue;
  }
  return `*${trimmed}*`;
}

/**
 * Compose a unified, refined, minimal user-facing Telegram screen.
 */
export function buildUserScreen(definition: UserScreenDefinition): string {
  const blocks: string[] = [
    buildUserHeader(definition.emoji, definition.title, definition.subtitle),
  ];

  if (definition.primary) {
    const rawValue = String(definition.primary.value);
    const repeatsPrimaryEmoji = definition.primary.emoji
      ? rawValue.trimStart().startsWith(definition.primary.emoji)
      : false;
    const icon =
      definition.primary.emoji && !repeatsPrimaryEmoji ? `${definition.primary.emoji} ` : '';
    const displayValue = formatPrimaryHeroValue(rawValue, definition.primary.emphasizeValue);
    if (definition.primary.inline) {
      blocks.push(`${icon}*${definition.primary.label}:* ${displayValue}`);
    } else {
      blocks.push(`${icon}*${definition.primary.label}*\n${displayValue}`);
    }
  }

  for (const section of definition.sections ?? []) {
    const rendered = buildUserSection(section);
    if (rendered) {
      blocks.push(rendered);
    }
  }

  const trimmedFooter = definition.footer?.trim();
  if (trimmedFooter) {
    blocks.push(trimmedFooter);
  }

  const content = blocks.join('\n\n');
  return isPersianScreen(definition)
    ? formatPersianScreen(content)
    : ensureEnglishLineDirection(content);
}

/** Clean user-facing empty/error state without duplicate header-body emoji clutter. */
export function buildUserEmptyState(
  emoji: string,
  title: string,
  body: string,
  actionHint?: string,
  direction?: 'rtl' | 'ltr' | 'auto'
): string {
  const cleanBody = emoji ? stripLeadingEmoji(body) : body;
  const cleanHint = actionHint?.trim();
  return buildUserScreen({
    emoji,
    title,
    footer: [cleanBody, cleanHint].filter(Boolean).join('\n\n'),
    direction,
  });
}

/** Clean user-facing conversational prompt step. */
export function buildUserPromptScreen(
  emoji: string,
  title: string,
  body: string,
  subtitle?: string,
  direction?: 'rtl' | 'ltr' | 'auto'
): string {
  return buildUserScreen({
    emoji,
    title,
    subtitle,
    footer: body,
    direction,
  });
}

/** Compose a sleek breadcrumb path for admin screens (e.g. `فروش › بسته‌ها`). */
export function buildBreadcrumb(...parts: Array<string | undefined | null>): string {
  return parts
    .map((part) => (part ? escapeTelegramMarkdown(stripLeadingEmoji(part.trim())) : ''))
    .filter(Boolean)
    .join(' › ');
}

function formatAdminNotice(notice: AdminScreenNotice): string {
  const icon =
    notice.tone === 'success'
      ? '✅'
      : notice.tone === 'warning'
        ? '⚠️'
        : notice.tone === 'error'
          ? '❌'
          : 'ℹ️';
  const clean = stripLeadingEmoji(notice.text.trim());
  return `${icon} ${clean}`;
}

/**
 * Compose a unified, minimal, RTL-safe admin Telegram screen matching the v2
 * user design system (no Persian-breaking italics, tight spacing, clean bullets,
 * optional breadcrumb and inline feedback notice).
 */
export function buildAdminScreen(definition: AdminScreenDefinition): string {
  const subtitleParts = [definition.breadcrumb?.trim(), definition.subtitle?.trim()].filter(
    Boolean
  );
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join('\n') : undefined;
  const noticeSection: UserScreenSection[] = definition.notice
    ? [
        {
          bullet: '',
          fields: [{ value: formatAdminNotice(definition.notice) }],
        },
      ]
    : [];

  return buildUserScreen({
    emoji: definition.emoji,
    title: definition.title,
    subtitle,
    primary: definition.primary,
    sections: [...noticeSection, ...(definition.sections ?? [])],
    footer: definition.footer,
    direction: definition.direction,
  });
}

/** Minimal admin empty/error screen with duplicate-emoji stripping and optional breadcrumb. */
export function buildAdminEmptyState(
  emoji: string,
  title: string,
  body: string,
  options?: {
    breadcrumb?: string;
    actionHint?: string;
    notice?: AdminScreenNotice;
    direction?: 'rtl' | 'ltr' | 'auto';
  }
): string {
  const cleanBody = emoji ? stripLeadingEmoji(body) : body;
  const cleanHint = options?.actionHint?.trim();
  return buildAdminScreen({
    emoji,
    title,
    breadcrumb: options?.breadcrumb,
    notice: options?.notice,
    footer: [cleanBody, cleanHint].filter(Boolean).join('\n\n'),
    direction: options?.direction,
  });
}

export interface AdminPromptScreenSpec {
  emoji: string;
  title: string;
  body: string;
  breadcrumb?: string;
  subtitle?: string;
  currentLabel?: string;
  currentValue?: string;
  error?: string;
  hint?: string;
  direction?: 'rtl' | 'ltr' | 'auto';
}

/** Focused admin input prompt with optional current value and inline retry error notice. */
export function buildAdminPromptScreen(spec: AdminPromptScreenSpec): string;
export function buildAdminPromptScreen(
  emoji: string,
  title: string,
  body: string,
  options?: {
    breadcrumb?: string;
    subtitle?: string;
    currentLabel?: string;
    currentValue?: string;
    error?: string;
    hint?: string;
    direction?: 'rtl' | 'ltr' | 'auto';
  }
): string;
export function buildAdminPromptScreen(
  emojiOrSpec: string | AdminPromptScreenSpec,
  titleArg?: string,
  bodyArg?: string,
  optionsArg?: {
    breadcrumb?: string;
    subtitle?: string;
    currentLabel?: string;
    currentValue?: string;
    error?: string;
    hint?: string;
    direction?: 'rtl' | 'ltr' | 'auto';
  }
): string {
  const spec: AdminPromptScreenSpec =
    typeof emojiOrSpec === 'string'
      ? {
          emoji: emojiOrSpec,
          title: titleArg ?? '',
          body: bodyArg ?? '',
          ...optionsArg,
        }
      : emojiOrSpec;

  return buildAdminScreen({
    emoji: spec.emoji,
    title: spec.title,
    breadcrumb: spec.breadcrumb,
    subtitle: spec.subtitle,
    notice: spec.error ? { tone: 'error', text: spec.error } : undefined,
    ...(spec.currentValue !== undefined && spec.currentValue !== ''
      ? {
          primary: {
            label: spec.currentLabel ?? '•',
            value: spec.currentValue,
            inline: true,
          },
        }
      : {}),
    footer: [spec.body, spec.hint].filter(Boolean).join('\n\n'),
    direction: spec.direction,
  });
}
