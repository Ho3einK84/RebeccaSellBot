import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import {
  computeNowPaymentsSignature,
  type NowPaymentsClient,
} from '../../src/infra/NowPaymentsClient.js';
import type { ExchangeRateClient } from '../../src/infra/ExchangeRateClient.js';
import { PaymentService } from '../../src/domain/services/PaymentService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import {
  AutomatedPaymentError,
  AutomatedPaymentService,
  timingSafeSecretEqual,
} from '../../src/domain/services/AutomatedPaymentService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('AutomatedPaymentService', () => {
  const getDbMock = vi.mocked(getDb);
  let settings: Record<string, string>;
  let translationService: TranslationService;
  let paymentService: PaymentService;
  let nowPaymentsClient: {
    createInvoice: ReturnType<typeof vi.fn>;
    getPaymentStatus: ReturnType<typeof vi.fn>;
    getApiStatus: ReturnType<typeof vi.fn>;
  };
  let exchangeRateClient: {
    fetchUsdTomanRate: ReturnType<typeof vi.fn>;
  };
  let walletService: { invalidateUserCache: ReturnType<typeof vi.fn> };
  let service: AutomatedPaymentService;

  beforeEach(() => {
    vi.clearAllMocks();
    settings = {
      card_number: '6037997900000001',
      card_holder: 'Ali Test',
      topup_min_amount: '10000',
      topup_max_amount: '10000000',
      unique_topup_amount_enabled: 'true',
      webapp_url: 'https://bot.example.com',
      forapp_enabled: 'false',
      forapp_order_expiry_minutes: '20',
      nowpayments_enabled: 'false',
      nowpayments_sandbox: 'false',
      nowpayments_rate_mode: 'manual',
      nowpayments_usd_rate_toman: '80000',
      nowpayments_min_amount_toman: '100000',
      nowpayments_max_amount_toman: '50000000',
      nowpayments_cashback_percent: '0',
      nowpayments_order_expiry_minutes: '60',
    };

    translationService = {
      getSetting: vi.fn((key: string, def?: string) => settings[key] ?? def ?? ''),
      getSettingBool: vi.fn((key: string, def = false) => {
        const val = settings[key];
        if (val === undefined) return def;
        return val === 'true' || val === '1';
      }),
      getSettingNum: vi.fn((key: string, def?: number) => {
        const val = settings[key];
        return val !== undefined ? Number(val) : (def ?? 0);
      }),
      get: vi.fn((key: string) => key),
      updateSettings: vi.fn(async (pairs: Record<string, string>) => {
        Object.assign(settings, pairs);
      }),
      updateSetting: vi.fn(async (key: string, value: string) => {
        settings[key] = value;
      }),
    } as unknown as TranslationService;

    paymentService = new PaymentService(translationService);
    nowPaymentsClient = {
      createInvoice: vi.fn(),
      getPaymentStatus: vi.fn(),
      getApiStatus: vi.fn(),
    };
    exchangeRateClient = {
      fetchUsdTomanRate: vi.fn(),
    };
    walletService = {
      invalidateUserCache: vi.fn(),
    };

    service = new AutomatedPaymentService({
      translationService,
      paymentService,
      walletService,
      credentialSecret: 'unit_test_master_secret_key_32bytes!!',
      nowPaymentsClient: nowPaymentsClient as unknown as NowPaymentsClient,
      exchangeRateClient: exchangeRateClient as unknown as ExchangeRateClient,
    });
  });

  it('encrypts secrets at rest via AES-256-GCM and compares secrets with timingSafeSecretEqual', async () => {
    expect(timingSafeSecretEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeSecretEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeSecretEqual('abc', 'abcdef')).toBe(false);
    expect(timingSafeSecretEqual('', 'abc')).toBe(false);

    const mock = createMockDb({ selectResults: [[{ value: 0 }]] });
    getDbMock.mockReturnValue(mock.db as never);

    const rotated = await service.rotateForAppApiKey();
    expect(rotated.apiKey).toMatch(/^fa_/u);
    expect(rotated.webhookUrl).toBe('https://bot.example.com/api/webhooks/forapp');
    // Stored value must be encrypted, never plaintext!
    expect(settings.forapp_api_key_encrypted).toBeTruthy();
    expect(settings.forapp_api_key_encrypted).not.toContain(rotated.apiKey);
    expect(service.verifyForAppApiKey(rotated.apiKey)).toBe(true);
    expect(service.verifyForAppApiKey('fa_wrong_key')).toBe(false);

    await service.updateNowPaymentsConfig({
      apiKey: 'NP_LIVE_SECRET_API_KEY_999',
      ipnSecret: 'NP_IPN_HMAC_SECRET_888',
      cashbackPercent: 5,
    });
    expect(settings.nowpayments_api_key_encrypted).not.toContain('NP_LIVE_SECRET_API_KEY_999');
    expect(settings.nowpayments_ipn_secret_encrypted).not.toContain('NP_IPN_HMAC_SECRET_888');
  });

  it('creates ForApp automated orders with unique Toman & exact Rial amounts', async () => {
    const rotated = await service.rotateForAppApiKey();
    expect(rotated.apiKey).toBeTruthy();
    settings.forapp_enabled = 'true';

    const mock = createMockDb({
      selectResults: [
        [], // getTodayCardUsageMap receipts
        [], // getTodayCardUsageMap orders
        [], // loadRecentPendingReceiptAmounts receipts
        [], // loadRecentPendingReceiptAmounts orders
      ],
      returningResults: [
        [], // expireStaleOrders
        [], // cancelPendingForAppOrdersForUser
        [
          {
            id: 'po_100_abcd',
            telegramId: 55555,
            provider: 'forapp_card',
            status: 'pending',
            requestedAmount: 100_000,
            payableAmount: 99_877,
            payableAmountRial: 998_770,
            cashbackAmount: 0,
            cardId: 'legacy_default',
            cardNumber: '6037997900000001',
            cardHolder: 'Ali Test',
            bankName: 'ملی',
            expiresAt: new Date(Date.now() + 20 * 60_000),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ],
    });
    getDbMock.mockReturnValue(mock.db as never);

    const order = await service.createForAppOrder({
      telegramId: 55555,
      requestedAmount: 100_000,
      locale: 'fa',
    });

    expect(order.provider).toBe('forapp_card');
    expect(order.payableAmountRial).toBe(order.payableAmount * 10);
    const insertedOrder = mock.state.insertCalls[0]?.values as Record<string, unknown>;
    expect(insertedOrder.payableAmountRial).toBe(Number(insertedOrder.payableAmount) * 10);
  });

  it('handles ForApp webhook auth, test ping, duplicate idempotency, non-deposit, and non-multiple-of-10 Rial', async () => {
    const { apiKey } = await service.rotateForAppApiKey();
    settings.forapp_enabled = 'true';

    // 1. Invalid X-API-Key -> 401
    const unauth = await service.processForAppWebhook({
      apiKeyHeader: 'wrong-key',
      idempotencyKeyHeader: 'msg-1',
      body: { id: 'msg-1', amount: 1_000_000, unit: 'rial', is_deposit: true },
    });
    expect(unauth).toEqual({ statusCode: 401, outcome: 'unauthorized' });

    // 2. ForApp sample test payload ("test": true) -> 200 OK without DB writes or wallet credit
    const testMock = createMockDb();
    getDbMock.mockReturnValue(testMock.db as never);
    const testRes = await service.processForAppWebhook({
      apiKeyHeader: apiKey,
      idempotencyKeyHeader: 'test-uuid-123',
      body: {
        id: 'test-uuid-123',
        test: true,
        amount: 1000123,
        unit: 'rial',
        is_deposit: true,
      },
    });
    expect(testRes).toMatchObject({ statusCode: 200, outcome: 'test_ok', enabled: true });
    expect(testMock.state.insertCalls).toHaveLength(0);

    // 3. Duplicate Idempotency-Key -> 200 duplicate without crediting
    const dupMock = createMockDb({ returningResults: [[]] });
    getDbMock.mockReturnValue(dupMock.db as never);
    const dupRes = await service.processForAppWebhook({
      apiKeyHeader: apiKey,
      idempotencyKeyHeader: 'msg-dup-1',
      body: { id: 'msg-dup-1', amount: 999_000, unit: 'rial', is_deposit: true },
    });
    expect(dupRes).toMatchObject({ statusCode: 200, outcome: 'duplicate' });

    // 4. Withdrawal SMS (is_deposit: false) -> 200 ignored
    const ignMock = createMockDb({
      returningResults: [
        [{ id: 'fad_1', status: 'unmatched', amountRial: 500_000, amountToman: 50_000 }],
        [{ id: 'fad_1', status: 'ignored', note: 'not_deposit' }],
      ],
    });
    getDbMock.mockReturnValue(ignMock.db as never);
    const ignRes = await service.processForAppWebhook({
      apiKeyHeader: apiKey,
      idempotencyKeyHeader: 'msg-withdraw-1',
      body: { id: 'msg-withdraw-1', amount: 500_000, unit: 'rial', is_deposit: false },
    });
    expect(ignRes).toMatchObject({ statusCode: 200, outcome: 'ignored' });

    // 5. Rial not multiple of 10 -> 200 unmatched (no rounding error credit)
    const oddRialMock = createMockDb({
      returningResults: [
        [{ id: 'fad_2', status: 'unmatched', amountRial: 1_000_123, amountToman: null }],
        [{ id: 'fad_2', status: 'unmatched', note: 'rial_not_multiple_of_10' }],
      ],
    });
    getDbMock.mockReturnValue(oddRialMock.db as never);
    const oddRes = await service.processForAppWebhook({
      apiKeyHeader: apiKey,
      idempotencyKeyHeader: 'msg-odd-1',
      body: { id: 'msg-odd-1', amount: 1_000_123, unit: 'rial', is_deposit: true },
    });
    expect(oddRes).toMatchObject({ statusCode: 200, outcome: 'unmatched' });
    expect(oddRes.deposit?.note).toBe('rial_not_multiple_of_10');
  });

  it('atomically matches unexpired ForApp order with FOR UPDATE and credits wallet', async () => {
    const { apiKey } = await service.rotateForAppApiKey();
    settings.forapp_enabled = 'true';
    const now = new Date('2026-11-22T20:00:00Z');
    const pendingOrder = {
      id: 'po_match_1',
      telegramId: 55555,
      provider: 'forapp_card',
      status: 'pending',
      requestedAmount: 100_000,
      payableAmount: 99_850,
      payableAmountRial: 998_500,
      cardId: 'card_1',
      bankName: 'ملی',
      expiresAt: new Date('2026-11-22T20:20:00Z'),
      createdAt: new Date('2026-11-22T19:55:00Z'),
    };

    const mock = createMockDb({
      selectResults: [
        [pendingOrder], // FOR UPDATE order match
        [{ telegramId: 55555, balance: 20_000 }], // FOR UPDATE user balance
        [], // idempotency check in wallet_transactions
      ],
      returningResults: [
        [{ id: 'fad_match_1', amountRial: 998_500, amountToman: 99_850, status: 'unmatched' }], // insert deposit
        [{ balance: 119_850 }], // update user balance
        [{ ...pendingOrder, status: 'completed', creditedAmount: 99_850 }], // complete order
        [{ id: 'fad_match_1', status: 'matched', matchedOrderId: 'po_match_1' }], // update deposit
      ],
    });
    getDbMock.mockReturnValue(mock.db as never);

    const res = await service.processForAppWebhook({
      apiKeyHeader: apiKey,
      idempotencyKeyHeader: 'sms-unique-99850',
      body: {
        id: 'sms-unique-99850',
        amount: 998_500,
        unit: 'rial',
        is_deposit: true,
        bank: 'ملی',
      },
      now,
    });

    expect(res.statusCode).toBe(200);
    expect(res.outcome).toBe('matched');
    expect(res.creditedAmount).toBe(99_850);
    expect(res.balanceAfter).toBe(119_850);
    expect(mock.state.selectCalls[0]?.lock).toBe('update');
    expect(walletService.invalidateUserCache).toHaveBeenCalledWith(55555);
  });

  it('stores unmatched ForApp deposit when no unexpired order matches and supports admin manual match', async () => {
    const { apiKey } = await service.rotateForAppApiKey();
    settings.forapp_enabled = 'true';

    // No pending order -> unmatched
    const unmatchedMock = createMockDb({
      selectResults: [[]],
      returningResults: [
        [{ id: 'fad_u1', amountRial: 500_000, amountToman: 50_000, status: 'unmatched' }],
        [{ id: 'fad_u1', status: 'unmatched', note: 'no_matching_pending_order' }],
      ],
    });
    getDbMock.mockReturnValue(unmatchedMock.db as never);

    const unmatchedRes = await service.processForAppWebhook({
      apiKeyHeader: apiKey,
      idempotencyKeyHeader: 'sms-expired-order',
      body: { id: 'sms-expired-order', amount: 500_000, unit: 'rial', is_deposit: true },
    });
    expect(unmatchedRes.outcome).toBe('unmatched');

    // Admin manually matches the unmatched deposit
    const manualMock = createMockDb({
      selectResults: [
        [
          {
            id: 'fad_u1',
            amountRial: 500_000,
            amountToman: 50_000,
            status: 'unmatched',
            note: null,
          },
        ],
        [{ telegramId: 77777, balance: 10_000 }], // user FOR UPDATE
        [], // no prior wallet tx
      ],
      returningResults: [
        [{ balance: 60_000 }],
        [{ id: 'fad_u1', status: 'manual_matched', matchedTelegramId: 77777 }],
      ],
    });
    getDbMock.mockReturnValue(manualMock.db as never);

    const matched = await service.manualMatchForAppDeposit({
      depositId: 'fad_u1',
      targetTelegramId: 77777,
      adminId: 12345,
    });
    expect(matched.creditedAmount).toBe(50_000);
    expect(matched.balanceAfter).toBe(60_000);
    expect(walletService.invalidateUserCache).toHaveBeenCalledWith(77777);
  });

  it('resolves NOWPayments USD rate (manual, auto, fallback) and creates invoice', async () => {
    await service.updateNowPaymentsConfig({
      enabled: true,
      apiKey: 'np_test_key_abcdefgh',
      ipnSecret: 'np_ipn_secret_12345678',
      rateMode: 'auto',
      manualUsdRateToman: 80_000,
      cashbackPercent: 5,
    });

    // Auto live rate succeeds
    exchangeRateClient.fetchUsdTomanRate.mockResolvedValueOnce({
      rateToman: 90_000,
      provider: 'nobitex',
      fetchedAt: new Date(),
    });
    const autoRate = await service.resolveUsdToTomanRate();
    expect(autoRate).toMatchObject({ rateToman: 90_000, source: 'auto' });

    // Auto fails -> falls back safely to manualUsdRateToman (80,000)
    exchangeRateClient.fetchUsdTomanRate.mockResolvedValueOnce(null);
    nowPaymentsClient.createInvoice.mockResolvedValueOnce({
      id: 'inv_999',
      invoiceUrl: 'https://nowpayments.io/payment/?iid=inv_999',
      orderId: 'po_np_1',
      priceAmount: 10,
      priceCurrency: 'usd',
    });

    const mock = createMockDb({
      returningResults: [
        [
          {
            id: 'po_np_1',
            telegramId: 55555,
            provider: 'nowpayments',
            status: 'pending',
            requestedAmount: 800_000,
            payableAmount: 800_000,
            cashbackAmount: 0,
            externalId: 'inv_999',
            paymentUrl: 'https://nowpayments.io/payment/?iid=inv_999',
            fiatAmountUsd: '10.00',
            exchangeRateTomanPerUsd: 80_000,
            expiresAt: new Date(Date.now() + 3600_000),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ],
    });
    getDbMock.mockReturnValue(mock.db as never);

    const order = await service.createNowPaymentsOrder({
      telegramId: 55555,
      amountToman: 800_000,
    });
    expect(order.externalId).toBe('inv_999');
    expect(nowPaymentsClient.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        priceAmount: 10,
        priceCurrency: 'usd',
        ipnCallbackUrl: 'https://bot.example.com/api/webhooks/nowpayments',
      })
    );

    // Below min amount throws AutomatedPaymentError
    await expect(
      service.createNowPaymentsOrder({ telegramId: 55555, amountToman: 5_000 })
    ).rejects.toBeInstanceOf(AutomatedPaymentError);
  });

  it('enforces NOWPayments HMAC-SHA512 signature, double-check API verification, cashback, and idempotency', async () => {
    const ipnSecret = 'np_ipn_secret_super_secure_999';
    await service.updateNowPaymentsConfig({
      enabled: true,
      apiKey: 'np_api_key_super_secure_999',
      ipnSecret,
      cashbackPercent: 10,
    });

    const ipnPayload = {
      payment_id: 555666777,
      invoice_id: 'inv_999',
      order_id: 'po_np_1',
      payment_status: 'finished',
      pay_currency: 'usdttrc20',
      pay_amount: 10,
      actually_paid: 10,
    };

    // 1. Invalid signature -> 401, never calls NOWPayments GET /v1/payment
    const badSigRes = await service.processNowPaymentsIpn({
      payload: ipnPayload,
      signatureHeader: '0000000000000000',
    });
    expect(badSigRes).toEqual({ statusCode: 401, outcome: 'invalid_signature' });
    expect(nowPaymentsClient.getPaymentStatus).not.toHaveBeenCalled();

    const validSig = computeNowPaymentsSignature(ipnPayload, ipnSecret);

    // 2. Spoofed IPN says finished, but double-check API returns confirming -> NO wallet credit!
    nowPaymentsClient.getPaymentStatus.mockResolvedValueOnce({
      paymentId: '555666777',
      invoiceId: 'inv_999',
      orderId: 'po_np_1',
      paymentStatus: 'confirming',
      payCurrency: 'usdttrc20',
      payAmount: '10',
      actuallyPaid: '10',
    });
    const pendingOrder = {
      id: 'po_np_1',
      telegramId: 55555,
      provider: 'nowpayments',
      status: 'pending',
      requestedAmount: 800_000,
      payableAmount: 800_000,
      cashbackAmount: 0,
      metadata: JSON.stringify({ cashbackPercent: 10 }),
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const confirmingMock = createMockDb({
      selectResults: [[pendingOrder], [pendingOrder]],
      returningResults: [[{ ...pendingOrder, status: 'confirming' }]],
    });
    getDbMock.mockReturnValue(confirmingMock.db as never);

    const confirmingRes = await service.processNowPaymentsIpn({
      payload: ipnPayload,
      signatureHeader: validSig,
    });
    expect(confirmingRes.outcome).toBe('in_progress');
    expect(confirmingRes.creditedAmount).toBeUndefined();

    // 3. Verified finished via double-check -> atomic wallet credit (800,000) + 10% cashback (80,000)
    nowPaymentsClient.getPaymentStatus.mockResolvedValueOnce({
      paymentId: '555666777',
      invoiceId: 'inv_999',
      orderId: 'po_np_1',
      paymentStatus: 'finished',
      payCurrency: 'usdttrc20',
      payAmount: '10',
      actuallyPaid: '10',
    });
    const finishedMock = createMockDb({
      selectResults: [
        [pendingOrder], // findNowPaymentsOrder
        [pendingOrder], // FOR UPDATE lock
        [{ telegramId: 55555, balance: 50_000 }], // user FOR UPDATE
        [], // wallet_transactions reference check
      ],
      returningResults: [
        [{ balance: 930_000 }], // 50k + 800k + 80k cashback
        [
          {
            ...pendingOrder,
            status: 'completed',
            creditedAmount: 800_000,
            cashbackAmount: 80_000,
          },
        ],
      ],
    });
    getDbMock.mockReturnValue(finishedMock.db as never);

    const finishedRes = await service.processNowPaymentsIpn({
      payload: ipnPayload,
      signatureHeader: validSig,
    });
    expect(finishedRes.statusCode).toBe(200);
    expect(finishedRes.outcome).toBe('completed');
    expect(finishedRes.creditedAmount).toBe(800_000);
    expect(finishedRes.cashbackAmount).toBe(80_000);
    expect(finishedRes.balanceAfter).toBe(930_000);
    expect(finishedRes.newlyCompleted).toBe(true);

    // 4. Duplicate IPN on already completed order -> idempotent already_completed (no second credit)
    nowPaymentsClient.getPaymentStatus.mockResolvedValueOnce({
      paymentId: '555666777',
      invoiceId: 'inv_999',
      orderId: 'po_np_1',
      paymentStatus: 'finished',
    });
    const completedOrder = {
      ...pendingOrder,
      status: 'completed',
      creditedAmount: 800_000,
      cashbackAmount: 80_000,
    };
    const replayMock = createMockDb({
      selectResults: [[completedOrder], [completedOrder]],
    });
    getDbMock.mockReturnValue(replayMock.db as never);
    const replayRes = await service.processNowPaymentsIpn({
      payload: ipnPayload,
      signatureHeader: validSig,
    });
    expect(replayRes.outcome).toBe('already_completed');
    expect(replayRes.newlyCompleted).toBe(false);
    expect(replayMock.state.insertCalls).toHaveLength(0);

    // 5. partially_paid -> updates status & audit log without crediting
    nowPaymentsClient.getPaymentStatus.mockResolvedValueOnce({
      paymentId: '555666777',
      invoiceId: 'inv_999',
      orderId: 'po_np_1',
      paymentStatus: 'partially_paid',
      payCurrency: 'usdttrc20',
      payAmount: '10',
      actuallyPaid: '6.5',
    });
    const partialMock = createMockDb({
      selectResults: [[pendingOrder], [pendingOrder]],
      returningResults: [[{ ...pendingOrder, status: 'partially_paid' }]],
    });
    getDbMock.mockReturnValue(partialMock.db as never);
    const partialRes = await service.processNowPaymentsIpn({
      payload: ipnPayload,
      signatureHeader: validSig,
    });
    expect(partialRes.outcome).toBe('partially_paid');
    expect(partialRes.creditedAmount).toBeUndefined();
  });
});
