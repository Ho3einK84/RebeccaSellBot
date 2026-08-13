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
      return await prev(method, payload, signal);
    } catch (error) {
      const candidate = payload as { parse_mode?: string };
      if (!candidate.parse_mode || !isEntityParseError(error)) throw error;

      const plainPayload = { ...candidate };
      delete plainPayload.parse_mode;
      logger.warn(
        { method, parseMode: candidate.parse_mode },
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

  let backtickCount = 0;
  let asteriskCount = 0;
  let underscoreCount = 0;
  let inLinkText = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prevChar = i > 0 ? text[i - 1] : '';

    if (prevChar === '\\') continue; // Escaped character

    if (char === '`') {
      backtickCount++;
    } else if (char === '*') {
      asteriskCount++;
    } else if (char === '_') {
      underscoreCount++;
    } else if (char === '[') {
      inLinkText = true;
    } else if (char === ']') {
      inLinkText = false;
    }
  }

  if (backtickCount % 2 !== 0) {
    return { valid: false, error: 'Unmatched backtick (`) marker' };
  }
  if (asteriskCount % 2 !== 0) {
    return { valid: false, error: 'Unmatched asterisk (*) marker' };
  }
  if (underscoreCount % 2 !== 0) {
    return { valid: false, error: 'Unmatched underscore (_) marker' };
  }
  if (inLinkText) {
    return { valid: false, error: 'Unclosed link bracket ([)' };
  }

  return { valid: true };
}
