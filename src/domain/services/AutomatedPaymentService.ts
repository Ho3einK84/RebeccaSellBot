/**
 * AutomatedPaymentService — Domain orchestration for automated wallet top-ups:
 *  1. ForApp automated Iranian bank SMS card-to-card verification
 *  2. NOWPayments cryptocurrency invoice & IPN settlement
 *
 * Security & financial integrity guarantees:
 *  - All gateway secrets (ForApp X-API-Key, NOWPayments API Key & IPN Secret) are
 *    encrypted at rest using AES-256-GCM via CredentialCipher.
 *  - Constant-time verification (`crypto.timingSafeEqual`) for X-API-Key and
 *    HMAC-SHA512 IPN signatures (x-nowpayments-sig with recursively sorted keys).
 *  - 64-bit safe integer accounting via `dbIntegerToSafeNumber` (no floating-point Toman math).
 *  - Atomic `FOR UPDATE` row locking + deterministic `wallet_transactions.reference_id`
 *    and `forapp_deposits.idempotency_key` unique constraints guarantee strict idempotency.
 */
import crypto from 'node:crypto';
import { and, asc, count, desc, eq, gt, gte, inArray, lt, or } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import {
  auditLogs,
  forappDeposits,
  paymentOrders,
  users,
  walletTransactions,
  type ForAppDepositRow,
  type ForAppDepositStatus,
  type PaymentOrderProvider,
  type PaymentOrderRow,
} from '../../infra/schema.js';
import { CredentialCipher } from '../../infra/CredentialCipher.js';
import {
  NowPaymentsClient,
  verifyNowPaymentsSignature,
  type NowPaymentsPaymentDetail,
} from '../../infra/NowPaymentsClient.js';
import { ExchangeRateClient } from '../../infra/ExchangeRateClient.js';
import { logger } from '../../infra/logger.js';
import { dbIntegerToSafeNumber } from './DbNumber.js';
import {
  forappEnabled,
  forappOrderExpiryMinutes,
  nowpaymentsCashbackPercent,
  nowpaymentsEnabled,
  nowpaymentsManualUsdRateToman,
  nowpaymentsMaxAmountToman,
  nowpaymentsMinAmountToman,
  nowpaymentsOrderExpiryMinutes,
  nowpaymentsRateMode,
  nowpaymentsSandbox,
  type NowPaymentsRateMode,
} from './FeatureSettings.js';
import {
  detectIranianBankName,
  normalizeCardNumber,
  NowPaymentsPaymentProvider,
  type PaymentService,
} from './PaymentService.js';
import type { TranslationService } from './TranslationService.js';
import type { WalletService } from './WalletService.js';

export const FORAPP_WEBHOOK_PATH = '/api/webhooks/forapp';
export const NOWPAYMENTS_WEBHOOK_PATH = '/api/webhooks/nowpayments';
/** Delay after which pending ForApp invoices surface a manual-receipt fallback reminder (5 minutes). */
export const FORAPP_MANUAL_HINT_DELAY_MS = 5 * 60 * 1000;

const MAX_ORDER_TELEGRAM_MESSAGE_IDS = 10;

export function parseOrderMetadataObject(
  metadata: string | null | undefined
): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    // Ignore malformed legacy metadata
  }
  return {};
}

/** Extract deduplicated positive Telegram message IDs associated with a pending payment order. */
export function extractOrderTelegramMessageIds(metadata: string | null | undefined): number[] {
  const obj = parseOrderMetadataObject(metadata);
  const raw = obj.telegramMessageIds;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const result: number[] = [];
  for (const item of raw) {
    if (typeof item === 'number' && Number.isSafeInteger(item) && item > 0 && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

/** Merge metadata fields onto a payment order without clobbering existing keys. */
export function mergeOrderMetadata(
  existing: string | null | undefined,
  patch: { addTelegramMessageId?: number; manualHintSentAt?: string }
): string {
  const obj = parseOrderMetadataObject(existing);
  if (
    typeof patch.addTelegramMessageId === 'number' &&
    Number.isSafeInteger(patch.addTelegramMessageId) &&
    patch.addTelegramMessageId > 0
  ) {
    const ids = extractOrderTelegramMessageIds(existing);
    if (!ids.includes(patch.addTelegramMessageId)) {
      ids.push(patch.addTelegramMessageId);
    }
    obj.telegramMessageIds = ids.slice(-MAX_ORDER_TELEGRAM_MESSAGE_IDS);
  }
  if (patch.manualHintSentAt) {
    obj.manualHintSentAt = patch.manualHintSentAt;
  }
  return JSON.stringify(obj);
}

const MIN_NOWPAYMENTS_USD = 0.5;
const MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;

export class AutomatedPaymentError extends Error {
  constructor(
    public readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'AutomatedPaymentError';
  }
}

export interface AutomatedPaymentServiceOptions {
  translationService: TranslationService;
  paymentService: PaymentService;
  walletService?: Pick<WalletService, 'invalidateUserCache'>;
  credentialSecret: string;
  nowPaymentsClient?: NowPaymentsClient;
  exchangeRateClient?: ExchangeRateClient;
  resolvePublicBaseUrl?: () => string | undefined;
}

export interface ForAppAdminConfig {
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiKeyMasked: string | null;
  orderExpiryMinutes: number;
  webhookUrl: string | null;
  unmatchedCount: number;
}

export interface NowPaymentsAdminConfig {
  enabled: boolean;
  sandbox: boolean;
  apiKeyConfigured: boolean;
  ipnSecretConfigured: boolean;
  rateMode: NowPaymentsRateMode;
  manualUsdRateToman: number;
  effectiveUsdRateToman: number;
  effectiveRateSource: 'auto' | 'manual' | 'fallback';
  minAmountToman: number;
  maxAmountToman: number;
  cashbackPercent: number;
  orderExpiryMinutes: number;
  webhookUrl: string | null;
}

export interface ResolvedUsdRate {
  rateToman: number;
  source: 'auto' | 'manual' | 'fallback';
  provider?: string;
  fetchedAt: Date;
}

export interface ForAppWebhookProcessResult {
  statusCode: number;
  outcome:
    | 'unauthorized'
    | 'invalid_payload'
    | 'disabled'
    | 'missing_idempotency_key'
    | 'test_ok'
    | 'duplicate'
    | 'ignored'
    | 'unmatched'
    | 'matched';
  enabled?: boolean;
  idempotencyKey?: string;
  deposit?: ForAppDepositRow;
  order?: PaymentOrderRow;
  relatedOrder?: PaymentOrderRow;
  creditedAmount?: number;
  balanceAfter?: number;
}

/** Lookback window for matching late/cancelled exact ForApp order amounts (48 hours). */
const FORAPP_EXACT_LATE_ORDER_LOOKBACK_MS = 48 * 60 * 60 * 1000;
/** Lookback window for 10x Rial/Toman unit-confusion correlation against ForApp orders (6 hours). */
const FORAPP_UNIT_MISTAKE_LOOKBACK_MS = 6 * 60 * 60 * 1000;
/** Lookback window for digit-typo proximity correlation against recent ForApp orders (2 hours). */
const FORAPP_NEAR_AMOUNT_LOOKBACK_MS = 2 * 60 * 60 * 1000;
/** Maximum Toman proximity band to treat a non-round deposit as a typo on a recent ForApp order. */
const FORAPP_NEAR_AMOUNT_TOLERANCE_TOMAN = 2_000;

/**
 * Returns true when `amountToman` is a round thousand-Toman transfer (`% 1000 === 0`, e.g. 2,000,000 Toman).
 * Every automated ForApp order allocates a non-round unique offset (`payableAmount % 100 !== 0`),
 * so round deposits on the cardholder's personal SIM are unrelated non-bot transfers.
 */
export function isRoundForAppDepositToman(amountToman: number): boolean {
  return Number.isSafeInteger(amountToman) && amountToman > 0 && amountToman % 1_000 === 0;
}

export type ForAppUnmatchedCorrelationReason =
  | 'late_or_cancelled_order'
  | 'rial_instead_of_toman'
  | 'extra_zero_rial'
  | 'near_forapp_order'
  | 'rial_not_multiple_of_10';

export function correlateUnmatchedForAppDeposit(params: {
  amountRial: number;
  amountToman: number | null;
  now: Date;
  recentOrders: readonly PaymentOrderRow[];
}): { reason: ForAppUnmatchedCorrelationReason; order: PaymentOrderRow } | null {
  const { amountRial, amountToman, now, recentOrders } = params;
  const nowMs = now.getTime();

  // 1. Exact payableAmount match on a recently expired/cancelled ForApp order (up to 48h).
  if (amountToman !== null && amountToman > 0) {
    for (const order of recentOrders) {
      const createdMs = new Date(order.createdAt).getTime();
      if (
        nowMs - createdMs <= FORAPP_EXACT_LATE_ORDER_LOOKBACK_MS &&
        order.payableAmount === amountToman
      ) {
        return { reason: 'late_or_cancelled_order', order };
      }
    }
  }

  // 2. Classic 10x unit mistake: customer typed invoice Toman figure into Rial field (or added extra 0).
  for (const order of recentOrders) {
    const createdMs = new Date(order.createdAt).getTime();
    if (nowMs - createdMs > FORAPP_UNIT_MISTAKE_LOOKBACK_MS) continue;
    if (order.payableAmount === amountRial) {
      return { reason: 'rial_instead_of_toman', order };
    }
    if (amountToman !== null && order.payableAmount * 10 === amountToman) {
      return { reason: 'extra_zero_rial', order };
    }
  }

  // 3. Digit typo near an active or recently-active ForApp order (within 2h & ±2,000 Toman).
  const approxToman = amountToman ?? Math.floor(amountRial / 10);
  if (approxToman > 0) {
    for (const order of recentOrders) {
      const createdMs = new Date(order.createdAt).getTime();
      const expiresMs = new Date(order.expiresAt).getTime();
      const isRecent =
        nowMs - createdMs <= FORAPP_NEAR_AMOUNT_LOOKBACK_MS ||
        nowMs - expiresMs <= FORAPP_NEAR_AMOUNT_LOOKBACK_MS;
      if (!isRecent) continue;

      const nearPayable =
        Math.abs(approxToman - order.payableAmount) <= FORAPP_NEAR_AMOUNT_TOLERANCE_TOMAN;
      const nearRequested =
        Math.abs(approxToman - order.requestedAmount) <= FORAPP_NEAR_AMOUNT_TOLERANCE_TOMAN;
      if (nearPayable || nearRequested) {
        return {
          reason: amountToman === null ? 'rial_not_multiple_of_10' : 'near_forapp_order',
          order,
        };
      }
    }
  }

  return null;
}

export interface NowPaymentsIpnProcessResult {
  statusCode: number;
  outcome:
    | 'invalid_signature'
    | 'missing_payment_id'
    | 'not_configured'
    | 'order_not_found'
    | 'already_completed'
    | 'completed'
    | 'partially_paid'
    | 'expired'
    | 'failed'
    | 'in_progress';
  order?: PaymentOrderRow;
  paymentDetail?: NowPaymentsPaymentDetail;
  creditedAmount?: number;
  cashbackAmount?: number;
  balanceAfter?: number;
  newlyCompleted?: boolean;
}

export interface ManualMatchForAppDepositResult {
  deposit: ForAppDepositRow;
  telegramId: number;
  creditedAmount: number;
  balanceAfter: number;
  walletTransactionId: string;
}

function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660));
}

