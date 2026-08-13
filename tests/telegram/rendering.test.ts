import { describe, expect, it, vi } from 'vitest';
import {
  escapeTelegramMarkdown,
  isEntityParseError,
  safeFormattingTransformer,
} from '../../src/telegram/rendering.js';

describe('Telegram rendering safety', () => {
  it('escapes user-controlled legacy Markdown entity characters', () => {
    expect(escapeTelegramMarkdown('discount_percent *[x]* `code` \\')).toBe(
      'discount\\_percent \\*\\[x]\\* \\`code\\` \\\\'
    );
    expect(escapeTelegramMarkdown('\\*not bold*')).toBe('\\\\\\*not bold\\*');
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
