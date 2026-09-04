import { z } from 'zod';
import dotenv from 'dotenv';
import { validateRebeccaBaseUrl } from './rebeccaBaseUrl.js';

dotenv.config();

const positiveIntegerSchema = (name: string, defaultValue?: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      if (!trimmed && defaultValue !== undefined) {
        return String(defaultValue);
      }
      return trimmed;
    })
    .pipe(
      z
        .string({ message: `${name} is required` })
        .regex(/^[1-9]\d*$/, `${name} must be a positive integer`)
        .transform((value) => Number(value))
        .pipe(z.number().int().safe().positive(`${name} must be a positive integer`))
    );

const healthCheckPortSchema = positiveIntegerSchema('HEALTH_CHECK_PORT', 3001).pipe(
  z.number().max(65_535, 'HEALTH_CHECK_PORT is out of range')
);

const optionalSecretSchema = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const panelCredentialsKeySchema = optionalSecretSchema.refine(
  (value) => !value || (value.length >= 32 && value.length <= 512),
  'PANEL_CREDENTIALS_KEY must contain 32–512 characters'
);

const optionalUrlSchema = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined)
  .refine((value) => {
    if (!value) return true;
    try {
      validateRebeccaBaseUrl(value);
      return true;
    } catch {
      return false;
    }
  }, 'REBECCA_API_URL must be a clean HTTPS origin URL')
  .transform((value) => (value ? validateRebeccaBaseUrl(value) : undefined));

