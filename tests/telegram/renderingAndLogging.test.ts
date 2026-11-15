import { describe, expect, it, vi } from 'vitest';
import { GrammyError, HttpError, type BotError } from 'grammy';
import { EN_TEXTS } from '../../src/domain/services/TranslationCatalog.en.js';
import { FA_TEXTS } from '../../src/domain/services/TranslationCatalog.fa.js';
import { DEFAULT_SETTINGS } from '../../src/domain/services/TranslationCatalog.js';
import { templatePlaceholders } from '../../src/domain/services/TranslationService.js';
import {
  TELEGRAM_CALLBACK_MAX_BYTES,
  callbackData,
  isUuidCallbackValue,
} from '../../src/telegram/callbackData.js';
import { buildScreen } from '../../src/telegram/designSystem.js';
import { panelCallback } from '../../src/telegram/features/admin/panelRoutes.js';
import { buildSubscriptionActionKeyboard } from '../../src/telegram/features/subscriptions/routes.js';
import {
  escapeTelegramMarkdown,
  escapeTelegramMarkdownParams,
  isEntityParseError,
  safeFormattingTransformer,
  sanitizeTelegramInlineCode,
  validateTelegramMarkdown,
} from '../../src/telegram/rendering.js';
import {
  extractBotErrorDiagnostics,
  sanitizeObject,
  sanitizeSecrets,
} from '../../src/telegram/telegramLogging.js';
import type { MenuContext } from '../../src/telegram/types.js';
import { createBotHarness } from './helpers/botHarness.js';

describe('Telegram rendering safety and Markdown validation', () => {
  it('escapes user-controlled legacy Markdown entity characters', () => {
    expect(escapeTelegramMarkdown('discount_percent *[x]* `code` \\')).toBe(
      'discount\\_percent \\*\\[x]\\* \\`code\\` \\\\'
    );
    expect(escapeTelegramMarkdown('\\*not bold*')).toBe('\\\\\\*not bold\\*');
  });

  it('sanitizes inline code values without escaping underscores or special characters', () => {
    expect(sanitizeTelegramInlineCode('h_6698253699_28')).toBe('h_6698253699_28');
    expect(sanitizeTelegramInlineCode('promo_code_100*test[x]')).toBe('promo_code_100*test[x]');
    expect(sanitizeTelegramInlineCode('test`injection`code')).toBe('testinjectioncode');
    expect(sanitizeTelegramInlineCode(null)).toBe('');
    expect(sanitizeTelegramInlineCode(undefined)).toBe('');
    expect(sanitizeTelegramInlineCode(12345)).toBe('12345');
  });

  it('does not add backslashes to trusted keys in escapeTelegramMarkdownParams', () => {
    const escaped = escapeTelegramMarkdownParams(
      { username: 'h_6698253699_28', other: 'plain_text_value' },
      ['username']
    );
    expect(escaped?.username).toBe('h_6698253699_28');
    expect(escaped?.other).toBe('plain\\_text\\_value');
  });

  it('recognizes Telegram entity parser failures', () => {
    expect(
      isEntityParseError(
        new Error("400: Bad Request: can't parse entities: Can't find end of the entity")
      )
    ).toBe(true);
    expect(isEntityParseError(new Error('network unavailable'))).toBe(false);
  });

  it('retries malformed formatted messages as plain text on thrown errors and ok:false responses', async () => {
    const previous = vi
      .fn()
      .mockRejectedValueOnce(new Error("can't parse entities"))
      .mockResolvedValueOnce({ ok: true, result: { message_id: 1 } });
    const transformer = safeFormattingTransformer();

    const thrownRetry = await transformer(
      previous,
      'sendMessage',
      { chat_id: 1, text: 'broken _ entity', parse_mode: 'Markdown' },
      undefined
    );
    expect(thrownRetry.ok).toBe(true);
    expect(previous).toHaveBeenCalledTimes(2);
    expect(previous.mock.calls[1]![1]).toEqual({ chat_id: 1, text: 'broken _ entity' });

    const apiFailRetry = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error_code: 400,
        description:
          "Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 68",
      })
      .mockResolvedValueOnce({ ok: true, result: { message_id: 2 } });

    const apiResult = await transformer(
      apiFailRetry,
      'sendMessage',
      { chat_id: 1, text: '_referral\\_subtitle · فارسی_', parse_mode: 'Markdown' },
      undefined
    );
    expect(apiResult.ok).toBe(true);
    expect(apiFailRetry).toHaveBeenCalledTimes(2);
    expect(apiFailRetry.mock.calls[1]![1]).toEqual({
      chat_id: 1,
      text: '_referral\\_subtitle · فارسی_',
    });
  });

  it('retries safely as plain text through a live Bot HTTP pipeline when Telegram rejects entities', async () => {
    const harness = createBotHarness();
    harness.pushApiError({
      method: 'sendMessage',
      description: "Bad Request: can't parse entities: Can't find end of the entity",
    });
    harness.bot.command('broken', async (ctx) => {
      await ctx.reply('_broken\\_subtitle_', { parse_mode: 'Markdown' });
    });

    await harness.sendText('/broken');
    const sends = harness.callsFor('sendMessage');
    expect(sends).toHaveLength(2);
    expect(sends[0]?.payload.parse_mode).toBe('Markdown');
    expect(sends[1]?.payload.parse_mode).toBeUndefined();
  });

  it('validates telegram legacy Markdown accurately for unclosed entities vs valid syntax', () => {
    expect(validateTelegramMarkdown('_referral\\_subtitle · فارسی_').valid).toBe(false);
    expect(validateTelegramMarkdown('\\_escaped\\_leading *bold*').valid).toBe(true);
    expect(
      validateTelegramMarkdown('*bold* _italic_ `code` [link](https://example.com)').valid
    ).toBe(true);
  });

  it('produces valid Markdown key detail screens across every key in FA and EN', () => {
    const keys = Object.keys(FA_TEXTS);
    const errors: string[] = [];

    for (const locale of ['fa', 'en'] as const) {
      for (const key of keys) {
        const qualifiedKey = `${locale}.${key}`;
        const defaultValue =
          DEFAULT_SETTINGS[qualifiedKey] ?? (locale === 'fa' ? FA_TEXTS[key] : EN_TEXTS[key]);
        const currentValue = defaultValue ?? '';
        const placeholders = templatePlaceholders(defaultValue ?? '');
        const placeholderInfoText =
          placeholders.length === 0
            ? 'هیچ متغیری ندارد'
            : placeholders.map((p) => `• {${escapeTelegramMarkdown(p)}}: توضیحات`).join('\n');

        const visible = [...currentValue].slice(0, 800).join('');
        const escapedValue = escapeTelegramMarkdown(visible);

        const screen = buildScreen({
          emoji: '📝',
          title: 'ویرایشگر متن',
          subtitle: escapeTelegramMarkdown(`${key} · ${locale === 'fa' ? 'فارسی' : 'English'}`),
          primary: { emoji: '🔑', label: 'وضعیت', value: 'پیش‌فرض سیستم' },
          sections: [
            { emoji: '✏️', title: 'متن فعلی', fields: [{ label: '—', value: escapedValue }] },
            { emoji: '📚', title: 'متن پیش‌فرض', fields: [{ label: '—', value: escapedValue }] },
            { emoji: '💡', title: 'متغیرها', fields: [{ label: '—', value: placeholderInfoText }] },
          ],
        });

        const val = validateTelegramMarkdown(screen);
        if (!val.valid) {
          errors.push(`${qualifiedKey}: ${val.error}`);
        }
      }
    }

    expect(errors).toEqual([]);
  });
});

