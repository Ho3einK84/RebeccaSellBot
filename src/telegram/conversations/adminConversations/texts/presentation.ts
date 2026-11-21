/**
 * Pure screen and keyboard builders for the Admin Bot Texts editor.
 */
import { InlineKeyboard } from 'grammy';
import type { ConversationContext } from '../../../types.js';
import type { SupportedLocale } from '../../../../domain/services/TranslationService.js';
import { callbackData, TELEGRAM_CALLBACK_MAX_BYTES } from '../../../callbackData.js';
import { localizedNumber, stripLeadingEmoji, t } from '../../../locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../../rendering.js';
import { buildUserEmptyState, buildUserScreen, type UserScreenSection } from '../../../ui.js';
import {
  alternateLocale,
  ESSENTIAL_USER_TEXTS,
  getEssentialTextItem,
  localeDisplayLabel,
  PLACEHOLDER_DESCRIPTIONS,
  TEXT_CATEGORIES,
  type TextCategory,
} from './catalog.js';

export const KEYS_PER_PAGE = 8;
const MAX_BUTTON_LABEL_CHARS = 48;
const TELEGRAM_SCREEN_BUDGET_CHARS = 3_800;

export type ScreenNotice = {
  kind: 'success' | 'error';
  text: string;
};

// ── Callback Encoding (Strictly <= 64 UTF-8 Bytes) ───────────────────────────

export function encodeTextKeyCallback(index: number, key: string): string {
  const direct = `text-pk:${key}`;
  if (Buffer.byteLength(direct, 'utf8') <= TELEGRAM_CALLBACK_MAX_BYTES) {
    return callbackData('text-pk', key);
  }
  return callbackData('text-pi', String(index));
}

export function decodeTextKeyCallback(
  data: string,
  pageKeys: readonly string[]
): string | undefined {
  if (data.startsWith('text-pk:')) {
    return data.slice('text-pk:'.length);
  }
  if (data.startsWith('text-pi:')) {
    const idx = Number.parseInt(data.slice('text-pi:'.length), 10);
    if (Number.isInteger(idx) && idx >= 0 && idx < pageKeys.length) {
      return pageKeys[idx];
    }
  }
  return undefined;
}

// ── Label & Truncation Helpers ───────────────────────────────────────────────

function truncateChars(value: string, maxChars: number): { text: string; truncated: boolean } {
  const chars = [...value];
  if (chars.length <= maxChars) return { text: value, truncated: false };
  return { text: `${chars.slice(0, Math.max(1, maxChars - 1)).join('')}…`, truncated: true };
}

