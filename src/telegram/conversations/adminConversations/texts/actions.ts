/**
 * Validation, persistence, unified search, and safe live-preview actions for
 * the Admin Bot Texts editor.
 */
import type { ConversationContext, MyConversation } from '../../../types.js';
import { logger } from '../../../../infra/logger.js';
import {
  DEFAULT_SETTINGS,
  validateTranslationOverrideDetailed,
  type SupportedLocale,
} from '../../../../domain/services/TranslationService.js';
import { ensureEnglishLineDirection, ensurePersianLineDirection, t } from '../../../locale.js';
import {
  escapeTelegramMarkdown,
  isEntityParseError,
  sanitizeTelegramInlineCode,
  validateTelegramMarkdown,
} from '../../../rendering.js';
import { promptInConversation } from '../../../ui.js';
import {
  getEssentialTextItem,
  getSamplePlaceholderValues,
  localeDisplayLabel,
  type TextCategory,
} from './catalog.js';
import { buildPreviewKeyboard, type ScreenNotice } from './presentation.js';

const MAX_LIVE_PREVIEW_CHARS = 3_400;

export function formatValidationError(
  validation: ReturnType<typeof validateTranslationOverrideDetailed>,
  ctx: ConversationContext
): string {
  if (validation.errorReason === 'EMPTY') {
    return t(ctx, 'admin_text_error_empty');
  }
  if (validation.errorReason === 'TOO_LONG') {
    return t(ctx, 'admin_text_error_too_long');
  }

  const lines: string[] = [];
  if (validation.missingPlaceholders.length > 0) {
    lines.push(
      t(ctx, 'admin_text_error_missing_placeholders', {
        placeholders: validation.missingPlaceholders
          .map((p) => `\`{${sanitizeTelegramInlineCode(p)}}\``)
          .join('، '),
      })
    );
  }
  if (validation.extraPlaceholders.length > 0) {
    lines.push(
      t(ctx, 'admin_text_error_extra_placeholders', {
        placeholders: validation.extraPlaceholders
          .map((p) => `\`{${sanitizeTelegramInlineCode(p)}}\``)
          .join('، '),
      })
    );
  }
  return lines.length > 0 ? lines.join('\n') : t(ctx, 'admin_text_error_empty');
}

/**
 * Validate Telegram Markdown v1 syntax on a translation template without
 * falsely flagging underscores inside `{snake_case}` placeholders.
 */
export function validateTemplateMarkdown(template: string): { valid: boolean; error?: string } {
  const placeholderNeutralized = template.replace(/\{[a-z0-9_]+\}/giu, 'X');
  return validateTelegramMarkdown(placeholderNeutralized);
}

export async function saveTextOverride(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  qualifiedKey: string,
  rawText: string,
  defaultValue: string
): Promise<{ ok: boolean; notice: ScreenNotice }> {
  const newText = rawText.trim();
  const validation = validateTranslationOverrideDetailed(newText, defaultValue);
  if (!validation.valid) {
    return {
      ok: false,
      notice: { kind: 'error', text: formatValidationError(validation, activeCtx) },
    };
  }

  if (validateTemplateMarkdown(defaultValue).valid) {
    const mdValidation = validateTemplateMarkdown(newText);
    if (!mdValidation.valid) {
      return {
        ok: false,
        notice: {
          kind: 'error',
          text: t(activeCtx, 'admin_text_invalid_markdown', {
            error: escapeTelegramMarkdown(mdValidation.error ?? ''),
          }),
        },
      };
    }
  }

  try {
    await conversation.external((outsideCtx) =>
      (outsideCtx?.services ?? activeCtx.services)!.translationService.updateSetting(
        qualifiedKey,
        newText
      )
    );
    return {
      ok: true,
      notice: { kind: 'success', text: t(activeCtx, 'admin_text_saved') },
    };
  } catch (err) {
    logger.error({ err, key: qualifiedKey }, 'Failed to update text setting override');
    return {
      ok: false,
      notice: { kind: 'error', text: t(activeCtx, 'operation_failed') },
    };
  }
}

export async function resetTextOverride(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  qualifiedKey: string
): Promise<{ ok: boolean; notice: ScreenNotice }> {
  try {
    await conversation.external((outsideCtx) =>
      (outsideCtx?.services ?? activeCtx.services)!.translationService.deleteSetting(qualifiedKey)
    );
    return {
      ok: true,
      notice: { kind: 'success', text: t(activeCtx, 'admin_text_reset_success') },
    };
  } catch (err) {
    logger.error({ err, key: qualifiedKey }, 'Failed to reset text setting override');
    return {
      ok: false,
      notice: { kind: 'error', text: t(activeCtx, 'operation_failed') },
    };
  }
}