describe('Telegram logging sanitization and diagnostics', () => {
  it('redacts Telegram bot tokens, Bearer headers, and DB URL passwords', () => {
    expect(
      sanitizeSecrets(
        'Error contacting api: 123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ123456789/sendMessage'
      )
    ).toBe('Error contacting api: [REDACTED_BOT_TOKEN]/sendMessage');

    expect(sanitizeSecrets('Request failed with Bearer secret_jwt_token_1234567890')).toBe(
      'Request failed with Bearer [REDACTED_TOKEN]'
    );

    const dbSanitized = sanitizeSecrets(
      'Connecting to postgres://admin:super_secret_password@db.example.com:5432/dbname'
    );
    expect(dbSanitized).toBe(
      'Connecting to postgres://admin:[REDACTED_PASSWORD]@db.example.com:5432/dbname'
    );
    expect(dbSanitized).not.toContain('super_secret_password');
  });

  it('redacts sensitive keys in nested objects', () => {
    const sanitized = sanitizeObject({
      chat_id: 123456,
      text: 'Hello world',
      sub_url: 'https://panel.example/sub/secret_token',
      nested: {
        token: '123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ123456789',
        password: 'secret_password',
        safeField: 'safe_value',
      },
    }) as Record<string, unknown>;

    expect(sanitized.chat_id).toBe(123456);
    expect(sanitized.text).toBe('Hello world');
    expect(sanitized.sub_url).toBe('[REDACTED]');
    const nested = sanitized.nested as Record<string, unknown>;
    expect(nested.token).toBe('[REDACTED]');
    expect(nested.password).toBe('[REDACTED]');
    expect(nested.safeField).toBe('safe_value');
  });

  it('extracts structured sanitized diagnostics for GrammyError, HttpError, and Error', () => {
    const grammyError = new GrammyError(
      'Call to editMessageText failed! (400: Bad Request: message is not modified)',
      {
        ok: false,
        error_code: 400,
        description:
          'Bad Request: message is not modified: token 123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ123456789',
      },
      'editMessageText',
      { chat_id: 1001, message_id: 42, text: 'Same text', reply_markup: { inline_keyboard: [] } }
    );

    const grammyDiag = extractBotErrorDiagnostics({
      error: grammyError,
      ctx: {
        update: {
          update_id: 999888,
          callback_query: {
            id: 'cq_1',
            data: 'action:refresh:token:123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ123456789',
          },
        },
        callbackQuery: {
          data: 'action:refresh:token:123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ123456789',
        },
        from: { id: 1001 },
        chat: { id: 1001 },
      },
    } as unknown as BotError<MenuContext>);

    expect(grammyDiag.errorName).toBe('GrammyError');
    expect(grammyDiag.errorCode).toBe(400);
    expect(grammyDiag.method).toBe('editMessageText');
    expect(grammyDiag.description).toContain('[REDACTED_BOT_TOKEN]');
    expect(grammyDiag.callbackData).toContain('[REDACTED_BOT_TOKEN]');
    expect(grammyDiag.updateId).toBe(999888);
    expect(grammyDiag.userId).toBe(1001);

    const httpDiag = extractBotErrorDiagnostics({
      error: new HttpError(
        'Network timeout connecting to api.telegram.org',
        new Error('ETIMEDOUT')
      ),
      ctx: {
        update: { update_id: 111222, message: { message_id: 5, text: '/start' } },
        from: { id: 2002 },
        chat: { id: 2002 },
      },
    } as unknown as BotError<MenuContext>);

    expect(httpDiag.errorName).toBe('HttpError');
    expect(httpDiag.updateKinds).toContain('message');
    expect(httpDiag.userId).toBe(2002);

    const errDiag = extractBotErrorDiagnostics({
      error: new Error('Postgres failed postgres://postgres:mysecretpassword@localhost:5432/db'),
      ctx: { update: { update_id: 333444 }, from: { id: 3003 } },
    } as unknown as BotError<MenuContext>);

    expect(errDiag.errorMessage).not.toContain('mysecretpassword');
    expect(errDiag.errorMessage).toContain('[REDACTED_PASSWORD]');
  });
});

