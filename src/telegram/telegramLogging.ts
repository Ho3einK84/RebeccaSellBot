/** Structured logging and secret sanitization for Telegram / grammY bot errors. */

import { GrammyError, HttpError, type BotError } from 'grammy';
import type { MenuContext } from './types.js';

const SENSITIVE_KEY_RE =
  /(token|password|secret|auth|key|authorization|bearer|cookie|credential|suburl|subscription_url|sub_url)/i;
const BOT_TOKEN_RE = /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g;
const BEARER_AUTH_RE = /bearer\s+[a-zA-Z0-9._~+/-]+=*/gi;
const URL_CREDENTIALS_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/:]+):([^/@]+)@/gi;

export function sanitizeSecrets(text: string): string {
  if (typeof text !== 'string') return text;
  return text
    .replace(BOT_TOKEN_RE, '[REDACTED_BOT_TOKEN]')
    .replace(BEARER_AUTH_RE, 'Bearer [REDACTED_TOKEN]')
    .replace(URL_CREDENTIALS_RE, '$1:[REDACTED_PASSWORD]@');
}

export function sanitizeObject(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[NESTED_OBJECT_TRUNCATED]';
  if (typeof obj === 'string') return sanitizeSecrets(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean' || obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1));
  }
  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        sanitized[k] = '[REDACTED]';
      } else {
        sanitized[k] = sanitizeObject(v, depth + 1);
      }
    }
    return sanitized;
  }
  return String(obj);
}

export interface BotErrorDiagnostics {
  errorName: string;
  errorMessage: string;
  errorCode?: number;
  description?: string;
  method?: string;
  payload?: unknown;
  parameters?: unknown;
  stack?: string;
  cause?: unknown;
  updateId?: number;
  updateKinds?: string[];
  callbackData?: string;
  userId?: number;
  chatId?: number;
}

export function extractBotErrorDiagnostics(err: BotError<MenuContext>): BotErrorDiagnostics {
  const cause = err.error;
  const ctx = err.ctx;

  const diagnostics: BotErrorDiagnostics = {
    errorName: cause instanceof Error ? cause.name : typeof cause,
    errorMessage:
      cause instanceof Error ? sanitizeSecrets(cause.message) : sanitizeSecrets(String(cause)),
    updateId: ctx?.update?.update_id,
    updateKinds: ctx?.update ? Object.keys(ctx.update).filter((k) => k !== 'update_id') : [],
    callbackData: ctx?.callbackQuery?.data ? sanitizeSecrets(ctx.callbackQuery.data) : undefined,
    userId: ctx?.from?.id,
    chatId: ctx?.chat?.id,
  };

  if (cause instanceof GrammyError) {
    diagnostics.errorName = 'GrammyError';
    diagnostics.errorCode = cause.error_code;
    diagnostics.description = sanitizeSecrets(cause.description);
    diagnostics.method = cause.method;
    diagnostics.payload = sanitizeObject(cause.payload);
    diagnostics.parameters = sanitizeObject(cause.parameters);
    diagnostics.stack = cause.stack ? sanitizeSecrets(cause.stack) : undefined;
  } else if (cause instanceof HttpError) {
    diagnostics.errorName = 'HttpError';
    diagnostics.stack = cause.stack ? sanitizeSecrets(cause.stack) : undefined;
  } else if (cause instanceof Error) {
    diagnostics.stack = cause.stack ? sanitizeSecrets(cause.stack) : undefined;
    if ('cause' in cause && cause.cause) {
      diagnostics.cause =
        cause.cause instanceof Error
          ? {
              name: cause.cause.name,
              message: sanitizeSecrets(cause.cause.message),
              stack: cause.cause.stack ? sanitizeSecrets(cause.cause.stack) : undefined,
            }
          : sanitizeObject(cause.cause);
    }
  }

  return diagnostics;
}
