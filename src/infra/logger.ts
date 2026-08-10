import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'BOT_TOKEN',
      'REBECCA_API_KEY',
      'REBECCA_ADMIN_PASSWORD',
      'headers.authorization',
      'headers["x-api-key"]',
      'body.password',
      'body.token',
      'apiKey',
      'password',
      'token',
      '*.apiKey',
      '*.password',
      '*.token',
      '*.authorization',
      'photoFileId',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    err: safeError,
    error: safeError,
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true },
        }
      : undefined,
});

function safeError(value: unknown): Record<string, unknown> {
  if (!(value instanceof Error)) return { type: typeof value };
  const candidate = value as Error & { code?: unknown; status?: unknown; issueCount?: unknown };
  return {
    name: candidate.name,
    ...(typeof candidate.code === 'string' || typeof candidate.code === 'number'
      ? { code: candidate.code }
      : {}),
    ...(typeof candidate.status === 'number' ? { status: candidate.status } : {}),
    ...(typeof candidate.issueCount === 'number' ? { issueCount: candidate.issueCount } : {}),
  };
}

export function initLogger() {
  return logger;
}