const optionalStringWithDefault = (defaultValue: string) =>
  z
    .string()
    .optional()
    .transform((value) => value?.trim() || defaultValue);

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
    ADMIN_IDS: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (!value || !value.trim()) return [];
        const rawIds = value.split(',').map((rawId) => rawId.trim());
        const invalidIds = rawIds.filter(
          (rawId) => !/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))
        );
        if (invalidIds.length > 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'ADMIN_IDS must contain only positive integer IDs',
          });
          return z.NEVER;
        }
        return rawIds.map(Number);
      })
      .pipe(z.array(z.number().int().positive())),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_SIZE: positiveIntegerSchema('DATABASE_POOL_SIZE', 20).pipe(
      z.number().max(100, 'DATABASE_POOL_SIZE is out of range')
    ),
    // Legacy single-panel bootstrap only. A fresh installation may leave all
    // Rebecca values empty and configure one or more panels from Telegram.
    REBECCA_API_URL: optionalUrlSchema,
    REBECCA_API_KEY: optionalSecretSchema,
    REBECCA_ADMIN_USERNAME: optionalStringWithDefault('admin'),
    REBECCA_ADMIN_PASSWORD: optionalSecretSchema,
    REBECCA_SERVICE_ID: positiveIntegerSchema('REBECCA_SERVICE_ID', 1).pipe(
      z.number().max(2_147_483_647, 'REBECCA_SERVICE_ID is out of range')
    ),
    PANEL_CREDENTIALS_KEY: panelCredentialsKeySchema,
    PORT: positiveIntegerSchema('PORT')
      .pipe(z.number().max(65_535, 'PORT is out of range'))
      .optional(),
    HEALTH_CHECK_PORT: healthCheckPortSchema,
    DEFAULT_LOCALE: z.enum(['fa', 'en']).default('fa'),
    INSTANCE_NAME: optionalStringWithDefault('main'),
    SUPPORT_URL: z
      .string()
      .optional()
      .transform((val) => {
        const trimmed = val?.trim();
        return trimmed ? trimmed : undefined;
      })
      .pipe(
        z
          .string()
          .url('SUPPORT_URL must be a valid URL')
          .startsWith('https://', 'SUPPORT_URL must start with https://')
          .optional()
      ),
    BOT_DELIVERY_MODE: z.enum(['polling', 'webhook']).optional(),
    WEBHOOK_URL: z
      .string()
      .optional()
      .transform((val) => val?.trim() || undefined)
      .refine((val) => {
        if (!val) return true;
        if (!val.startsWith('https://')) return false;
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      }, 'WEBHOOK_URL must be a valid HTTPS URL'),
    WEBHOOK_SECRET_TOKEN: optionalSecretSchema,
    WEBHOOK_PORT: positiveIntegerSchema(
      'WEBHOOK_PORT',
      process.env.PORT ? Number(process.env.PORT) : 3000
    ).pipe(z.number().max(65_535, 'WEBHOOK_PORT is out of range')),
    WEBHOOK_PATH: z
      .string()
      .optional()
      .transform((val) => {
        const trimmed = val?.trim();
        if (!trimmed) return undefined;
        return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      }),
    WEBHOOK_HOST: optionalStringWithDefault(process.env.HOST?.trim() || '0.0.0.0'),
    REBECCA_WEBHOOK_SECRET: optionalSecretSchema,
    REBECCA_WEBHOOK_PATH: z
      .string()
      .optional()
      .transform((val) => {
        const trimmed = val?.trim();
        if (!trimmed) return '/api/rebecca-webhook';
        return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      }),
  })
  .transform((val) => {
    const effectiveMode: 'polling' | 'webhook' =
      val.BOT_DELIVERY_MODE ?? (val.WEBHOOK_URL ? 'webhook' : 'polling');
    let effectivePath = val.WEBHOOK_PATH;
    if (!effectivePath) {
      if (val.WEBHOOK_URL) {
        try {
          const parsed = new URL(val.WEBHOOK_URL);
          if (parsed.pathname && parsed.pathname !== '/') {
            effectivePath = parsed.pathname;
          }
        } catch {
          // ignore
        }
      }
      effectivePath = effectivePath || '/webhook';
    }

    let effectiveHealthPort = val.HEALTH_CHECK_PORT;
    let effectiveWebhookPort = val.WEBHOOK_PORT;
    if (val.PORT) {
      if (!process.env.HEALTH_CHECK_PORT) {
        effectiveHealthPort = val.PORT;
      }
      if (!process.env.WEBHOOK_PORT) {
        effectiveWebhookPort = val.PORT;
      }
    }

    return {
      ...val,
      HEALTH_CHECK_PORT: effectiveHealthPort,
      WEBHOOK_PORT: effectiveWebhookPort,
      BOT_DELIVERY_MODE: effectiveMode,
      WEBHOOK_PATH: effectivePath,
    };
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.PANEL_CREDENTIALS_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['PANEL_CREDENTIALS_KEY'],
        message: 'PANEL_CREDENTIALS_KEY is required in production',
      });
    }
    if (value.BOT_DELIVERY_MODE === 'webhook') {
      if (!value.WEBHOOK_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEBHOOK_URL'],
          message: 'WEBHOOK_URL is required when webhook delivery is enabled',
        });
      }
      if (!value.WEBHOOK_SECRET_TOKEN) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEBHOOK_SECRET_TOKEN'],
          message: 'WEBHOOK_SECRET_TOKEN is required when webhook delivery is enabled',
        });
      } else if (!/^[A-Za-z0-9_-]{1,256}$/.test(value.WEBHOOK_SECRET_TOKEN)) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEBHOOK_SECRET_TOKEN'],
          message:
            'WEBHOOK_SECRET_TOKEN must contain only 1–256 alphanumeric characters, underscores, or hyphens',
        });
      }
      if (!value.PORT && value.WEBHOOK_PORT === value.HEALTH_CHECK_PORT) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEBHOOK_PORT'],
          message: 'WEBHOOK_PORT must differ from HEALTH_CHECK_PORT',
        });
      }
    }
    if (!value.REBECCA_API_URL) return;
    if (value.REBECCA_API_KEY || value.REBECCA_ADMIN_PASSWORD) return;
    if (value.NODE_ENV !== 'production') return;

    ctx.addIssue({
      code: 'custom',
      path: ['REBECCA_API_KEY'],
      message: 'REBECCA_API_KEY or REBECCA_ADMIN_PASSWORD is required in production',
    });
  });

export type Config = z.infer<typeof configSchema>;

let parsedConfig: Config | null = null;

export function loadConfig(): Config {
  if (parsedConfig) return parsedConfig;
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  parsedConfig = result.data;
  return parsedConfig;
}
