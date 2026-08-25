import type { Transformer } from 'grammy';
import { logger } from '../infra/logger.js';

/**
 * Escape values interpolated into Telegram's legacy Markdown templates.
 * Templates remain administrator-editable, while untrusted values can never
 * open an entity or turn user data into formatting.
 */
export function escapeTelegramMarkdown(value: string | number): string {
  // Escape an existing backslash first. Otherwise user input such as `\*`
  // could neutralize the escape we add for the following Markdown marker.
  return String(value).replace(/([\\_*[\x60])/gu, '\\$1');
}

/**
 * Sanitize values interpolated into Telegram's legacy Markdown inline code spans (`...`).
 *
 * In Telegram legacy Markdown, code spans treat characters like `_`, `*`, `\`, and `[` as
 * raw literals, so escaping them with backslashes is harmful and shows visible `\`.
 * However, backticks (`\``) would prematurely terminate the code span, so we strip them.
 */
export function sanitizeTelegramInlineCode(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/`/gu, '');
}

export const sanitizeInlineCode = sanitizeTelegramInlineCode;

export function escapeTelegramMarkdownParams(
  params: Record<string, string | number> | undefined,
  trustedKeys: readonly string[] = []
): Record<string, string | number> | undefined {
  if (!params) return undefined;
  const trusted = new Set(trustedKeys);
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      trusted.has(key) ? value : escapeTelegramMarkdown(value),
    ])
  );
}

/** Telegram error emitted when an editable template contains invalid markup. */
export function isEntityParseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("can't parse entities") || message.includes('parse entities');
}

/**
 * Last-resort delivery guard. Valid templates retain their formatting; a
 * malformed database override is retried as plain text instead of leaving a
 * dead button or a blank screen.
 */
export function safeFormattingTransformer(): Transformer {
  return async (prev, method, payload, signal) => {
    try {
      const res = await prev(method, payload, signal);
      if (!res.ok && res.description && isEntityParseError(new Error(res.description))) {
        const candidate = payload as { parse_mode?: string };
        if (candidate.parse_mode) {
          const plainPayload = { ...candidate };
          delete plainPayload.parse_mode;
          logger.warn(
            { method, parseMode: candidate.parse_mode, description: res.description },
            'Telegram template markup was invalid; retrying safely as plain text'
          );
          return await prev(method, plainPayload as typeof payload, signal);
        }
      }
      return res;
    } catch (error) {
      const candidate = payload as { parse_mode?: string };
      if (!candidate.parse_mode || !isEntityParseError(error)) throw error;

      const plainPayload = { ...candidate };
      delete plainPayload.parse_mode;
      logger.warn(
        { method, parseMode: candidate.parse_mode, error },
        'Telegram template markup was invalid; retrying safely as plain text'
      );
      return prev(method, plainPayload as typeof payload, signal);
    }
  };
}

/**
 * Validate Telegram Markdown v1 syntax before persisting template changes.
 */
export function validateTelegramMarkdown(text: string): { valid: boolean; error?: string } {
  if (!text) return { valid: true };

  let inBacktick = false;
  let inAsterisk = false;
  let inUnderscore = false;
  let inLinkText = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prevChar = i > 0 ? text[i - 1] : '';

    if (char === '`') {
      inBacktick = !inBacktick;
      continue;
    }

    if (inBacktick) continue;

    if (char === '*') {
      if (!inAsterisk && prevChar === '\\') continue;
      inAsterisk = !inAsterisk;
    } else if (char === '_') {
      if (!inUnderscore && prevChar === '\\') continue;
      inUnderscore = !inUnderscore;
    } else if (char === '[') {
      if (prevChar === '\\') continue;
      inLinkText = true;
    } else if (char === ']') {
      if (prevChar === '\\') continue;
      inLinkText = false;
    }
  }

  if (inBacktick) {
    return { valid: false, error: 'Unmatched backtick (`) marker' };
  }
  if (inAsterisk) {
    return { valid: false, error: 'Unmatched asterisk (*) marker' };
  }
  if (inUnderscore) {
    return { valid: false, error: 'Unmatched underscore (_) marker' };
  }
  if (inLinkText) {
    return { valid: false, error: 'Unclosed link bracket ([)' };
  }

  return { valid: true };
}
