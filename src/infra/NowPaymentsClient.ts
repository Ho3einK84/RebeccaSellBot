/**
 * NOWPayments REST API & IPN Cryptographic Verification Client (Infrastructure Layer).
 *
 * Official contracts:
 *  - Base URLs:
 *      Production: https://api.nowpayments.io
 *      Sandbox:    https://api-sandbox.nowpayments.io
 *  - Create Invoice: POST /v1/invoice (header: x-api-key)
 *  - Payment Status: GET  /v1/payment/{payment_id} (header: x-api-key)
 *  - API Status:     GET  /v1/status
 *  - IPN Signature:  x-nowpayments-sig = HMAC-SHA512(JSON.stringify(sortKeysRecursively(payload)), ipnSecret)
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import { logger } from './logger.js';

export const NOWPAYMENTS_PROD_BASE_URL = 'https://api.nowpayments.io';
export const NOWPAYMENTS_SANDBOX_BASE_URL = 'https://api-sandbox.nowpayments.io';

export const NOWPAYMENTS_PAYMENT_STATUSES = [
  'waiting',
  'confirming',
  'confirmed',
  'sending',
  'partially_paid',
  'finished',
  'failed',
  'refunded',
  'expired',
] as const;

export type NowPaymentsPaymentStatus = (typeof NOWPAYMENTS_PAYMENT_STATUSES)[number];

export class NowPaymentsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly responseMessage?: string
  ) {
    super(
      responseMessage
        ? `NOWPayments API [${status}] ${endpoint}: ${responseMessage}`
        : `NOWPayments API [${status}] ${endpoint}`
    );
    this.name = 'NowPaymentsApiError';
  }
}

const invoiceResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  order_id: z.string().nullable().optional(),
  order_description: z.string().nullable().optional(),
  price_amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
  price_currency: z.string(),
  pay_currency: z.string().nullable().optional(),
  invoice_url: z.string().url(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

const paymentStatusResponseSchema = z.object({
  payment_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  invoice_id: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined ? null : String(v))),
  payment_status: z.string(),
  pay_address: z.string().nullable().optional(),
  price_amount: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  price_currency: z.string(),
  pay_amount: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined ? null : String(v))),
  actually_paid: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined ? null : String(v))),
  pay_currency: z.string().nullable().optional(),
  order_id: z.string().nullable().optional(),
  order_description: z.string().nullable().optional(),
  outcome_amount: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined ? null : String(v))),
  outcome_currency: z.string().nullable().optional(),
});

const statusResponseSchema = z.object({
  message: z.string().optional(),
});

export interface CreateNowPaymentsInvoiceParams {
  apiKey: string;
  sandbox?: boolean;
  priceAmount: number;
  priceCurrency?: string;
  payCurrency?: string;
  orderId: string;
  orderDescription?: string;
  ipnCallbackUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface NowPaymentsInvoiceResult {
  id: string;
  invoiceUrl: string;
  orderId: string | null;
  priceAmount: string;
  priceCurrency: string;
  payCurrency: string | null;
}

export interface NowPaymentsPaymentDetail {
  paymentId: string;
  invoiceId: string | null;
  orderId: string | null;
  paymentStatus: string;
  priceAmount: number;
  priceCurrency: string;
  payCurrency: string | null;
  payAmount: string | null;
  actuallyPaid: string | null;
  outcomeAmount: string | null;
  outcomeCurrency: string | null;
}

/**
 * Recursively sort plain JSON object keys alphabetically as required by
 * NOWPayments' official IPN HMAC-SHA512 canonicalization specification.
 */
export function sortJsonKeysRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonKeysRecursively(item));
  }
  if (value !== null && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      sorted[key] = sortJsonKeysRecursively(input[key]);
    }
    return sorted;
  }
  return value;
}

/** Compute the expected lowercase hex HMAC-SHA512 signature for a NOWPayments IPN payload. */
export function computeNowPaymentsSignature(
  payload: Record<string, unknown>,
  ipnSecret: string
): string {
  const canonicalJson = JSON.stringify(sortJsonKeysRecursively(payload));
  return crypto.createHmac('sha512', ipnSecret).update(canonicalJson, 'utf8').digest('hex');
}

/**
 * Verify NOWPayments `x-nowpayments-sig` header using timing-safe comparison.
 * Fails closed when secret, header, or payload object is missing or malformed.
 */
