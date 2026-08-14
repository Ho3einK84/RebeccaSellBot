import { describe, expect, it, vi } from 'vitest';
import {
  escapeTelegramMarkdown,
  escapeTelegramMarkdownParams,
  isEntityParseError,
  safeFormattingTransformer,
  sanitizeTelegramInlineCode,
} from '../../src/telegram/rendering.js';

describe('Telegram rendering safety', () => {
  it('escapes user-controlled legacy Markdown entity characters', () => {
    expect(escapeTelegramMarkdown('discount_percent *[x]* `code` \\')).toBe(
      'discount\\_percent \\*\\[x]\\* \\`code\\` \\\\'
    );
    expect(escapeTelegramMarkdown('\\*not bold*')).toBe('\\\\\\*not bold\\*');
  });

  it('sanitizes inline code values without escaping underscores or special characters', () => {
    const rawUsername = 'h_6698253699_28';
    expect(sanitizeTelegramInlineCode(rawUsername)).toBe('h_6698253699_28');
    expect(sanitizeTelegramInlineCode('promo_code_100*test[x]')).toBe('promo_code_100*test[x]');
    // Backticks should be stripped to avoid breaking code spans
    expect(sanitizeTelegramInlineCode('test`injection`code')).toBe('testinjectioncode');
    expect(sanitizeTelegramInlineCode(null)).toBe('');
    expect(sanitizeTelegramInlineCode(undefined)).toBe('');
    expect(sanitizeTelegramInlineCode(12345)).toBe('12345');
  });

  it('does not add backslashes to trusted keys in escapeTelegramMarkdownParams', () => {
    const params = {
      username: 'h_6698253699_28',
      other: 'plain_text_value',
    };
    const escaped = escapeTelegramMarkdownParams(params, ['username']);
    expect(escaped?.username).toBe('h_6698253699_28');
    expect(escaped?.other).toBe('plain\\_text\\_value');
  });

  it('ensures service names with underscores inside code spans contain no backslashes', () => {
    const username = 'h_6698253699_28';
    const codeSpan = `\`${sanitizeTelegramInlineCode(username)}\``;
    expect(codeSpan).toBe('`h_6698253699_28`');
    expect(codeSpan).not.toContain('\\');
  });

  it('recognizes Telegram entity parser failures', () => {
    expect(
      isEntityParseError(
        new Error("400: Bad Request: can't parse entities: Can't find end of the entity")
      )
    ).toBe(true);
    expect(isEntityParseError(new Error('network unavailable'))).toBe(false);
  });

  it('retries malformed formatted messages as plain text', async () => {
    const previous = vi
      .fn()
      .mockRejectedValueOnce(new Error("can't parse entities"))
      .mockResolvedValueOnce({ ok: true, result: { message_id: 1 } });
    const transformer = safeFormattingTransformer();

    const result = await transformer(
      previous,
      'sendMessage',
      { chat_id: 1, text: 'broken _ entity', parse_mode: 'Markdown' },
      undefined
    );

    expect(result.ok).toBe(true);
    expect(previous).toHaveBeenCalledTimes(2);
    expect(previous.mock.calls[1]![1]).toEqual({ chat_id: 1, text: 'broken _ entity' });
  });
});
