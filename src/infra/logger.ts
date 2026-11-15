import pino from 'pino';

export function createLogger(destination?: pino.DestinationStream) {
  const options: pino.LoggerOptions = {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: [
        'BOT_TOKEN',
        'REBECCA_API_KEY',
        'REBECCA_ADMIN_PASSWORD',
        'PANEL_CREDENTIALS_KEY',
        'ADMIN_SESSION_SECRET',
        'WEBAPP_SESSION_SECRET',
        'WEBHOOK_SECRET_TOKEN',
        'REBECCA_WEBHOOK_SECRET',
        'headers.authorization',
        'headers.cookie',
        'headers["x-api-key"]',
        'headers["x-telegram-bot-api-secret-token"]',
        'headers["x-webhook-secret"]',
        'body.password',
        'body.token',
        'apiKey',
        'password',
        'token',
        'secret',
        'apiKeyEncrypted',
        'adminPasswordEncrypted',
        '*.apiKey',
        '*.password',
        '*.token',
        '*.secret',
        '*.authorization',
        '*.PANEL_CREDENTIALS_KEY',
        '*.apiKeyEncrypted',
        '*.adminPasswordEncrypted',
        'photoFileId',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      err: safeError,
      error: safeError,
    },
    transport:
      !destination && process.env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: { colorize: true },
          }
        : undefined,
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();

export function safeError(value: unknown): Record<string, unknown> {
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