function cleanSnippetFromText(raw: string): string {
  const firstLine =
    raw
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !/^[─\-=_]+$/u.test(line)) ?? '';
  return firstLine.replace(/[*_`]/gu, '').replace(/\s+/gu, ' ').trim();
}

function shortKeyHint(key: string): string {
  const trimmed = key.startsWith('admin_') ? key.slice('admin_'.length) : key;
  const parts = trimmed.split('_').filter(Boolean);
  if (parts.length <= 2) return trimmed;
  return `${parts[0]}_${parts[1]}`;
}

export type KeyListEntry = {
  key: string;
  activeText: string;
  isCustomized: boolean;
  essentialLabel?: string;
};

export function formatKeyListButtonLabels(
  entries: readonly KeyListEntry[],
  locale: SupportedLocale
): string[] {
  const baseLabels = entries.map((entry) => {
    if (entry.essentialLabel) return entry.essentialLabel;
    const snippet = cleanSnippetFromText(entry.activeText);
    const qualified = `${locale}.${entry.key}`;
    if (!snippet || snippet === qualified || snippet === entry.key) {
      return entry.key;
    }
    return snippet;
  });

  const labelCounts = new Map<string, number>();
  for (const label of baseLabels) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  return entries.map((entry, idx) => {
    let label = baseLabels[idx]!;
    if ((labelCounts.get(label) ?? 0) > 1 && !entry.essentialLabel) {
      label = `${label} (${shortKeyHint(entry.key)})`;
    }

    const hasLeadingEmoji = stripLeadingEmoji(label) !== label;
    if (entry.isCustomized) {
      if (hasLeadingEmoji) {
        const trimmed = truncateChars(label, MAX_BUTTON_LABEL_CHARS - 4).text;
        return `${trimmed} · ✏️`;
      }
      const trimmed = truncateChars(label, MAX_BUTTON_LABEL_CHARS - 3).text;
      return `✏️ ${trimmed}`;
    }

    return truncateChars(label, MAX_BUTTON_LABEL_CHARS).text;
  });
}

// ── 1. Minimal Main Hub ──────────────────────────────────────────────────────

export function buildHubScreen(ctx: ConversationContext, editLocale: SupportedLocale): string {
  const langLabel = localeDisplayLabel(editLocale);
  return buildUserScreen({
    emoji: '📝',
    title: t(ctx, 'admin_text_mode_title'),
    subtitle: t(ctx, 'admin_text_current_lang', { lang: langLabel }),
    footer: t(ctx, 'admin_text_mode_subtitle'),
  });
}

export function buildHubKeyboard(
  ctx: ConversationContext,
  editLocale: SupportedLocale,
  customizedCount: number
): InlineKeyboard {
  const targetLangLabel = localeDisplayLabel(alternateLocale(editLocale));
  return new InlineKeyboard()
    .text(t(ctx, 'admin_text_mode_essential'), 'text-mode:essential')
    .row()
    .text(t(ctx, 'admin_text_mode_categories'), 'text-mode:categories')
    .text(
      t(ctx, 'admin_text_mode_customized', {
        count: localizedNumber(customizedCount, ctx),
      }),
      'text-mode:customized'
    )
    .row()
    .text(t(ctx, 'admin_text_mode_search'), 'text-mode:search')
    .row()
    .text(t(ctx, 'admin_text_switch_lang', { lang: targetLangLabel }), 'text-lang:toggle')
    .row()
    .text(t(ctx, 'admin_menu_back_to_admin'), 'nav:admin');
}

// ── 2. Categories Screen & Keyboard ──────────────────────────────────────────

export function buildCategoriesScreen(
  ctx: ConversationContext,
  editLocale: SupportedLocale
): string {
  return buildUserScreen({
    emoji: '📂',
    title: t(ctx, 'admin_text_categories_title'),
    subtitle: t(ctx, 'admin_text_current_lang', { lang: localeDisplayLabel(editLocale) }),
    footer: t(ctx, 'admin_text_categories_subtitle'),
  });
}

export function buildCategoryKeyboard(ctx: ConversationContext): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  let count = 0;
  for (const cat of TEXT_CATEGORIES) {
    keyboard.text(t(ctx, cat.labelKey), callbackData('text-cat', cat.id));
    count++;
    if (count % 2 === 0) keyboard.row();
  }
  if (count % 2 !== 0) keyboard.row();
  keyboard.text(t(ctx, 'admin_text_back_to_menu'), 'text-nav:mode_select');
  return keyboard;
}

// ── 3. Unified List Screen & Keyboard ────────────────────────────────────────

export type KeyListScreenSpec = {
  emoji: string;
  title: string;
  subtitle?: string;
  footer?: string;
  entries: readonly KeyListEntry[];
  editLocale: SupportedLocale;
  page: number;
  pageCount: number;
  backCallback: string;
  backLabelKey: string;
  showSearchButton?: boolean;
  showClearSearchButton?: boolean;
  emptyBody?: string;
  emptyActionCallback?: string;
  emptyActionLabelKey?: string;
};

export function buildKeyListScreen(ctx: ConversationContext, spec: KeyListScreenSpec): string {
  if (spec.entries.length === 0) {
    return buildUserEmptyState(
      '📭',
      spec.title,
      spec.emptyBody ?? t(ctx, 'admin_text_no_keys_found'),
      spec.subtitle
    );
  }

  const pageMeta =
    spec.pageCount > 1
      ? t(ctx, 'admin_text_page_indicator', {
          page: localizedNumber(spec.page + 1, ctx),
          total_pages: localizedNumber(spec.pageCount, ctx),
        })
      : undefined;

  const subtitleParts = [localeDisplayLabel(spec.editLocale), spec.subtitle, pageMeta].filter(
    Boolean
  );

  return buildUserScreen({
    emoji: spec.emoji,
    title: spec.title,
    subtitle: subtitleParts.join(' · '),
    footer: spec.footer,
  });
}

export function buildKeyListKeyboard(
  ctx: ConversationContext,
  spec: KeyListScreenSpec
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (spec.entries.length === 0) {
    if (spec.emptyActionCallback && spec.emptyActionLabelKey) {
      keyboard.text(t(ctx, spec.emptyActionLabelKey), spec.emptyActionCallback).row();
    }
    if (spec.showClearSearchButton) {
      keyboard.text(t(ctx, 'admin_text_search_clear'), 'text-list:clear').row();
    }
    keyboard.text(t(ctx, spec.backLabelKey), spec.backCallback);
    return keyboard;
  }

  const labels = formatKeyListButtonLabels(spec.entries, spec.editLocale);
  spec.entries.forEach((entry, idx) => {
    keyboard.text(labels[idx]!, encodeTextKeyCallback(idx, entry.key)).row();
  });

  if (spec.page > 0 || spec.page < spec.pageCount - 1) {
    if (spec.page > 0) {
      keyboard.text(t(ctx, 'admin_text_prev_page'), 'text-p:prev');
    }
    if (spec.page < spec.pageCount - 1) {
      keyboard.text(t(ctx, 'admin_text_next_page'), 'text-p:next');
    }
    keyboard.row();
  }

  if (spec.showSearchButton || spec.showClearSearchButton) {
    if (spec.showSearchButton) {
      keyboard.text(t(ctx, 'admin_text_search_button'), 'text-list:search');
    }
    if (spec.showClearSearchButton) {
      keyboard.text(t(ctx, 'admin_text_search_clear'), 'text-list:clear');
    }
    keyboard.row();
  }

  keyboard.text(t(ctx, spec.backLabelKey), spec.backCallback);
  return keyboard;
}

// ── 4. Unified Search Prompt ─────────────────────────────────────────────────

export function buildSearchPromptScreen(
  ctx: ConversationContext,
  editLocale: SupportedLocale,
  category?: TextCategory
): string {
  const scopeLabel = category ? t(ctx, category.labelKey) : localeDisplayLabel(editLocale);
  return buildUserScreen({
    emoji: '🔍',
    title: t(ctx, 'admin_text_search_title'),
    subtitle: category
      ? `${scopeLabel} · ${localeDisplayLabel(editLocale)}`
      : localeDisplayLabel(editLocale),
    footer: t(ctx, 'admin_text_search_prompt'),
  });
}

export function buildSearchPromptKeyboard(
  ctx: ConversationContext,
  backCallback: string,
  backLabelKey: string
): InlineKeyboard {
  return new InlineKeyboard().text(t(ctx, backLabelKey), backCallback);
}

// ── 5. Single-Point Key Detail & Instant Editor ──────────────────────────────

export function formatPlaceholderLines(
  placeholders: readonly string[],
  uiLocale: SupportedLocale
): string {
  return placeholders
    .map((name) => {
      const desc = PLACEHOLDER_DESCRIPTIONS[name]?.[uiLocale] ?? PLACEHOLDER_DESCRIPTIONS[name]?.fa;
      const token = `\`{${sanitizeTelegramInlineCode(name)}}\``;
      return desc ? `• ${token} — ${escapeTelegramMarkdown(desc)}` : `• ${token}`;
    })
    .join('\n');
}