/**
 * Unified search used by both global search and in-category filtering.
 * Feeds essential human-readable labels/descriptions into TranslationService's
 * normalized search engine.
 */
export async function searchKeysUnified(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  query: string,
  editLocale: SupportedLocale,
  category?: TextCategory
): Promise<string[]> {
  return conversation.external((outsideCtx) => {
    const ts = (outsideCtx?.services ?? activeCtx.services)!.translationService;
    const extraText = (key: string): string[] | undefined => {
      const essential = getEssentialTextItem(key);
      if (!essential) return undefined;
      return [
        DEFAULT_SETTINGS[`fa.${essential.labelKey}`] ?? '',
        DEFAULT_SETTINGS[`fa.${essential.descKey}`] ?? '',
        DEFAULT_SETTINGS[`en.${essential.labelKey}`] ?? '',
        DEFAULT_SETTINGS[`en.${essential.descKey}`] ?? '',
      ];
    };
    return ts.searchTranslations(query, editLocale, {
      filter: category ? category.matches : undefined,
      extraText,
    });
  });
}

// ── Real Markdown Live Preview with Safe Fallback ────────────────────────────

export type LivePreviewPayload = {
  text: string;
  plainFallbackText: string;
  parseMode: 'Markdown' | undefined;
  usedFallback: boolean;
};

export function composeLivePreviewPayload(
  ctx: ConversationContext,
  key: string,
  editLocale: SupportedLocale,
  renderedSample: string
): LivePreviewPayload {
  const directedSample =
    editLocale === 'fa'
      ? ensurePersianLineDirection(renderedSample)
      : ensureEnglishLineDirection(renderedSample);

  const sampleChars = [...directedSample];
  const truncated = sampleChars.length > MAX_LIVE_PREVIEW_CHARS;
  const visibleSample = truncated
    ? `${sampleChars.slice(0, MAX_LIVE_PREVIEW_CHARS - 1).join('')}…`
    : directedSample;

  const title = t(ctx, 'admin_text_preview_title');
  const langBadge = localeDisplayLabel(editLocale);
  const truncNote = truncated ? `\n\n${t(ctx, 'admin_text_preview_truncated')}` : '';

  const markdownHeader = `👁️ *${title}*\n\`${sanitizeTelegramInlineCode(key)}\` · ${langBadge}`;
  const markdownMessage = `${markdownHeader}\n\n${visibleSample}${truncNote}`;
  const plainHeader = `👁️ ${title}\n${key} · ${langBadge}`;
  const plainFallbackText = `${plainHeader}\n\n${visibleSample}${truncNote}\n\n${t(ctx, 'admin_text_preview_fallback_notice')}`;

  if (validateTelegramMarkdown(markdownMessage).valid) {
    return {
      text: markdownMessage,
      plainFallbackText,
      parseMode: 'Markdown',
      usedFallback: false,
    };
  }

  return {
    text: plainFallbackText,
    plainFallbackText,
    parseMode: undefined,
    usedFallback: true,
  };
}

export async function renderLivePreview(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  key: string,
  editLocale: SupportedLocale
): Promise<void> {
  const qualifiedKey = `${editLocale}.${key}`;
  const sampleValues = getSamplePlaceholderValues(editLocale);
  const renderedSample = await conversation.external((outsideCtx) =>
    (outsideCtx?.services ?? activeCtx.services)!.translationService.get(
      qualifiedKey,
      editLocale,
      sampleValues
    )
  );

  const payload = composeLivePreviewPayload(activeCtx, key, editLocale, renderedSample);
  const keyboard = buildPreviewKeyboard(activeCtx, editLocale);

  if (payload.parseMode === 'Markdown') {
    try {
      await promptInConversation(conversation, activeCtx, payload.text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    } catch (err) {
      if (!isEntityParseError(err)) throw err;
      logger.warn(
        { err, key: qualifiedKey },
        'Live preview Markdown rejected; using plain fallback'
      );
      await promptInConversation(conversation, activeCtx, payload.plainFallbackText, {
        reply_markup: keyboard,
      });
      return;
    }
  }

  await promptInConversation(conversation, activeCtx, payload.text, {
    reply_markup: keyboard,
  });
}