describe('Telegram callback data limits', () => {
  it('enforces 64-byte UTF-8 max limit and control-char validation across core builders', () => {
    expect(TELEGRAM_CALLBACK_MAX_BYTES).toBe(64);
    const id = '123e4567-e89b-42d3-a456-426614174000';
    expect(isUuidCallbackValue(id)).toBe(true);
    expect(
      Buffer.byteLength(callbackData('promo', 'delete_confirm', id), 'utf8')
    ).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(callbackData('admin', 'orphan', 'remove_confirm', id), 'utf8')).toBe(
      64
    );
    expect(
      Buffer.byteLength(callbackData('admin', 'broadcast', 'status', id), 'utf8')
    ).toBeLessThanOrEqual(64);
    expect(() => callbackData('x', 'a'.repeat(64))).toThrow('TELEGRAM_CALLBACK_DATA_TOO_LONG');
    expect(() => callbackData('x', '\n')).toThrow('TELEGRAM_CALLBACK_DATA_INVALID');

    const panelId = 'p'.repeat(40);
    const serviceId = 2_147_483_647;
    const panelCallbacks = [
      panelCallback('v', panelId),
      panelCallback('t', panelId),
      panelCallback('g', panelId, 1),
      panelCallback('d', panelId),
      panelCallback('e', panelId, 'n'),
      panelCallback('e', panelId, 'u'),
      panelCallback('e', panelId, 'k'),
      panelCallback('e', panelId, 's'),
      panelCallback('s', 'd', panelId, serviceId),
      panelCallback('s', 'c', panelId, serviceId),
      panelCallback('s', 'x', panelId, serviceId),
      panelCallback('s', 'xc', panelId, serviceId),
      panelCallback('x', panelId),
      panelCallback('xc', panelId),
    ];
    expect(
      Math.max(...panelCallbacks.map((v) => Buffer.byteLength(v, 'utf8')))
    ).toBeLessThanOrEqual(64);

    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'en'),
        },
      },
    } as unknown as MenuContext;
    const subKeyboard = buildSubscriptionActionKeyboard(ctx, 'c'.repeat(40), 'active', false, true);
    const subCallbacks = subKeyboard.inline_keyboard
      .flat()
      .flatMap((button) => ('callback_data' in button ? [button.callback_data] : []));
    expect(subCallbacks.length).toBeGreaterThan(0);
    expect(Math.max(...subCallbacks.map((v) => Buffer.byteLength(v, 'utf8')))).toBeLessThanOrEqual(
      64
    );
  });
});
