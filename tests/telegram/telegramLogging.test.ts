import { describe, expect, it } from 'vitest';
import { GrammyError, HttpError, type BotError } from 'grammy';
import {
  extractBotErrorDiagnostics,
  sanitizeObject,
  sanitizeSecrets,
} from '../../src/telegram/telegramLogging.js';
import type { MenuContext } from '../../src/telegram/types.js';

describe('Telegram and grammY Error Logging Diagnostics & Sanitization', () => {
  describe('sanitizeSecrets', () => {
    it('redacts Telegram bot tokens', () => {
      const input =
        'Error contacting api: 123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ123456789/sendMessage';
      const sanitized = sanitizeSecrets(input);
      expect(sanitized).toBe('Error contacting api: [REDACTED_BOT_TOKEN]/sendMessage');
      expect(sanitized).not.toContain('123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ123456789');
    });

    it('redacts Bearer authorization headers', () => {
      const input = 'Request failed with Bearer secret_jwt_token_1234567890';
      const sanitized = sanitizeSecrets(input);
      expect(sanitized).toBe('Request failed with Bearer [REDACTED_TOKEN]');
    });

    it('redacts passwords in URLs with embedded credentials', () => {
      const input =
        'Connecting to postgres://admin:super_secret_password@db.example.com:5432/dbname';
      const sanitized = sanitizeSecrets(input);
      expect(sanitized).toBe(
        'Connecting to postgres://admin:[REDACTED_PASSWORD]@db.example.com:5432/dbname'
      );
      expect(sanitized).not.toContain('super_secret_password');
    });
  });

  describe('sanitizeObject', () => {
    it('redacts sensitive keys in deeply nested objects', () => {
      const payload = {
        chat_id: 123456,
        text: 'Hello world',
        sub_url: 'https://panel.example/sub/secret_token',
        nested: {
          token: '123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ123456789',
          password: 'secret_password',
          safeField: 'safe_value',
        },
      };

      const sanitized = sanitizeObject(payload) as Record<string, unknown>;
      expect(sanitized.chat_id).toBe(123456);
      expect(sanitized.text).toBe('Hello world');
      expect(sanitized.sub_url).toBe('[REDACTED]');
      const nested = sanitized.nested as Record<string, unknown>;
      expect(nested.token).toBe('[REDACTED]');
      expect(nested.password).toBe('[REDACTED]');
      expect(nested.safeField).toBe('safe_value');
    });
  });

  describe('extractBotErrorDiagnostics', () => {
    it('extracts structured GrammyError diagnostics including error_code and method', () => {
      const grammyError = new GrammyError(
        'Call to editMessageText failed! (400: Bad Request: message is not modified)',
        {
          ok: false,
          error_code: 400,
          description:
            'Bad Request: message is not modified: specify new text or bot token 123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ123456789',
        },
        'editMessageText',
        {
          chat_id: 1001,
          message_id: 42,
          text: 'Same text',
          reply_markup: { inline_keyboard: [] },
        }
      );

      const botError = {
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
      } as unknown as BotError<MenuContext>;

      const diagnostics = extractBotErrorDiagnostics(botError);
      expect(diagnostics.errorName).toBe('GrammyError');
      expect(diagnostics.errorCode).toBe(400);
      expect(diagnostics.method).toBe('editMessageText');
      expect(diagnostics.description).toContain('[REDACTED_BOT_TOKEN]');
      expect(diagnostics.updateId).toBe(999888);
      expect(diagnostics.updateKinds).toContain('callback_query');
      expect(diagnostics.callbackData).toContain('[REDACTED_BOT_TOKEN]');
      expect(diagnostics.userId).toBe(1001);
      expect(diagnostics.chatId).toBe(1001);
      expect(diagnostics.stack).toBeDefined();
    });

    it('extracts HttpError and network diagnostics', () => {
      const httpError = new HttpError(
        'Network timeout connecting to api.telegram.org',
        new Error('ETIMEDOUT')
      );

      const botError = {
        error: httpError,
        ctx: {
          update: {
            update_id: 111222,
            message: { message_id: 5, text: '/start' },
          },
          from: { id: 2002 },
          chat: { id: 2002 },
        },
      } as unknown as BotError<MenuContext>;

      const diagnostics = extractBotErrorDiagnostics(botError);
      expect(diagnostics.errorName).toBe('HttpError');
      expect(diagnostics.errorMessage).toContain('Network timeout');
      expect(diagnostics.updateId).toBe(111222);
      expect(diagnostics.updateKinds).toContain('message');
      expect(diagnostics.userId).toBe(2002);
      expect(diagnostics.chatId).toBe(2002);
    });

    it('extracts generic Error cause and stacks with sanitized messages', () => {
      const internalErr = new Error(
        'Postgres connection failed on postgres://postgres:mysecretpassword@localhost:5432/db'
      );
      const botError = {
        error: internalErr,
        ctx: {
          update: { update_id: 333444 },
          from: { id: 3003 },
        },
      } as unknown as BotError<MenuContext>;

      const diagnostics = extractBotErrorDiagnostics(botError);
      expect(diagnostics.errorName).toBe('Error');
      expect(diagnostics.errorMessage).not.toContain('mysecretpassword');
      expect(diagnostics.errorMessage).toContain('[REDACTED_PASSWORD]');
      expect(diagnostics.updateId).toBe(333444);
    });
  });
});
