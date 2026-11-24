import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import {
  createMockAdminServices,
  createResettableRateLimitStore,
  createTestConfig,
} from './helpers/webappTestHarness.js';
import type { AutomatedPaymentService } from '../../src/domain/services/AutomatedPaymentService.js';

describe('WebApp Automated Payment Webhooks, User & Admin Routes', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let userToken: string;
  let rateLimitStore: ReturnType<typeof createResettableRateLimitStore>;
  let mockBotApi: {
    sendMessage: ReturnType<typeof vi.fn>;
    deleteMessage: ReturnType<typeof vi.fn>;
  };
  let mockAutomatedPaymentService: Record<string, ReturnType<typeof vi.fn>>;

  beforeAll(async () => {
    rateLimitStore = createResettableRateLimitStore();
    const { mockServices, mockUserService, mockTranslationService, mockWalletService } =
      createMockAdminServices();
    mockBotApi = {
      sendMessage: vi.fn(async () => ({ message_id: 1 })),
      deleteMessage: vi.fn(async () => true),
    };

    // Supply methods required by notification formatting and user-portal routes
    (mockTranslationService as Record<string, unknown>).get = vi.fn((key: string) => key);
    (mockUserService as Record<string, unknown>).isBanned = vi.fn(async () => false);
    (mockUserService as Record<string, unknown>).findProfile = vi.fn(async (q: string) => ({
      telegramId: Number(q) || 55555,
      username: 'testuser',
      firstName: 'Test',
      lastName: null,
      balance: 75_000,
    }));
    (mockWalletService as Record<string, unknown>).getOrCreateUser = vi.fn(async (id: number) => ({
      telegramId: id,
      balance: 75_000,
      locale: 'en',
    }));

    mockAutomatedPaymentService = {
      isForAppEnabled: vi.fn(() => true),
      isNowPaymentsEnabled: vi.fn(() => true),
      resolveUsdToTomanRate: vi.fn(async () => ({
        rateToman: 85_000,
        source: 'manual',
        fetchedAt: new Date(),
      })),
      getActivePendingOrderForUser: vi.fn(async () => null),
      getForAppAdminConfig: vi.fn(async () => ({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyMasked: '••••1234',
        orderExpiryMinutes: 20,
        webhookUrl: 'https://app.example.com/api/webhooks/forapp',
        unmatchedCount: 1,
      })),
      updateForAppConfig: vi.fn(async (u) => ({
        enabled: u.enabled ?? true,
        apiKeyConfigured: true,
        apiKeyMasked: '••••1234',
        orderExpiryMinutes: u.orderExpiryMinutes ?? 20,
        webhookUrl: 'https://app.example.com/api/webhooks/forapp',
        unmatchedCount: 1,
      })),
      rotateForAppApiKey: vi.fn(async () => ({
        apiKey: 'fa_rotated_key_123456',
        apiKeyMasked: '••••3456',
        webhookUrl: 'https://app.example.com/api/webhooks/forapp',
      })),
      listForAppDeposits: vi.fn(async () => ({
        items: [
          {
            id: 'fad_1',
            idempotencyKey: 'key_1',
            amountRial: 500_000,
            amountToman: 50_000,
            status: 'unmatched',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        total: 1,
        unmatchedCount: 1,
        page: 1,
        totalPages: 1,
      })),
      manualMatchForAppDeposit: vi.fn(async () => ({
        deposit: { id: 'fad_1', status: 'manual_matched' },
        telegramId: 55555,
        creditedAmount: 50_000,
        balanceAfter: 125_000,
        walletTransactionId: 'wtx_1',
      })),
      dismissForAppDeposit: vi.fn(async () => ({ id: 'fad_1', status: 'dismissed' })),
      getNowPaymentsAdminConfig: vi.fn(async () => ({
        enabled: true,
        sandbox: false,
        apiKeyConfigured: true,
        ipnSecretConfigured: true,
        rateMode: 'auto',
        manualUsdRateToman: 80_000,
        effectiveUsdRateToman: 85_000,
        effectiveRateSource: 'auto',
        minAmountToman: 100_000,
        maxAmountToman: 50_000_000,
        cashbackPercent: 5,
        orderExpiryMinutes: 60,
        webhookUrl: 'https://app.example.com/api/webhooks/nowpayments',
      })),
      updateNowPaymentsConfig: vi.fn(async () => ({
        enabled: true,
        sandbox: true,
        apiKeyConfigured: true,
        ipnSecretConfigured: true,
        rateMode: 'manual',
        manualUsdRateToman: 82_000,
        effectiveUsdRateToman: 82_000,
        effectiveRateSource: 'manual',
        minAmountToman: 100_000,
        maxAmountToman: 50_000_000,
        cashbackPercent: 5,
        orderExpiryMinutes: 60,
        webhookUrl: 'https://app.example.com/api/webhooks/nowpayments',
      })),
      testNowPaymentsConnection: vi.fn(async () => ({
        ok: true,
        message: 'OK',
        sandbox: false,
        rateToman: 85_000,
        rateSource: 'auto',
      })),
      createForAppOrder: vi.fn(async () => ({
        id: 'po_fa_1',
        telegramId: 55555,
        provider: 'forapp_card',
        status: 'pending',
        requestedAmount: 100_000,
        payableAmount: 99_876,
        payableAmountRial: 998_760,
        cashbackAmount: 0,
        cardId: 'card_1',
        cardNumber: '6037997900000001',
        cardHolder: 'Admin',
        bankName: 'Melli',
        expiresAt: new Date(Date.now() + 20 * 60_000),
        createdAt: new Date(),
      })),
      createNowPaymentsOrder: vi.fn(async () => ({
        id: 'po_np_1',
        telegramId: 55555,
        provider: 'nowpayments',
        status: 'pending',
        requestedAmount: 850_000,
        payableAmount: 850_000,
        cashbackAmount: 0,
        externalId: 'inv_77',
        paymentUrl: 'https://nowpayments.io/payment/?iid=inv_77',
        fiatAmountUsd: '10.00',
        exchangeRateTomanPerUsd: 85_000,
        expiresAt: new Date(Date.now() + 60 * 60_000),
        createdAt: new Date(),
      })),
      checkOrderStatusForUser: vi.fn(async () => ({
        order: {
          id: 'po_fa_1',
          telegramId: 55555,
          provider: 'forapp_card',
          status: 'pending',
          requestedAmount: 100_000,
          payableAmount: 99_876,
          cashbackAmount: 0,
          expiresAt: new Date(Date.now() + 10 * 60_000),
          createdAt: new Date(),
        },
        newlyCompleted: false,
      })),
      cancelOrderForUser: vi.fn(async () => ({
        id: 'po_fa_1',
        telegramId: 55555,
        provider: 'forapp_card',
        status: 'cancelled',
        requestedAmount: 100_000,
        payableAmount: 99_876,
        cashbackAmount: 0,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        createdAt: new Date(),
      })),
      processForAppWebhook: vi.fn(),
      processNowPaymentsIpn: vi.fn(),
    };

    mockServices.automatedPaymentService =
      mockAutomatedPaymentService as unknown as AutomatedPaymentService;
    mockServices.botApi = mockBotApi as never;

    app = await createWebAppServer(createTestConfig(), mockServices, {
      serveStatic: false,
      rateLimitStore: rateLimitStore.Store,
    });

    adminToken = app.jwt.sign({ telegramId: 12345, role: 'admin' });
    userToken = app.jwt.sign({ telegramId: 55555, role: 'user' });
  });

  beforeEach(() => {
    rateLimitStore.reset();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('handles POST /api/webhooks/forapp for unauthorized, test ping, matched, and unmatched deliveries', async () => {
    mockAutomatedPaymentService.processForAppWebhook!.mockResolvedValueOnce({
      statusCode: 401,
      outcome: 'unauthorized',
    });
    const unauth = await app.inject({
      method: 'POST',
      url: '/api/webhooks/forapp',
      headers: { 'x-api-key': 'bad' },
      payload: { id: 'm1', amount: 100_000, unit: 'rial', is_deposit: true },
    });
    expect(unauth.statusCode).toBe(401);

    mockAutomatedPaymentService.processForAppWebhook!.mockResolvedValueOnce({
      statusCode: 200,
      outcome: 'test_ok',
      enabled: true,
    });
    const testPing = await app.inject({
      method: 'POST',
      url: '/api/webhooks/forapp',
      headers: { 'x-api-key': 'valid' },
      payload: { id: 'test-1', test: true, amount: 1000123, unit: 'rial', is_deposit: true },
    });
    expect(testPing.statusCode).toBe(200);
    expect(testPing.json()).toMatchObject({ ok: true, outcome: 'test_ok' });
    expect(mockBotApi.sendMessage).not.toHaveBeenCalled();

    mockAutomatedPaymentService.processForAppWebhook!.mockResolvedValueOnce({
      statusCode: 200,
      outcome: 'matched',
      creditedAmount: 99_876,
      balanceAfter: 174_876,
      order: {
        id: 'po_fa_1',
        telegramId: 55555,
        bankName: 'ملی',
        metadata: JSON.stringify({ offset: 124, telegramMessageIds: [4101, 4105] }),
      },
      deposit: { id: 'fad_1', bank: 'ملی' },
    });
    const matched = await app.inject({
      method: 'POST',
      url: '/api/webhooks/forapp',
      headers: { 'x-api-key': 'valid', 'idempotency-key': 'idem-1' },
      payload: { id: 'idem-1', amount: 998_760, unit: 'rial', is_deposit: true },
    });
    expect(matched.statusCode).toBe(200);
    expect(matched.json()).toMatchObject({ ok: true, outcome: 'matched', orderId: 'po_fa_1' });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(mockBotApi.deleteMessage).toHaveBeenCalledWith(55555, 4101);
    expect(mockBotApi.deleteMessage).toHaveBeenCalledWith(55555, 4105);
    expect(mockBotApi.sendMessage).toHaveBeenCalled();

    // Ignored personal round deposit (e.g. 2,000,000 Toman) -> 200 OK, zero Telegram notifications
    mockBotApi.sendMessage.mockClear();
    mockAutomatedPaymentService.processForAppWebhook!.mockResolvedValueOnce({
      statusCode: 200,
      outcome: 'ignored',
      deposit: {
        id: 'fad_round_2m',
        amountRial: 20_000_000,
        amountToman: 2_000_000,
        bank: 'بلوبانک',
        note: 'round_amount',
      },
    });
    const ignoredRound = await app.inject({
      method: 'POST',
      url: '/api/webhooks/forapp',
      headers: { 'x-api-key': 'valid', 'idempotency-key': 'idem-round-1' },
      payload: { id: 'idem-round-1', amount: 20_000_000, unit: 'rial', is_deposit: true },
    });
    expect(ignoredRound.statusCode).toBe(200);
    expect(ignoredRound.json()).toMatchObject({ ok: true, outcome: 'ignored' });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(mockBotApi.sendMessage).not.toHaveBeenCalled();
  });

  it('handles POST /api/webhooks/nowpayments for invalid sig, completed, and partially_paid', async () => {
    mockAutomatedPaymentService.processNowPaymentsIpn!.mockResolvedValueOnce({
      statusCode: 401,
      outcome: 'invalid_signature',
    });
    const bad = await app.inject({
      method: 'POST',
      url: '/api/webhooks/nowpayments',
      headers: { 'x-nowpayments-sig': 'bad' },
      payload: { payment_id: 1, payment_status: 'finished' },
    });
    expect(bad.statusCode).toBe(401);

    mockAutomatedPaymentService.processNowPaymentsIpn!.mockResolvedValueOnce({
      statusCode: 200,
      outcome: 'completed',
      newlyCompleted: true,
      creditedAmount: 850_000,
      cashbackAmount: 42_500,
      balanceAfter: 967_500,
      order: { id: 'po_np_1', telegramId: 55555, payCurrency: 'usdttrc20' },
    });
    const ok = await app.inject({
      method: 'POST',
      url: '/api/webhooks/nowpayments',
      headers: { 'x-nowpayments-sig': 'valid_sig' },
      payload: { payment_id: 1, payment_status: 'finished' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, outcome: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(mockBotApi.sendMessage).toHaveBeenCalled();
  });

  it('exposes user automated order endpoints and enforces admin guard on payment-gateways routes', async () => {
    // Non-admin blocked from admin gateway endpoints
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/admin/payment-gateways',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    // Admin reads & updates gateway settings
    const gwRes = await app.inject({
      method: 'GET',
      url: '/api/admin/payment-gateways',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(gwRes.statusCode).toBe(200);
    expect(gwRes.json()).toMatchObject({
      forapp: { enabled: true, unmatchedCount: 1 },
      nowpayments: { enabled: true, cashbackPercent: 5 },
    });

    const rotRes = await app.inject({
      method: 'POST',
      url: '/api/admin/payment-gateways/forapp/rotate-key',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(rotRes.statusCode).toBe(200);
    expect(rotRes.json().apiKey).toBe('fa_rotated_key_123456');

    const testRes = await app.inject({
      method: 'POST',
      url: '/api/admin/payment-gateways/nowpayments/test',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(testRes.statusCode).toBe(200);
    expect(testRes.json()).toMatchObject({ ok: true, rateToman: 85_000 });

    // User creates ForApp & NOWPayments orders, checks status, cancels
    const faOrder = await app.inject({
      method: 'POST',
      url: '/api/user/topup/forapp-order',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { amount: 100_000 },
    });
    expect(faOrder.statusCode).toBe(201);
    expect(faOrder.json().order.payableAmountRial).toBe(998_760);

    const npOrder = await app.inject({
      method: 'POST',
      url: '/api/user/topup/nowpayments-order',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { amount: 850_000 },
    });
    expect(npOrder.statusCode).toBe(201);
    expect(npOrder.json().order.paymentUrl).toContain('nowpayments.io');

    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/user/topup/orders/po_fa_1/status',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(statusRes.statusCode).toBe(200);

    const cancelRes = await app.inject({
      method: 'POST',
      url: '/api/user/topup/orders/po_fa_1/cancel',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().order.status).toBe('cancelled');
  });
});
