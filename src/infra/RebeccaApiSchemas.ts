import { z } from 'zod';

const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nullableSafeInteger = safeInteger.nullable();
const userStatusSchema = z.enum(['active', 'disabled', 'limited', 'expired', 'on_hold', 'deleted']);
const subscriptionUrlsSchema = z.record(z.string(), z.string()).optional();
const proxyMapSchema = z.record(z.string(), z.record(z.string(), z.unknown()));
const inboundMapSchema = z.record(z.string(), z.array(z.string()));

/** Authentication contract returned by POST /api/admin/token. */
export const rebeccaTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1).optional(),
  })
  .passthrough();

/**
 * Runtime contract for Rebecca's detailed user representation.
 *
 * Fields used for financial verification are intentionally strict. Less
 * critical metadata keeps compatibility with older Rebecca releases by using
 * sensible defaults when the panel omits the field.
 */
export const rebeccaUserDetailSchema = z
  .object({
    username: z.string().min(1),
    status: userStatusSchema,
    used_traffic: safeInteger,
    lifetime_used_traffic: safeInteger.optional().default(0),
    data_limit: nullableSafeInteger,
    expire: nullableSafeInteger,
    created_at: z.string().optional().default(''),
    subscription_url: z.string(),
    subscription_urls: subscriptionUrlsSchema,
    links: z.array(z.string()),
    proxies: proxyMapSchema.optional().default({}),
    inbounds: inboundMapSchema.optional().default({}),
    note: z.string().nullable().optional().default(null),
    telegram_id: z.string().nullable().optional().default(null),
    sub_updated_at: z.string().nullable().optional().default(null),
    online_at: z.string().nullable().optional().default(null),
    ip_limit: safeInteger.optional().default(0),
    service_id: safeInteger.nullable().optional().default(null),
    service_name: z.string().nullable().optional().default(null),
    admin_username: z.string().nullable().optional().default(null),
  })
  .passthrough();

export const rebeccaUserListItemSchema = z
  .object({
    username: z.string().min(1),
    status: userStatusSchema,
    used_traffic: safeInteger,
    data_limit: nullableSafeInteger,
    expire: nullableSafeInteger,
    subscription_url: z.string(),
    subscription_urls: subscriptionUrlsSchema,
    links: z.array(z.string()),
    online_at: z.string().nullable().optional().default(null),
    created_at: z.string().optional().default(''),
  })
  .passthrough();

export const rebeccaUsersResponseSchema = z
  .object({
    users: z.array(rebeccaUserListItemSchema),
    total: safeInteger,
    status_breakdown: z.record(z.string(), safeInteger),
  })
  .passthrough();

export const rebeccaDeleteResponseSchema = z
  .object({
    username: z.string().min(1),
    status: z.string().min(1),
  })
  .passthrough();