export type KeyDetailViewData = {
  key: string;
  editLocale: SupportedLocale;
  uiLocale: SupportedLocale;
  currentValue: string;
  defaultValue: string;
  isCustomized: boolean;
  placeholders: readonly string[];
  notice?: ScreenNotice;
};

export function buildKeyDetailScreen(ctx: ConversationContext, data: KeyDetailViewData): string {
  const essential = getEssentialTextItem(data.key);
  const title = essential
    ? stripLeadingEmoji(t(ctx, essential.labelKey))
    : t(ctx, 'admin_text_detail_title');

  const statusText = data.isCustomized
    ? `✏️ ${t(ctx, 'admin_text_status_customized')}`
    : t(ctx, 'admin_text_status_default');
  const metaLine = `\`${sanitizeTelegramInlineCode(data.key)}\` · ${localeDisplayLabel(data.editLocale)} · ${statusText}`;
  const subtitle = essential ? `${t(ctx, essential.descKey)}\n${metaLine}` : metaLine;

  const placeholderBlock =
    data.placeholders.length > 0 ? formatPlaceholderLines(data.placeholders, data.uiLocale) : '';
  const noticeText = data.notice?.text ?? '';

  // Compute safe character budgets so the composed message stays well within Telegram's 4096-char cap.
  const overheadChars = 320 + placeholderBlock.length + noticeText.length;
  const availableBudget = Math.max(400, TELEGRAM_SCREEN_BUDGET_CHARS - overheadChars);
  const currentCap = data.isCustomized
    ? Math.min(1_000, Math.floor(availableBudget * 0.6))
    : Math.min(1_600, availableBudget);
  const defaultCap = data.isCustomized
    ? Math.min(700, Math.max(200, availableBudget - currentCap))
    : 0;

  const currentClipped = truncateChars(data.currentValue, currentCap);
  const defaultClipped = data.isCustomized
    ? truncateChars(data.defaultValue, defaultCap)
    : { text: '', truncated: false };

  const sections: UserScreenSection[] = [
    {
      emoji: '💬',
      title: t(ctx, 'admin_text_current_value_label'),
      bullet: '',
      fields: [{ value: escapeTelegramMarkdown(currentClipped.text) }],
    },
  ];

  if (data.isCustomized) {
    sections.push({
      emoji: '📌',
      title: t(ctx, 'admin_text_default_value_label'),
      bullet: '',
      fields: [{ value: escapeTelegramMarkdown(defaultClipped.text) }],
    });
  }

  if (placeholderBlock) {
    sections.push({
      emoji: '🧩',
      title: t(ctx, 'admin_text_placeholders_label'),
      bullet: '',
      fields: [{ value: placeholderBlock }],
    });
  }

  const footerLines: string[] = [];
  if (currentClipped.truncated || defaultClipped.truncated) {
    footerLines.push(t(ctx, 'admin_text_preview_truncated'));
  }
  if (noticeText) {
    footerLines.push(noticeText);
  }
  footerLines.push(`⌨️ ${t(ctx, 'admin_text_direct_edit_hint')}`);

  return buildUserScreen({
    emoji: '📝',
    title,
    subtitle,
    sections,
    footer: footerLines.join('\n\n'),
  });
}