export function verifyNowPaymentsSignature(
  payload: unknown,
  signatureHeader: string | string[] | undefined,
  ipnSecret: string | undefined
): boolean {
  if (!ipnSecret || !ipnSecret.trim()) return false;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;

  const rawSig = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (typeof rawSig !== 'string') return false;
  const normalizedSig = rawSig.trim().toLowerCase();
  if (!/^[0-9a-f]{128}$/u.test(normalizedSig)) return false;

  const expected = computeNowPaymentsSignature(
    payload as Record<string, unknown>,
    ipnSecret.trim()
  ).toLowerCase();

  const receivedBuf = Buffer.from(normalizedSig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (receivedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(receivedBuf, expectedBuf);
}

export class NowPaymentsClient {
  private readonly timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private resolveBaseUrl(sandbox?: boolean): string {
    return sandbox ? NOWPAYMENTS_SANDBOX_BASE_URL : NOWPAYMENTS_PROD_BASE_URL;
  }

  async getApiStatus(sandbox = false): Promise<{ ok: boolean; message: string }> {
    const endpoint = '/v1/status';
    const url = `${this.resolveBaseUrl(sandbox)}${endpoint}`;
    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new NowPaymentsApiError(response.status, endpoint, extractErrorMessage(text));
    }
    const parsed = statusResponseSchema.safeParse(safeJsonParse(text));
    const message = parsed.success && parsed.data.message ? parsed.data.message : 'OK';
    return { ok: true, message };
  }

  async createInvoice(params: CreateNowPaymentsInvoiceParams): Promise<NowPaymentsInvoiceResult> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) {
      throw new Error('NOWPAYMENTS_API_KEY_MISSING');
    }

    const endpoint = '/v1/invoice';
    const url = `${this.resolveBaseUrl(params.sandbox)}${endpoint}`;
    const body: Record<string, unknown> = {
      price_amount: params.priceAmount,
      price_currency: (params.priceCurrency ?? 'usd').toLowerCase(),
      order_id: params.orderId,
      ...(params.payCurrency ? { pay_currency: params.payCurrency.toLowerCase() } : {}),
      ...(params.orderDescription ? { order_description: params.orderDescription } : {}),
      ...(params.ipnCallbackUrl ? { ipn_callback_url: params.ipnCallbackUrl } : {}),
      ...(params.successUrl ? { success_url: params.successUrl } : {}),
      ...(params.cancelUrl ? { cancel_url: params.cancelUrl } : {}),
    };

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      logger.warn(
        { status: response.status, endpoint, sandbox: Boolean(params.sandbox) },
        'NOWPayments createInvoice returned non-OK HTTP status'
      );
      throw new NowPaymentsApiError(response.status, endpoint, extractErrorMessage(text));
    }

    const parsed = invoiceResponseSchema.safeParse(safeJsonParse(text));
    if (!parsed.success) {
      throw new NowPaymentsApiError(response.status, endpoint, 'Invalid invoice response payload');
    }

    return {
      id: parsed.data.id,
      invoiceUrl: parsed.data.invoice_url,
      orderId: parsed.data.order_id ?? params.orderId,
      priceAmount: parsed.data.price_amount,
      priceCurrency: parsed.data.price_currency,
      payCurrency: parsed.data.pay_currency ?? null,
    };
  }

  async getPaymentStatus(
    paymentId: string,
    apiKey: string,
    sandbox = false
  ): Promise<NowPaymentsPaymentDetail> {
    const cleanId = paymentId.trim();
    const cleanKey = apiKey.trim();
    if (!cleanId) throw new Error('NOWPAYMENTS_PAYMENT_ID_MISSING');
    if (!cleanKey) throw new Error('NOWPAYMENTS_API_KEY_MISSING');

    const endpoint = `/v1/payment/${encodeURIComponent(cleanId)}`;
    const url = `${this.resolveBaseUrl(sandbox)}${endpoint}`;

    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-api-key': cleanKey,
      },
    });

    const text = await response.text();
    if (!response.ok) {
      logger.warn(
        { status: response.status, endpoint, sandbox },
        'NOWPayments getPaymentStatus returned non-OK HTTP status'
      );
      throw new NowPaymentsApiError(response.status, endpoint, extractErrorMessage(text));
    }

    const parsed = paymentStatusResponseSchema.safeParse(safeJsonParse(text));
    if (!parsed.success) {
      throw new NowPaymentsApiError(
        response.status,
        endpoint,
        'Invalid payment status response payload'
      );
    }

    return {
      paymentId: parsed.data.payment_id,
      invoiceId: parsed.data.invoice_id,
      orderId: parsed.data.order_id ?? null,
      paymentStatus: parsed.data.payment_status.trim().toLowerCase(),
      priceAmount: parsed.data.price_amount,
      priceCurrency: parsed.data.price_currency,
      payCurrency: parsed.data.pay_currency ?? null,
      payAmount: parsed.data.pay_amount,
      actuallyPaid: parsed.data.actually_paid,
      outcomeAmount: parsed.data.outcome_amount,
      outcomeCurrency: parsed.data.outcome_currency ?? null,
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractErrorMessage(raw: string): string | undefined {
  const parsed = safeJsonParse(raw);
  if (parsed && typeof parsed === 'object') {
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.message === 'string' && rec.message.trim()) {
      return rec.message.trim().slice(0, 200);
    }
    if (typeof rec.error === 'string' && rec.error.trim()) {
      return rec.error.trim().slice(0, 200);
    }
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}
