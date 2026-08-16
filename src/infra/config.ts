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
    HEALTH_CHECK_PORT: healthCheckPortSchema,
    DEFAULT_LOCALE: z.enum(['fa', 'en']).default('fa'),
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
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.PANEL_CREDENTIALS_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['PANEL_CREDENTIALS_KEY'],
        message: 'PANEL_CREDENTIALS_KEY is required in production',
      });
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