function parseIntegerInput(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === 'string') {
    const cleaned = normalizeDigits(value)
      .replace(/[,_،٬\s]/gu, '')
      .trim();
    if (!/^-?\d+$/u.test(cleaned)) return null;
    try {
      return dbIntegerToSafeNumber(cleaned, 'integer_input');
    } catch {
      return null;
    }
  }
  return null;
}

/** Constant-time secret equality using fixed-length SHA-256 digests (no length oracle). */
export function timingSafeSecretEqual(
  received: string | undefined,
  expected: string | undefined
): boolean {
  if (!received || !expected) return false;
  const a = received.trim();
  const b = expected.trim();
  if (!a || !b) return false;
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function maskSecretTail(secret: string | undefined): string | null {
  if (!secret || !secret.trim()) return null;
  const trimmed = secret.trim();
  return trimmed.length <= 4 ? '••••' : `••••${trimmed.slice(-4)}`;
}

export function formatPaymentOrderShortId(orderId: string): string {
  const match = orderId.match(/_([a-zA-Z0-9]{4,8})$/u);
  if (match) return match[1]!;
  return orderId.length > 8 ? orderId.slice(-6) : orderId;
}

function parseOrderMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export class AutomatedPaymentService {
  private readonly translationService: TranslationService;
  private readonly paymentService: PaymentService;
  private readonly walletService?: Pick<WalletService, 'invalidateUserCache'>;
  private readonly cipher: CredentialCipher;
  private readonly nowPaymentsClient: NowPaymentsClient;
  private readonly exchangeRateClient: ExchangeRateClient;
  private readonly resolvePublicBaseUrl?: () => string | undefined;

  constructor(options: AutomatedPaymentServiceOptions) {
    this.translationService = options.translationService;
    this.paymentService = options.paymentService;
    this.walletService = options.walletService;
    this.cipher = new CredentialCipher(options.credentialSecret);
    this.nowPaymentsClient = options.nowPaymentsClient ?? new NowPaymentsClient();
    this.exchangeRateClient = options.exchangeRateClient ?? new ExchangeRateClient();
    this.resolvePublicBaseUrl = options.resolvePublicBaseUrl;

    // Bind live NowPaymentsPaymentProvider instructions to this domain service
    this.paymentService.registerProvider(
      new NowPaymentsPaymentProvider(this.translationService, async ({ amount, telegramId }) => {
        const created = await this.createNowPaymentsOrder({ telegramId, amountToman: amount });
        return {
          methodId: 'nowpayments',
          type: 'automated',
          amount: created.payableAmount,
          orderId: created.id,
          expiresAt: created.expiresAt.toISOString(),
          paymentUrl: created.paymentUrl ?? undefined,
          fiatAmountUsd: created.fiatAmountUsd ?? undefined,
          exchangeRateTomanPerUsd: created.exchangeRateTomanPerUsd ?? undefined,
        };
      })
    );
  }

  // ── Public Webhook URL Helpers ─────────────────────────────────────────────

  resolveBaseUrl(): string | null {
    const dynamicUrl = this.resolvePublicBaseUrl?.()?.trim();
    const storedUrl = this.translationService.getSetting('webapp_url', '').trim();
    const candidate = dynamicUrl || storedUrl;
    if (!candidate) return null;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
      return parsed.origin;
    } catch {
      return null;
    }
  }

  getForAppWebhookUrl(): string | null {
    const base = this.resolveBaseUrl();
    return base ? `${base}${FORAPP_WEBHOOK_PATH}` : null;
  }

  getNowPaymentsWebhookUrl(): string | null {
    const base = this.resolveBaseUrl();
    return base ? `${base}${NOWPAYMENTS_WEBHOOK_PATH}` : null;
  }

  // ── Encrypted Credential Helpers ───────────────────────────────────────────

  private decryptSetting(key: string): string | undefined {
    const raw = this.translationService.getSetting(key, '').trim();
    if (!raw) return undefined;
    try {
      return this.cipher.decrypt(raw);
    } catch (err) {
      logger.warn(
        { key, err: err instanceof Error ? err.message : String(err) },
        'Failed to decrypt gateway credential'
      );
      return undefined;
    }
  }

  private encryptSecret(value: string): string {
    const encrypted = this.cipher.encrypt(value.trim());
    if (!encrypted) throw new AutomatedPaymentError('EMPTY_SECRET');
    return encrypted;
  }

  isForAppEnabled(): boolean {
    return (
      forappEnabled(this.translationService) &&
      Boolean(this.decryptSetting('forapp_api_key_encrypted'))
    );
  }

  isNowPaymentsEnabled(): boolean {
    return (
      nowpaymentsEnabled(this.translationService) &&
      Boolean(this.decryptSetting('nowpayments_api_key_encrypted'))
    );
  }

  verifyForAppApiKey(headerValue: string | string[] | undefined): boolean {
    const received = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const expected = this.decryptSetting('forapp_api_key_encrypted');
    return timingSafeSecretEqual(received, expected);
  }

  // ── Admin Configuration APIs ───────────────────────────────────────────────

  async getForAppUnmatchedCount(): Promise<number> {
    try {
      const [row] = await getDb()
        .select({ value: count() })
        .from(forappDeposits)
        .where(eq(forappDeposits.status, 'unmatched'));
      return dbIntegerToSafeNumber(row?.value ?? 0, 'forapp_unmatched_count');
    } catch {
      return 0;
    }
  }

  async getForAppAdminConfig(): Promise<ForAppAdminConfig> {
    const decryptedKey = this.decryptSetting('forapp_api_key_encrypted');
    const unmatchedCount = await this.getForAppUnmatchedCount();
    return {
      enabled: forappEnabled(this.translationService),
      apiKeyConfigured: Boolean(decryptedKey),
      apiKeyMasked: maskSecretTail(decryptedKey),
      orderExpiryMinutes: forappOrderExpiryMinutes(this.translationService),
      webhookUrl: this.getForAppWebhookUrl(),
      unmatchedCount,
    };
  }

  async updateForAppConfig(updates: {
    enabled?: boolean;
    orderExpiryMinutes?: number;
  }): Promise<ForAppAdminConfig> {
    const entries: Record<string, string> = {};
    if (typeof updates.enabled === 'boolean') {
      entries.forapp_enabled = String(updates.enabled);
    }
    if (updates.orderExpiryMinutes !== undefined) {
      const minutes = parseIntegerInput(updates.orderExpiryMinutes);
      if (minutes === null || minutes < 5 || minutes > 120) {
        throw new AutomatedPaymentError(
          'INVALID_FORAPP_EXPIRY',
          'Expiry minutes must be between 5 and 120'
        );
      }
      entries.forapp_order_expiry_minutes = String(minutes);
    }
    if (Object.keys(entries).length > 0) {
      await this.translationService.updateSettings(entries);
    }
    return this.getForAppAdminConfig();
  }

  async rotateForAppApiKey(): Promise<{
    apiKey: string;
    apiKeyMasked: string;
    webhookUrl: string | null;
  }> {
    const rawKey = `fa_${crypto.randomBytes(24).toString('base64url')}`;
    const encrypted = this.encryptSecret(rawKey);
    await this.translationService.updateSettings({
      forapp_api_key_encrypted: encrypted,
    });
    return {
      apiKey: rawKey,
      apiKeyMasked: maskSecretTail(rawKey) ?? '••••',
      webhookUrl: this.getForAppWebhookUrl(),
    };
  }

  async resolveUsdToTomanRate(options: { forceRefresh?: boolean } = {}): Promise<ResolvedUsdRate> {
    const mode = nowpaymentsRateMode(this.translationService);
    const manualRate = nowpaymentsManualUsdRateToman(this.translationService);

    if (mode === 'auto') {
      const live = await this.exchangeRateClient.fetchUsdTomanRate(options);
      if (live) {
        return {
          rateToman: live.rateToman,
          source: 'auto',
          provider: live.provider,
          fetchedAt: live.fetchedAt,
        };
      }
      return {
        rateToman: manualRate,
        source: 'fallback',
        fetchedAt: new Date(),
      };
    }

    return {
      rateToman: manualRate,
      source: 'manual',
      fetchedAt: new Date(),
    };
  }

  async getNowPaymentsAdminConfig(): Promise<NowPaymentsAdminConfig> {
    const apiKey = this.decryptSetting('nowpayments_api_key_encrypted');
    const ipnSecret = this.decryptSetting('nowpayments_ipn_secret_encrypted');
    const rateMode = nowpaymentsRateMode(this.translationService);
    const manualUsdRateToman = nowpaymentsManualUsdRateToman(this.translationService);
    const resolved = await this.resolveUsdToTomanRate().catch((): ResolvedUsdRate => ({
      rateToman: manualUsdRateToman,
      source: rateMode === 'auto' ? 'fallback' : 'manual',
      fetchedAt: new Date(),
    }));

    return {
      enabled: nowpaymentsEnabled(this.translationService),
      sandbox: nowpaymentsSandbox(this.translationService),
      apiKeyConfigured: Boolean(apiKey),
      ipnSecretConfigured: Boolean(ipnSecret),
      rateMode,
      manualUsdRateToman,
      effectiveUsdRateToman: resolved.rateToman,
      effectiveRateSource: resolved.source,
      minAmountToman: nowpaymentsMinAmountToman(this.translationService),
      maxAmountToman: nowpaymentsMaxAmountToman(this.translationService),
      cashbackPercent: nowpaymentsCashbackPercent(this.translationService),
      orderExpiryMinutes: nowpaymentsOrderExpiryMinutes(this.translationService),
      webhookUrl: this.getNowPaymentsWebhookUrl(),
    };
  }

  async updateNowPaymentsConfig(updates: {
    enabled?: boolean;
    sandbox?: boolean;
    apiKey?: string | null;
    ipnSecret?: string | null;
    rateMode?: NowPaymentsRateMode;
    manualUsdRateToman?: number;
    minAmountToman?: number;
    maxAmountToman?: number;
    cashbackPercent?: number;
    orderExpiryMinutes?: number;
  }): Promise<NowPaymentsAdminConfig> {
    const entries: Record<string, string> = {};

    if (typeof updates.enabled === 'boolean') {
      entries.nowpayments_enabled = String(updates.enabled);
    }
    if (typeof updates.sandbox === 'boolean') {
      entries.nowpayments_sandbox = String(updates.sandbox);
    }
    if (updates.apiKey !== undefined) {
      if (updates.apiKey === null || updates.apiKey.trim() === '') {
        entries.nowpayments_api_key_encrypted = '';
      } else {
        const trimmed = updates.apiKey.trim();
        if (trimmed.length < 8 || trimmed.length > 512) {
          throw new AutomatedPaymentError('INVALID_NOWPAYMENTS_API_KEY');
        }
        entries.nowpayments_api_key_encrypted = this.encryptSecret(trimmed);
      }
    }
    if (updates.ipnSecret !== undefined) {
      if (updates.ipnSecret === null || updates.ipnSecret.trim() === '') {
        entries.nowpayments_ipn_secret_encrypted = '';
      } else {
        const trimmed = updates.ipnSecret.trim();
        if (trimmed.length < 8 || trimmed.length > 512) {
          throw new AutomatedPaymentError('INVALID_NOWPAYMENTS_IPN_SECRET');
        }
        entries.nowpayments_ipn_secret_encrypted = this.encryptSecret(trimmed);
      }
    }
    if (updates.rateMode !== undefined) {
      if (updates.rateMode !== 'manual' && updates.rateMode !== 'auto') {
        throw new AutomatedPaymentError('INVALID_RATE_MODE');
      }
      entries.nowpayments_rate_mode = updates.rateMode;
    }
    if (updates.manualUsdRateToman !== undefined) {
      const rate = parseIntegerInput(updates.manualUsdRateToman);
      if (rate === null || rate < 10_000 || rate > 5_000_000) {
        throw new AutomatedPaymentError('INVALID_USD_RATE');
      }
      entries.nowpayments_usd_rate_toman = String(rate);
    }

    const currentMin = nowpaymentsMinAmountToman(this.translationService);
    const currentMax = nowpaymentsMaxAmountToman(this.translationService);
    let nextMin = currentMin;
    let nextMax = currentMax;

    if (updates.minAmountToman !== undefined) {
      const minVal = parseIntegerInput(updates.minAmountToman);
      if (minVal === null || minVal < 10_000 || minVal > MAX_SAFE_INT) {
        throw new AutomatedPaymentError('INVALID_MIN_AMOUNT');
      }
      nextMin = minVal;
      entries.nowpayments_min_amount_toman = String(minVal);
    }
    if (updates.maxAmountToman !== undefined) {
      const maxVal = parseIntegerInput(updates.maxAmountToman);
      if (maxVal === null || maxVal < 10_000 || maxVal > MAX_SAFE_INT) {
        throw new AutomatedPaymentError('INVALID_MAX_AMOUNT');
      }
      nextMax = maxVal;
      entries.nowpayments_max_amount_toman = String(maxVal);
    }
    if (nextMax < nextMin) {
      throw new AutomatedPaymentError('INVALID_AMOUNT_RANGE');
    }

    if (updates.cashbackPercent !== undefined) {
      const cb = parseIntegerInput(updates.cashbackPercent);
      if (cb === null || cb < 0 || cb > 50) {
        throw new AutomatedPaymentError('INVALID_CASHBACK_PERCENT');
      }
      entries.nowpayments_cashback_percent = String(cb);
    }
    if (updates.orderExpiryMinutes !== undefined) {
      const exp = parseIntegerInput(updates.orderExpiryMinutes);
      if (exp === null || exp < 10 || exp > 1440) {
        throw new AutomatedPaymentError('INVALID_EXPIRY_MINUTES');
      }
      entries.nowpayments_order_expiry_minutes = String(exp);
    }

    if (Object.keys(entries).length > 0) {
      await this.translationService.updateSettings(entries);
    }
    return this.getNowPaymentsAdminConfig();
  }

  async testNowPaymentsConnection(): Promise<{
    ok: boolean;
    message: string;
    sandbox: boolean;
    rateToman: number;
    rateSource: 'auto' | 'manual' | 'fallback';
  }> {
    const sandbox = nowpaymentsSandbox(this.translationService);
    const [statusRes, rateRes] = await Promise.all([
      this.nowPaymentsClient.getApiStatus(sandbox).catch((err: unknown) => ({
        ok: false,
        message: err instanceof Error ? err.message : 'Connection failed',
      })),
      this.resolveUsdToTomanRate({ forceRefresh: true }),
    ]);

    return {
      ok: statusRes.ok,
      message: statusRes.message,
      sandbox,
      rateToman: rateRes.rateToman,
      rateSource: rateRes.source,
    };
  }

  // ── ForApp Automated Card-to-Card Orders ───────────────────────────────────

  async createForAppOrder(params: {
    telegramId: number;
    requestedAmount: number;
    locale?: 'fa' | 'en';
  }): Promise<PaymentOrderRow> {
    if (!this.isForAppEnabled()) {
      throw new AutomatedPaymentError('FORAPP_DISABLED');
    }

    const amount = parseIntegerInput(params.requestedAmount);
    const minAmount = this.translationService.getSettingNum('topup_min_amount', 10_000);
    const maxAmount = this.translationService.getSettingNum('topup_max_amount', 10_000_000);
    if (amount === null || amount < minAmount || amount > maxAmount) {
      throw new AutomatedPaymentError('INVALID_TOPUP_AMOUNT');
    }

    const selectedCard = await this.paymentService.selectCardForTopupWithDailyCaps({
      amountToman: amount,
    });
    if (!selectedCard) {
      const activeCards = this.paymentService.getActiveBankCards();
      throw new AutomatedPaymentError(
        activeCards.length > 0 ? 'ALL_CARDS_CAP_REACHED' : 'NO_BANK_CARD'
      );
    }

    const now = new Date();
    const expiryMinutes = forappOrderExpiryMinutes(this.translationService);
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

    // Expire overdue orders & cancel user's previous pending ForApp order so each user
    // occupies at most one unique payable amount slot at a time.
    await this.expireStaleOrders(now);
    await this.cancelPendingForAppOrdersForUser(params.telegramId);

    const allocation = await this.paymentService.allocateUniquePayableAmount(amount, {
      mode: 'add',
      minOffset: 1,
      maxOffset: 999,
      avoidRoundMultiplesOf: 100,
    });

    if (!allocation.isUnique || allocation.payableAmount <= 0) {
      throw new AutomatedPaymentError('NO_UNIQUE_AMOUNT_AVAILABLE');
    }

    const payableAmount = dbIntegerToSafeNumber(allocation.payableAmount, 'forapp_payable_toman');
    const payableAmountRial = dbIntegerToSafeNumber(
      BigInt(payableAmount) * 10n,
      'forapp_payable_rial'
    );

    const locale = params.locale ?? 'fa';
    const cardNumber = normalizeCardNumber(selectedCard.cardNumber);
    const cardHolder =
      selectedCard.cardHolder || this.translationService.getSetting('card_holder', '').trim();
    const bankName = selectedCard.bankName || detectIranianBankName(cardNumber, locale) || null;

    const orderId = `po_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const db = getDb();
    const [created] = await db
      .insert(paymentOrders)
      .values({
        id: orderId,
        telegramId: params.telegramId,
        provider: 'forapp_card',
        status: 'pending',
        requestedAmount: amount,
        payableAmount,
        payableAmountRial,
        cashbackAmount: 0,
        cardId: selectedCard.id,
        cardNumber,
        cardHolder: cardHolder || null,
        bankName,
        metadata: JSON.stringify({ offset: allocation.offset }),
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new AutomatedPaymentError('ORDER_CREATE_FAILED');
    }
    return created;
  }

  /**
   * Process an incoming ForApp webhook delivery (POST /api/webhooks/forapp).
   * Strictly enforces X-API-Key timing-safe auth, test mode, Idempotency-Key deduplication,
   * is_deposit === true, exact Rial-to-Toman division (amount % 10 === 0), and FOR UPDATE matching.
   */
  async processForAppWebhook(params: {
    apiKeyHeader: string | string[] | undefined;
    idempotencyKeyHeader: string | string[] | undefined;
    body: unknown;
    now?: Date;
  }): Promise<ForAppWebhookProcessResult> {
    if (!this.verifyForAppApiKey(params.apiKeyHeader)) {
      return { statusCode: 401, outcome: 'unauthorized' };
    }

    if (!params.body || typeof params.body !== 'object' || Array.isArray(params.body)) {
      return { statusCode: 400, outcome: 'invalid_payload' };
    }

    const payload = params.body as Record<string, unknown>;

    // Official ForApp test ping — always 200 OK without touching balances or deposit logs.
    if (payload.test === true) {
      return {
        statusCode: 200,
        outcome: 'test_ok',
        enabled: this.isForAppEnabled(),
      };
    }

    if (!this.isForAppEnabled()) {
      return { statusCode: 403, outcome: 'disabled' };
    }

    const rawHeaderKey = Array.isArray(params.idempotencyKeyHeader)
      ? params.idempotencyKeyHeader[0]
      : params.idempotencyKeyHeader;
    const idempotencyKey = (
      (typeof rawHeaderKey === 'string' && rawHeaderKey.trim()) ||
      (typeof payload.id === 'string' && payload.id.trim()) ||
      (typeof payload.id === 'number' ? String(payload.id) : '')
    ).slice(0, 200);

    if (!idempotencyKey) {
      return { statusCode: 400, outcome: 'missing_idempotency_key' };
    }

    const now = params.now ?? new Date();
    const rawAmount = parseIntegerInput(payload.amount);
    const amountRial = rawAmount !== null && rawAmount >= 0 ? rawAmount : 0;
    const unit =
      typeof payload.unit === 'string' && payload.unit.trim()
        ? payload.unit.trim().toLowerCase()
        : 'rial';
    const isDeposit = typeof payload.is_deposit === 'boolean' ? payload.is_deposit : null;
    const forappMessageId =
      typeof payload.id === 'string' || typeof payload.id === 'number'
        ? String(payload.id).slice(0, 200)
        : null;
    const bank =
      typeof payload.bank === 'string' ? payload.bank.trim().slice(0, 120) || null : null;
    const sender =
      typeof payload.sender === 'string' ? payload.sender.trim().slice(0, 120) || null : null;
    const code =
      typeof payload.code === 'string' || typeof payload.code === 'number'
        ? String(payload.code).trim().slice(0, 16) || null
        : null;
    const rawBody = typeof payload.body === 'string' ? payload.body.slice(0, 2000) : null;
    const device =
      typeof payload.device === 'string' ? payload.device.trim().slice(0, 160) || null : null;

    let receivedAt: Date | null = null;
    if (typeof payload.received_at_ms === 'number' && Number.isFinite(payload.received_at_ms)) {
      const d = new Date(payload.received_at_ms);
      if (!Number.isNaN(d.getTime())) receivedAt = d;
    } else if (typeof payload.received_at === 'string' && payload.received_at.trim()) {
      const d = new Date(payload.received_at);
      if (!Number.isNaN(d.getTime())) receivedAt = d;
    }

    const isExactToman = unit === 'rial' && amountRial > 0 && amountRial % 10 === 0;
    const amountToman = isExactToman
      ? dbIntegerToSafeNumber(BigInt(amountRial) / 10n, 'forapp_deposit_toman')
      : null;

    const depositId = `fad_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const db = getDb();

    const txResult = await db.transaction(async (tx): Promise<ForAppWebhookProcessResult> => {
      const [insertedDeposit] = await tx
        .insert(forappDeposits)
        .values({
          id: depositId,
          idempotencyKey,
          forappMessageId,
          amountRial,
          amountToman,
          unit,
          isDeposit,
          bank,
          sender,
          code,
          rawBody,
          device,
          receivedAt,
          status: 'unmatched',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: forappDeposits.idempotencyKey })
        .returning();

      if (!insertedDeposit) {
        return {
          statusCode: 200,
          outcome: 'duplicate',
          idempotencyKey,
        };
      }

      if (isDeposit !== true) {
        const [ignoredDeposit] = await tx
          .update(forappDeposits)
          .set({ status: 'ignored', note: 'not_deposit', updatedAt: now })
          .where(eq(forappDeposits.id, insertedDeposit.id))
          .returning();
        return {
          statusCode: 200,
          outcome: 'ignored',
          idempotencyKey,
          deposit: ignoredDeposit ?? { ...insertedDeposit, status: 'ignored', note: 'not_deposit' },
        };
      }

      if (unit !== 'rial' || amountRial <= 0) {
        const note = unit !== 'rial' ? `unsupported_unit:${unit}` : 'non_positive_amount';
        const [ignoredDeposit] = await tx
          .update(forappDeposits)
          .set({ status: 'ignored', note, updatedAt: now })
          .where(eq(forappDeposits.id, insertedDeposit.id))
          .returning();
        return {
          statusCode: 200,
          outcome: 'ignored',
          idempotencyKey,
          deposit: ignoredDeposit ?? { ...insertedDeposit, status: 'ignored', note },
        };
      }

      // 1. Atomic row lock on oldest unexpired pending ForApp order with exact Toman amount.
      const [matchedOrder] =
        amountToman !== null && amountToman > 0
          ? await tx
              .select()
              .from(paymentOrders)
              .where(
                and(
                  eq(paymentOrders.provider, 'forapp_card'),
                  eq(paymentOrders.status, 'pending'),
                  eq(paymentOrders.payableAmount, amountToman),
                  gt(paymentOrders.expiresAt, now)
                )
              )
              .orderBy(asc(paymentOrders.createdAt))
              .limit(1)
              .for('update')
          : [undefined];

      if (!matchedOrder || amountToman === null) {
        // 2. Round Toman transfers (multiples of 1,000 Toman, e.g. 2,000,000 Toman) are personal
        //    non-bot deposits — ForApp invoices always carry a non-round unique offset.
        if (amountToman !== null && isRoundForAppDepositToman(amountToman)) {
          const note = 'round_amount';
          const [ignoredDeposit] = await tx
            .update(forappDeposits)
            .set({ status: 'ignored', note, updatedAt: now })
            .where(eq(forappDeposits.id, insertedDeposit.id))
            .returning();
          return {
            statusCode: 200,
            outcome: 'ignored',
            idempotencyKey,
            deposit: ignoredDeposit ?? { ...insertedDeposit, status: 'ignored', note },
          };
        }

        // 3. Check whether this non-round / odd-Rial deposit correlates with any recent uncompleted
        //    ForApp order (late SMS after expiry, cancelled order, 10x Rial/Toman mistake, or digit typo).
        const lookbackCutoff = new Date(now.getTime() - FORAPP_EXACT_LATE_ORDER_LOOKBACK_MS);
        const recentOrders = await tx
          .select()
          .from(paymentOrders)
          .where(
            and(
              eq(paymentOrders.provider, 'forapp_card'),
              inArray(paymentOrders.status, ['pending', 'expired', 'cancelled']),
              gte(paymentOrders.createdAt, lookbackCutoff)
            )
          )
          .orderBy(desc(paymentOrders.createdAt))
          .limit(50);

        const correlation = correlateUnmatchedForAppDeposit({
          amountRial,
          amountToman,
          now,
          recentOrders,
        });

        if (!correlation) {
          const note = amountToman === null ? 'unrelated_odd_rial' : 'unrelated_deposit';
          const [ignoredDeposit] = await tx
            .update(forappDeposits)
            .set({ status: 'ignored', note, updatedAt: now })
            .where(eq(forappDeposits.id, insertedDeposit.id))
            .returning();
          return {
            statusCode: 200,
            outcome: 'ignored',
            idempotencyKey,
            deposit: ignoredDeposit ?? { ...insertedDeposit, status: 'ignored', note },
          };
        }

        const note =
          correlation.reason === 'rial_not_multiple_of_10'
            ? 'rial_not_multiple_of_10'
            : `${correlation.reason}:${correlation.order.id}`;
        const [unmatchedDeposit] = await tx
          .update(forappDeposits)
          .set({ status: 'unmatched', note, updatedAt: now })
          .where(eq(forappDeposits.id, insertedDeposit.id))
          .returning();
        return {
          statusCode: 200,
          outcome: 'unmatched',
          idempotencyKey,
          relatedOrder: correlation.order,
          deposit: unmatchedDeposit ?? {
            ...insertedDeposit,
            status: 'unmatched',
            note,
          },
        };
      }

      const credit = await this.creditWalletInTransaction(tx, {
        telegramId: matchedOrder.telegramId,
        amountToman,
        referenceId: `forapp_order_${matchedOrder.id}`,
        description: `Automated ForApp card-to-card top-up (${matchedOrder.id})`,
        auditAction: 'forapp_topup_matched',
        auditEntityType: 'payment_order',
        auditEntityId: matchedOrder.id,
        auditMetadata: {
          orderId: matchedOrder.id,
          depositId: insertedDeposit.id,
          amountRial,
          amountToman,
          bank,
          cardId: matchedOrder.cardId,
        },
        now,
      });

      const [completedOrder] = await tx
        .update(paymentOrders)
        .set({
          status: 'completed',
          creditedAmount: amountToman,
          externalId: insertedDeposit.id,
          walletTransactionId: credit.walletTransactionId,
          completedAt: now,
          updatedAt: now,
        })
        .where(and(eq(paymentOrders.id, matchedOrder.id), eq(paymentOrders.status, 'pending')))
        .returning();

      const [matchedDeposit] = await tx
        .update(forappDeposits)
        .set({
          status: 'matched',
          matchedOrderId: matchedOrder.id,
          matchedTelegramId: matchedOrder.telegramId,
          walletTransactionId: credit.walletTransactionId,
          note: null,
          updatedAt: now,
        })
        .where(eq(forappDeposits.id, insertedDeposit.id))
        .returning();

      return {
        statusCode: 200,
        outcome: 'matched',
        idempotencyKey,
        order: completedOrder ?? {
          ...matchedOrder,
          status: 'completed',
          creditedAmount: amountToman,
        },
        deposit: matchedDeposit ?? { ...insertedDeposit, status: 'matched' },
        creditedAmount: amountToman,
        balanceAfter: credit.balanceAfter,
      };
    });

    if (txResult.outcome === 'matched' && txResult.order) {
      this.walletService?.invalidateUserCache?.(txResult.order.telegramId);
      if (txResult.order.cardId && txResult.creditedAmount) {
        this.paymentService.recordCardDailyUsage(
          txResult.order.cardId,
          txResult.creditedAmount,
          now
        );
      }
    }

    return txResult;
  }

  async listForAppDeposits(
    options: {
      page?: number;
      pageSize?: number;
      status?: ForAppDepositStatus | 'all';
    } = {}
  ): Promise<{
    items: ForAppDepositRow[];
    total: number;
    unmatchedCount: number;
    page: number;
    totalPages: number;
  }> {
    const safePage = Math.max(1, Math.trunc(options.page ?? 1) || 1);
    const safePageSize = Math.max(1, Math.min(Math.trunc(options.pageSize ?? 10) || 10, 50));
    const status = options.status ?? 'unmatched';
    const db = getDb();
    const whereClause = status !== 'all' ? eq(forappDeposits.status, status) : undefined;

    const [[totalRow], [unmatchedRow], items] = await Promise.all([
      db.select({ value: count() }).from(forappDeposits).where(whereClause),
      db
        .select({ value: count() })
        .from(forappDeposits)
        .where(eq(forappDeposits.status, 'unmatched')),
      db
        .select()
        .from(forappDeposits)
        .where(whereClause)
        .orderBy(desc(forappDeposits.createdAt))
        .limit(safePageSize)
        .offset((safePage - 1) * safePageSize),
    ]);

    const total = dbIntegerToSafeNumber(totalRow?.value ?? 0, 'forapp_deposits_total');
    const unmatchedCount = dbIntegerToSafeNumber(
      unmatchedRow?.value ?? 0,
      'forapp_deposits_unmatched'
    );
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    return { items, total, unmatchedCount, page: Math.min(safePage, totalPages), totalPages };
  }

  async getForAppDepositById(depositId: string): Promise<ForAppDepositRow | null> {
    const [row] = await getDb()
      .select()
      .from(forappDeposits)
      .where(eq(forappDeposits.id, depositId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Manually match an unmatched ForApp deposit to a target user wallet atomically.
   */
  async manualMatchForAppDeposit(params: {
    depositId: string;
    targetTelegramId: number;
    adminId: number;
    overrideAmountToman?: number;
    note?: string;
  }): Promise<ManualMatchForAppDepositResult> {
    if (!Number.isSafeInteger(params.targetTelegramId) || params.targetTelegramId <= 0) {
      throw new AutomatedPaymentError('INVALID_TARGET_USER');
    }
    if (!Number.isSafeInteger(params.adminId) || params.adminId <= 0) {
      throw new AutomatedPaymentError('INVALID_ADMIN');
    }

    const now = new Date();
    const db = getDb();

    const result = await db.transaction(async (tx) => {
      const [deposit] = await tx
        .select()
        .from(forappDeposits)
        .where(eq(forappDeposits.id, params.depositId))
        .for('update')
        .limit(1);

      if (!deposit) {
        throw new AutomatedPaymentError('DEPOSIT_NOT_FOUND');
      }
      if (deposit.status !== 'unmatched' && deposit.status !== 'ignored') {
        throw new AutomatedPaymentError('DEPOSIT_NOT_UNMATCHED');
      }

      const derivedToman =
        params.overrideAmountToman !== undefined
          ? parseIntegerInput(params.overrideAmountToman)
          : deposit.amountToman !== null
            ? dbIntegerToSafeNumber(deposit.amountToman, 'deposit_amount_toman')
            : deposit.amountRial >= 10
              ? dbIntegerToSafeNumber(BigInt(deposit.amountRial) / 10n, 'deposit_rial_floor_toman')
              : null;

      if (derivedToman === null || derivedToman <= 0) {
        throw new AutomatedPaymentError('INVALID_DEPOSIT_AMOUNT');
      }

      const credit = await this.creditWalletInTransaction(tx, {
        telegramId: params.targetTelegramId,
        amountToman: derivedToman,
        referenceId: `forapp_deposit_${deposit.id}`,
        description: `ForApp deposit ${deposit.id} manually matched by admin ${params.adminId}`,
        actorTelegramId: params.adminId,
        auditAction: 'forapp_deposit_manual_matched',
        auditEntityType: 'forapp_deposit',
        auditEntityId: deposit.id,
        auditMetadata: {
          depositId: deposit.id,
          amountRial: deposit.amountRial,
          creditedAmount: derivedToman,
          note: params.note?.trim() || null,
        },
        now,
      });

      const [updated] = await tx
        .update(forappDeposits)
        .set({
          status: 'manual_matched',
          matchedTelegramId: params.targetTelegramId,
          matchedByAdminId: params.adminId,
          walletTransactionId: credit.walletTransactionId,
          note: params.note?.trim() || deposit.note,
          updatedAt: now,
        })
        .where(
          and(
            eq(forappDeposits.id, deposit.id),
            inArray(forappDeposits.status, ['unmatched', 'ignored'])
          )
        )
        .returning();

      return {
        deposit: updated ?? { ...deposit, status: 'manual_matched' },
        telegramId: params.targetTelegramId,
        creditedAmount: derivedToman,
        balanceAfter: credit.balanceAfter,
        walletTransactionId: credit.walletTransactionId,
      };
    });

    this.walletService?.invalidateUserCache?.(result.telegramId);
    return result;
  }

  async dismissForAppDeposit(params: {
    depositId: string;
    adminId: number;
    note?: string;
  }): Promise<ForAppDepositRow | null> {
    const now = new Date();
    const db = getDb();
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(forappDeposits)
        .set({
          status: 'dismissed',
          matchedByAdminId: params.adminId,
          note: params.note?.trim() || 'dismissed_by_admin',
          updatedAt: now,
        })
        .where(and(eq(forappDeposits.id, params.depositId), eq(forappDeposits.status, 'unmatched')))
        .returning();

      if (!updated) return null;

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: params.adminId,
        action: 'forapp_deposit_dismissed',
        entityType: 'forapp_deposit',
        entityId: updated.id,
        metadata: JSON.stringify({ note: params.note?.trim() || null }),
      });

      return updated;
    });
  }

  // ── NOWPayments Crypto Orders & IPN ────────────────────────────────────────

  async createNowPaymentsOrder(params: {
    telegramId: number;
    amountToman: number;
    orderDescription?: string;
  }): Promise<PaymentOrderRow> {
    if (!this.isNowPaymentsEnabled()) {
      throw new AutomatedPaymentError('NOWPAYMENTS_DISABLED');
    }

    const apiKey = this.decryptSetting('nowpayments_api_key_encrypted');
    if (!apiKey) {
      throw new AutomatedPaymentError('NOWPAYMENTS_NOT_CONFIGURED');
    }

    const amount = parseIntegerInput(params.amountToman);
    const minAmount = nowpaymentsMinAmountToman(this.translationService);
    const maxAmount = nowpaymentsMaxAmountToman(this.translationService);
    if (amount === null || amount < minAmount || amount > maxAmount) {
      throw new AutomatedPaymentError('INVALID_TOPUP_AMOUNT');
    }

    const resolvedRate = await this.resolveUsdToTomanRate();
    const usdRaw = amount / resolvedRate.rateToman;
    const usdAmount = Math.round(usdRaw * 100) / 100;
    if (!Number.isFinite(usdAmount) || usdAmount < MIN_NOWPAYMENTS_USD) {
      throw new AutomatedPaymentError('AMOUNT_TOO_SMALL_USD');
    }

    const now = new Date();
    const orderId = `po_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const sandbox = nowpaymentsSandbox(this.translationService);
    const ipnCallbackUrl = this.getNowPaymentsWebhookUrl() ?? undefined;
    const baseUrl = this.resolveBaseUrl();

    const invoice = await this.nowPaymentsClient.createInvoice({
      apiKey,
      sandbox,
      priceAmount: usdAmount,
      priceCurrency: 'usd',
      orderId,
      orderDescription:
        params.orderDescription ?? `Wallet top-up #${formatPaymentOrderShortId(orderId)}`,
      ipnCallbackUrl,
      ...(baseUrl ? { successUrl: baseUrl, cancelUrl: baseUrl } : {}),
    });

    const cashbackPercent = nowpaymentsCashbackPercent(this.translationService);
    const expiryMinutes = nowpaymentsOrderExpiryMinutes(this.translationService);
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

    const [created] = await getDb()
      .insert(paymentOrders)
      .values({
        id: orderId,
        telegramId: params.telegramId,
        provider: 'nowpayments',
        status: 'pending',
        requestedAmount: amount,
        payableAmount: amount,
        cashbackAmount: 0,
        externalId: invoice.id,
        paymentUrl: invoice.invoiceUrl,
        fiatAmountUsd: usdAmount.toFixed(2),
        exchangeRateTomanPerUsd: resolvedRate.rateToman,
        providerStatus: 'waiting',
        metadata: JSON.stringify({
          cashbackPercent,
          rateSource: resolvedRate.source,
          rateProvider: resolvedRate.provider ?? null,
          sandbox,
        }),
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new AutomatedPaymentError('ORDER_CREATE_FAILED');
    }
    return created;
  }

  /**
   * Process NOWPayments IPN webhook (POST /api/webhooks/nowpayments):
   *  1. Verify HMAC-SHA512 `x-nowpayments-sig` over recursively key-sorted JSON payload
   *  2. Authoritative double-check via `GET /v1/payment/{payment_id}` before crediting
   *  3. Atomic FOR UPDATE settlement with optional gateway cashback & idempotency
   */
  async processNowPaymentsIpn(params: {
    payload: unknown;
    signatureHeader: string | string[] | undefined;
  }): Promise<NowPaymentsIpnProcessResult> {
    const ipnSecret = this.decryptSetting('nowpayments_ipn_secret_encrypted');
    if (!verifyNowPaymentsSignature(params.payload, params.signatureHeader, ipnSecret)) {
      return { statusCode: 401, outcome: 'invalid_signature' };
    }

    const body = params.payload as Record<string, unknown>;
    const rawPaymentId = body.payment_id;
    const paymentId =
      typeof rawPaymentId === 'string' || typeof rawPaymentId === 'number'
        ? String(rawPaymentId).trim()
        : '';
    if (!paymentId) {
      return { statusCode: 400, outcome: 'missing_payment_id' };
    }

    const apiKey = this.decryptSetting('nowpayments_api_key_encrypted');
    if (!apiKey) {
      return { statusCode: 503, outcome: 'not_configured' };
    }

    const sandbox = nowpaymentsSandbox(this.translationService);
    // Authoritative double-check against NOWPayments REST API before trusting IPN state!
    const verified = await this.nowPaymentsClient.getPaymentStatus(paymentId, apiKey, sandbox);

    const ipnOrderId = typeof body.order_id === 'string' ? body.order_id.trim() : '';
    const ipnInvoiceId =
      typeof body.invoice_id === 'string' || typeof body.invoice_id === 'number'
        ? String(body.invoice_id).trim()
        : '';

    const candidateOrderId = verified.orderId?.trim() || ipnOrderId || null;
    const candidateInvoiceId = verified.invoiceId?.trim() || ipnInvoiceId || null;

    const order = await this.findNowPaymentsOrder({
      orderId: candidateOrderId,
      invoiceId: candidateInvoiceId,
      paymentId: verified.paymentId,
    });

    if (!order) {
      logger.warn(
        { paymentId: verified.paymentId, candidateOrderId, candidateInvoiceId },
        'NOWPayments IPN received for unknown payment order'
      );
      return { statusCode: 404, outcome: 'order_not_found', paymentDetail: verified };
    }

    return this.settleNowPaymentsOrder(order.id, verified);
  }

  private async findNowPaymentsOrder(lookup: {
    orderId: string | null;
    invoiceId: string | null;
    paymentId: string;
  }): Promise<PaymentOrderRow | null> {
    const db = getDb();
    const conditions = [];
    if (lookup.orderId) {
      conditions.push(eq(paymentOrders.id, lookup.orderId));
    }
    if (lookup.invoiceId) {
      conditions.push(eq(paymentOrders.externalId, lookup.invoiceId));
    }
    conditions.push(eq(paymentOrders.externalPaymentId, lookup.paymentId));

    const [found] = await db
      .select()
      .from(paymentOrders)
      .where(
        and(
          eq(paymentOrders.provider, 'nowpayments'),
          conditions.length === 1 ? conditions[0]! : or(...conditions)!
        )
      )
      .limit(1);
    return found ?? null;
  }

  private async settleNowPaymentsOrder(
    orderId: string,
    verified: NowPaymentsPaymentDetail
  ): Promise<NowPaymentsIpnProcessResult> {
    const now = new Date();
    const db = getDb();
    const normalizedStatus = verified.paymentStatus.trim().toLowerCase();

    const txResult = await db.transaction(async (tx): Promise<NowPaymentsIpnProcessResult> => {
      const [order] = await tx
        .select()
        .from(paymentOrders)
        .where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.provider, 'nowpayments')))
        .for('update')
        .limit(1);

      if (!order) {
        return { statusCode: 404, outcome: 'order_not_found', paymentDetail: verified };
      }

      if (order.status === 'completed') {
        return {
          statusCode: 200,
          outcome: 'already_completed',
          order,
          paymentDetail: verified,
          creditedAmount: order.creditedAmount ?? order.payableAmount,
          cashbackAmount: order.cashbackAmount,
          newlyCompleted: false,
        };
      }

      const trackingFields = {
        externalPaymentId: verified.paymentId,
        payCurrency: verified.payCurrency ?? order.payCurrency,
        payAmount: verified.payAmount ?? order.payAmount,
        actuallyPaid: verified.actuallyPaid ?? order.actuallyPaid,
        providerStatus: normalizedStatus,
        updatedAt: now,
      };

      if (normalizedStatus === 'finished') {
        const creditAmount = dbIntegerToSafeNumber(order.payableAmount, 'nowpayments_credit_toman');
        const meta = parseOrderMetadata(order.metadata);
        const rawCb = parseIntegerInput(meta.cashbackPercent);
        const cashbackPercent = rawCb !== null && rawCb >= 0 && rawCb <= 50 ? rawCb : 0;
        const cashbackAmount =
          cashbackPercent > 0 ? Math.floor((creditAmount * cashbackPercent) / 100) : 0;

        const credit = await this.creditWalletInTransaction(tx, {
          telegramId: order.telegramId,
          amountToman: creditAmount,
          referenceId: `nowpayments_order_${order.id}`,
          description: `NOWPayments crypto top-up (${order.id})`,
          cashbackAmount,
          cashbackReferenceId: cashbackAmount > 0 ? `nowpayments_cb_${order.id}` : undefined,
          cashbackDescription:
            cashbackAmount > 0
              ? `NOWPayments gateway cashback (${cashbackPercent}%) for ${order.id}`
              : undefined,
          auditAction: 'nowpayments_topup_completed',
          auditEntityType: 'payment_order',
          auditEntityId: order.id,
          auditMetadata: {
            orderId: order.id,
            paymentId: verified.paymentId,
            invoiceId: verified.invoiceId,
            creditAmount,
            cashbackPercent,
            cashbackAmount,
            payCurrency: verified.payCurrency,
            actuallyPaid: verified.actuallyPaid,
          },
          now,
        });

        const [completedOrder] = await tx
          .update(paymentOrders)
          .set({
            ...trackingFields,
            status: 'completed',
            creditedAmount: creditAmount,
            cashbackAmount,
            walletTransactionId: credit.walletTransactionId,
            completedAt: now,
          })
          .where(eq(paymentOrders.id, order.id))
          .returning();

        return {
          statusCode: 200,
          outcome: 'completed',
          order: completedOrder ?? {
            ...order,
            ...trackingFields,
            status: 'completed',
            creditedAmount: creditAmount,
            cashbackAmount,
          },
          paymentDetail: verified,
          creditedAmount: creditAmount,
          cashbackAmount,
          balanceAfter: credit.balanceAfter,
          newlyCompleted: !credit.alreadyProcessed,
        };
      }

      if (normalizedStatus === 'partially_paid') {
        const [updated] = await tx
          .update(paymentOrders)
          .set({
            ...trackingFields,
            status: 'partially_paid',
          })
          .where(eq(paymentOrders.id, order.id))
          .returning();

        await tx.insert(auditLogs).values({
          id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          actorTelegramId: null,
          action: 'nowpayments_partially_paid',
          entityType: 'payment_order',
          entityId: order.id,
          targetTelegramId: order.telegramId,
          metadata: JSON.stringify({
            paymentId: verified.paymentId,
            payCurrency: verified.payCurrency,
            payAmount: verified.payAmount,
            actuallyPaid: verified.actuallyPaid,
          }),
        });

        return {
          statusCode: 200,
          outcome: 'partially_paid',
          order: updated ?? { ...order, ...trackingFields, status: 'partially_paid' },
          paymentDetail: verified,
        };
      }

      if (normalizedStatus === 'expired') {
        const [updated] = await tx
          .update(paymentOrders)
          .set({ ...trackingFields, status: 'expired' })
          .where(eq(paymentOrders.id, order.id))
          .returning();
        return {
          statusCode: 200,
          outcome: 'expired',
          order: updated ?? { ...order, ...trackingFields, status: 'expired' },
          paymentDetail: verified,
        };
      }

      if (normalizedStatus === 'failed' || normalizedStatus === 'refunded') {
        const [updated] = await tx
          .update(paymentOrders)
          .set({ ...trackingFields, status: 'failed' })
          .where(eq(paymentOrders.id, order.id))
          .returning();
        return {
          statusCode: 200,
          outcome: 'failed',
          order: updated ?? { ...order, ...trackingFields, status: 'failed' },
          paymentDetail: verified,
        };
      }

      // Intermediate statuses: waiting / confirming / confirmed / sending
      const nextStatus = normalizedStatus === 'waiting' ? 'pending' : 'confirming';
      const [updated] = await tx
        .update(paymentOrders)
        .set({ ...trackingFields, status: nextStatus })
        .where(eq(paymentOrders.id, order.id))
        .returning();

      return {
        statusCode: 200,
        outcome: 'in_progress',
        order: updated ?? { ...order, ...trackingFields, status: nextStatus },
        paymentDetail: verified,
      };
    });

    if (txResult.outcome === 'completed' && txResult.order) {
      this.walletService?.invalidateUserCache?.(txResult.order.telegramId);
    }
    return txResult;
  }

  // ── User Order Lookup, Status Check & Lifecycle ────────────────────────────

  async getActivePendingOrderForUser(
    telegramId: number,
    provider?: PaymentOrderProvider
  ): Promise<PaymentOrderRow | null> {
    const now = new Date();
    await this.expireStaleOrders(now);
    const conditions = [
      eq(paymentOrders.telegramId, telegramId),
      inArray(paymentOrders.status, ['pending', 'confirming']),
      gt(paymentOrders.expiresAt, now),
    ];
    if (provider) {
      conditions.push(eq(paymentOrders.provider, provider));
    }
    const [row] = await getDb()
      .select()
      .from(paymentOrders)
      .where(and(...conditions))
      .orderBy(desc(paymentOrders.createdAt))
      .limit(1);
    return row ?? null;
  }

  async getOrderByIdForUser(orderId: string, telegramId: number): Promise<PaymentOrderRow | null> {
    const [row] = await getDb()
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.telegramId, telegramId)))
      .limit(1);
    return row ?? null;
  }

  async checkOrderStatusForUser(params: { orderId: string; telegramId: number }): Promise<{
    order: PaymentOrderRow;
    newlyCompleted: boolean;
    balanceAfter?: number;
  } | null> {
    const existing = await this.getOrderByIdForUser(params.orderId, params.telegramId);
    if (!existing) return null;

    if (
      existing.status === 'completed' ||
      existing.status === 'cancelled' ||
      existing.status === 'failed' ||
      existing.status === 'expired'
    ) {
      return { order: existing, newlyCompleted: false };
    }

    // For NOWPayments orders with a known payment_id, perform live double-check verification.
    if (existing.provider === 'nowpayments' && existing.externalPaymentId) {
      const apiKey = this.decryptSetting('nowpayments_api_key_encrypted');
      if (apiKey) {
        try {
          const detail = await this.nowPaymentsClient.getPaymentStatus(
            existing.externalPaymentId,
            apiKey,
            nowpaymentsSandbox(this.translationService)
          );
          const settled = await this.settleNowPaymentsOrder(existing.id, detail);
          if (settled.order) {
            return {
              order: settled.order,
              newlyCompleted: Boolean(settled.newlyCompleted),
              balanceAfter: settled.balanceAfter,
            };
          }
        } catch (err) {
          logger.debug(
            { err, orderId: existing.id },
            'NOWPayments live status check failed; returning persisted order state'
          );
        }
      }
    }

    // Mark expired if window has passed while still pending.
    const now = new Date();
    if (existing.status === 'pending' && new Date(existing.expiresAt).getTime() <= now.getTime()) {
      const [expired] = await getDb()
        .update(paymentOrders)
        .set({ status: 'expired', updatedAt: now })
        .where(and(eq(paymentOrders.id, existing.id), eq(paymentOrders.status, 'pending')))
        .returning();
      return { order: expired ?? { ...existing, status: 'expired' }, newlyCompleted: false };
    }

    return { order: existing, newlyCompleted: false };
  }

  async cancelOrderForUser(orderId: string, telegramId: number): Promise<PaymentOrderRow | null> {
    const now = new Date();
    const [cancelled] = await getDb()
      .update(paymentOrders)
      .set({ status: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(paymentOrders.id, orderId),
          eq(paymentOrders.telegramId, telegramId),
          eq(paymentOrders.status, 'pending')
        )
      )
      .returning();
    return cancelled ?? null;
  }

  async cancelPendingForAppOrdersForUser(telegramId: number): Promise<number> {
    const now = new Date();
    try {
      const cancelled = await getDb()
        .update(paymentOrders)
        .set({ status: 'cancelled', updatedAt: now })
        .where(
          and(
            eq(paymentOrders.telegramId, telegramId),
            eq(paymentOrders.provider, 'forapp_card'),
            eq(paymentOrders.status, 'pending')
          )
        )
        .returning({ id: paymentOrders.id });
      return cancelled.length;
    } catch {
      return 0;
    }
  }

  async expireStaleOrders(now: Date = new Date()): Promise<number> {
    try {
      const expired = await getDb()
        .update(paymentOrders)
        .set({ status: 'expired', updatedAt: now })
        .where(and(eq(paymentOrders.status, 'pending'), lt(paymentOrders.expiresAt, now)))
        .returning({ id: paymentOrders.id });
      return expired.length;
    } catch {
      return 0;
    }
  }

  async listOrdersForUser(
    telegramId: number,
    page = 1,
    pageSize = 10
  ): Promise<{
    orders: PaymentOrderRow[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const safePage = Math.max(1, Math.trunc(page) || 1);
    const safePageSize = Math.max(1, Math.min(Math.trunc(pageSize) || 10, 50));
    const db = getDb();
    const whereClause = eq(paymentOrders.telegramId, telegramId);
    const [[totalRow], orders] = await Promise.all([
      db.select({ value: count() }).from(paymentOrders).where(whereClause),
      db
        .select()
        .from(paymentOrders)
        .where(whereClause)
        .orderBy(desc(paymentOrders.createdAt))
        .limit(safePageSize)
        .offset((safePage - 1) * safePageSize),
    ]);
    const total = dbIntegerToSafeNumber(totalRow?.value ?? 0, 'user_payment_orders_total');
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    return { orders, total, page: Math.min(safePage, totalPages), totalPages };
  }

  // ── Atomic Idempotent Wallet Credit Helper ─────────────────────────────────

  private async creditWalletInTransaction(
    tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
    params: {
      telegramId: number;
      amountToman: number;
      referenceId: string;
      description: string;
      cashbackAmount?: number;
      cashbackReferenceId?: string;
      cashbackDescription?: string;
      actorTelegramId?: number | null;
      auditAction: string;
      auditEntityType: string;
      auditEntityId: string;
      auditMetadata: Record<string, unknown>;
      now: Date;
    }
  ): Promise<{
    walletTransactionId: string;
    balanceAfter: number;
    alreadyProcessed: boolean;
  }> {
    const safeAmount = dbIntegerToSafeNumber(params.amountToman, 'credit_amount_toman');
    if (safeAmount <= 0) {
      throw new AutomatedPaymentError('INVALID_CREDIT_AMOUNT');
    }

    const safeCashback =
      params.cashbackAmount && params.cashbackAmount > 0
        ? dbIntegerToSafeNumber(params.cashbackAmount, 'credit_cashback_toman')
        : 0;

    // Lock wallet row first to serialize concurrent credits/debits.
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.telegramId, params.telegramId))
      .for('update')
      .limit(1);

    if (!user) {
      throw new AutomatedPaymentError('USER_NOT_FOUND');
    }

    // Strict idempotency check by deterministic ledger reference_id.
    const [existingTx] = await tx
      .select({ id: walletTransactions.id, balanceAfter: walletTransactions.balanceAfter })
      .from(walletTransactions)
      .where(eq(walletTransactions.referenceId, params.referenceId))
      .limit(1);

    if (existingTx) {
      return {
        walletTransactionId: existingTx.id,
        balanceAfter: dbIntegerToSafeNumber(user.balance, 'existing_user_balance'),
        alreadyProcessed: true,
      };
    }

    const currentBalance = dbIntegerToSafeNumber(user.balance, 'current_user_balance');
    const balanceAfterTopup = dbIntegerToSafeNumber(
      BigInt(currentBalance) + BigInt(safeAmount),
      'balance_after_topup'
    );
    const finalBalance = dbIntegerToSafeNumber(
      BigInt(balanceAfterTopup) + BigInt(safeCashback),
      'balance_after_cashback'
    );

    const [updatedUser] = await tx
      .update(users)
      .set({ balance: finalBalance, updatedAt: params.now })
      .where(eq(users.telegramId, params.telegramId))
      .returning();

    if (!updatedUser) {
      throw new AutomatedPaymentError('WALLET_UPDATE_FAILED');
    }

    const txId = `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await tx.insert(walletTransactions).values({
      id: txId,
      telegramId: params.telegramId,
      amount: safeAmount,
      balanceAfter: balanceAfterTopup,
      type: 'topup',
      referenceId: params.referenceId,
      description: params.description,
    });

    if (safeCashback > 0 && params.cashbackReferenceId) {
      const cbTxId = `tx_cb_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await tx
        .insert(walletTransactions)
        .values({
          id: cbTxId,
          telegramId: params.telegramId,
          amount: safeCashback,
          balanceAfter: finalBalance,
          type: 'cashback',
          referenceId: params.cashbackReferenceId,
          description: params.cashbackDescription ?? `Gateway cashback (${params.auditEntityId})`,
        })
        .onConflictDoNothing({ target: walletTransactions.referenceId });
    }

    await tx.insert(auditLogs).values({
      id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      actorTelegramId: params.actorTelegramId ?? null,
      action: params.auditAction,
      entityType: params.auditEntityType,
      entityId: params.auditEntityId,
      targetTelegramId: params.telegramId,
      metadata: JSON.stringify({
        ...params.auditMetadata,
        walletTransactionId: txId,
        balanceAfter: finalBalance,
      }),
    });

    return {
      walletTransactionId: txId,
      balanceAfter: finalBalance,
      alreadyProcessed: false,
    };
  }

  /**
   * Attach a temporary Telegram invoice/nudge message ID onto `payment_orders.metadata`
   * so it can be cleanly deleted once the order is confirmed, cancelled, or superseded.
   */
  async attachTelegramMessageId(orderId: string, messageId: number): Promise<void> {
    if (!orderId || !Number.isSafeInteger(messageId) || messageId <= 0) return;
    const now = new Date();
    const db = getDb();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: paymentOrders.id, metadata: paymentOrders.metadata })
        .from(paymentOrders)
        .where(eq(paymentOrders.id, orderId))
        .for('update')
        .limit(1);
      if (!row) return;
      const nextMetadata = mergeOrderMetadata(row.metadata, { addTelegramMessageId: messageId });
      await tx
        .update(paymentOrders)
        .set({ metadata: nextMetadata, updatedAt: now })
        .where(eq(paymentOrders.id, orderId));
    });
  }
}