export function buildKeyDetailKeyboard(
  ctx: ConversationContext,
  editLocale: SupportedLocale,
  isCustomized: boolean
): InlineKeyboard {
  const otherLang = localeDisplayLabel(alternateLocale(editLocale));
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_text_edit_button'), 'text-act:edit')
    .text(t(ctx, 'admin_text_preview_button'), 'text-act:preview')
    .row()
    .text(t(ctx, 'admin_text_detail_switch_lang', { lang: otherLang }), 'text-act:lang');

  if (isCustomized) {
    keyboard.text(t(ctx, 'admin_text_reset_button'), 'text-act:reset');
  }

  keyboard.row().text(t(ctx, 'admin_text_back_to_list'), 'text-nav:back');
  return keyboard;
}

// ── 6. Focused Edit Prompt ───────────────────────────────────────────────────

export function buildKeyEditPromptScreen(
  ctx: ConversationContext,
  input: {
    key: string;
    editLocale: SupportedLocale;
    uiLocale: SupportedLocale;
    placeholders: readonly string[];
    notice?: ScreenNotice;
  }
): string {
  const sections: UserScreenSection[] = [];
  if (input.placeholders.length > 0) {
    sections.push({
      emoji: '🧩',
      title: t(ctx, 'admin_text_placeholders_label'),
      bullet: '',
      fields: [{ value: formatPlaceholderLines(input.placeholders, input.uiLocale) }],
    });
  }

  const footer = [input.notice?.text, t(ctx, 'admin_text_edit_prompt')]
    .filter(Boolean)
    .join('\n\n');

  return buildUserScreen({
    emoji: '✍️',
    title: t(ctx, 'admin_text_edit_title'),
    subtitle: `\`${sanitizeTelegramInlineCode(input.key)}\` · ${localeDisplayLabel(input.editLocale)}`,
    sections,
    footer,
  });
}

export function buildKeyEditPromptKeyboard(ctx: ConversationContext): InlineKeyboard {
  return new InlineKeyboard().text(t(ctx, 'admin_text_back_to_list'), 'text-nav:detail');
}

// ── 7. Live Preview Keyboard ─────────────────────────────────────────────────

export function buildPreviewKeyboard(
  ctx: ConversationContext,
  editLocale: SupportedLocale
): InlineKeyboard {
  const otherLang = localeDisplayLabel(alternateLocale(editLocale));
  return new InlineKeyboard()
    .text(t(ctx, 'admin_text_detail_switch_lang', { lang: otherLang }), 'text-act:lang')
    .row()
    .text(t(ctx, 'admin_text_preview_close'), 'text-nav:detail');
}

// ── 8. Reset Confirmation Screen & Keyboard ──────────────────────────────────

export function buildResetConfirmScreen(
  ctx: ConversationContext,
  key: string,
  editLocale: SupportedLocale
): string {
  return buildUserScreen({
    emoji: '⚠️',
    title: t(ctx, 'admin_text_reset_title'),
    subtitle: `\`${sanitizeTelegramInlineCode(key)}\` · ${localeDisplayLabel(editLocale)}`,
    footer: t(ctx, 'admin_text_reset_consequence'),
  });
}

export function buildResetConfirmKeyboard(ctx: ConversationContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'admin_confirm_button'), 'text-act:reset_confirm')
    .text(t(ctx, 'menu_cancel'), 'text-nav:detail');
}

// ── Helper for Essential Searchable Metadata ─────────────────────────────────

export function getEssentialKeys(): readonly string[] {
  return ESSENTIAL_USER_TEXTS.map((item) => item.key);
}
