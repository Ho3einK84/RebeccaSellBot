import { expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/infra/db.js';
import {
  forappDeposits,
  paymentOrders,
  users,
  walletTransactions,
} from '../../src/infra/schema.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import { PaymentService } from '../../src/domain/services/PaymentService.js';
import { AutomatedPaymentService } from '../../src/domain/services/AutomatedPaymentService.js';
import {
  computeNowPaymentsSignature,
  type NowPaymentsClient,
} from '../../src/infra/NowPaymentsClient.js';
import {
  describeIntegration,
  registerIntegrationLifecycleHooks,
  seedIntegrationUser,
} from './_helpers/dbHarness.js';

describeIntegration('AutomatedPaymentService PostgreSQL Integration', () => {
  registerIntegrationLifecycleHooks();

  it('enforces ForApp idempotency, FOR UPDATE matching, expiry, and manual unmatched crediting against real Postgres', async () => {
    await seedIntegrationUser(50001, { balance: 10_000 });
    await seedIntegrationUser(50002, { balance: 0 });

    const ts = new TranslationService();
    await ts.ensureDefaultSettings();
    await ts.updateSettings({
      card_number: '6037997900000001',
      card_holder: 'Integration Holder',
      forapp_enabled: 'true',
      forapp_order_expiry_minutes: '20',
      webapp_url: 'https://bot.example.com',
    });

    const ps = new PaymentService(ts);
    const svc = new AutomatedPaymentService({
      translationService: ts,
      paymentService: ps,
      credentialSecret: 'integration_test_master_secret_key_32b!',
    });

    const { apiKey } = await svc.rotateForAppApiKey();
    const order = await svc.createForAppOrder({
      telegramId: 50001,
      requestedAmount: 100_000,
      locale: 'fa',
    });
    expect(order.payableAmountRial).toBe(order.payableAmount * 10);

    // Deliver exact matching SMS twice with same Idempotency-Key -> single credit
    const [first, second] = await Promise.all([
      svc.processForAppWebhook({
        apiKeyHeader: apiKey,
        idempotencyKeyHeader: 'forapp-idem-int-1',
        body: {
          id: 'forapp-idem-int-1',
          amount: order.payableAmountRial,
          unit: 'rial',
          is_deposit: true,
          bank: 'ملی',
        },
      }),
      svc.processForAppWebhook({
        apiKeyHeader: apiKey,
        idempotencyKeyHeader: 'forapp-idem-int-1',
        body: {
          id: 'forapp-idem-int-1',
          amount: order.payableAmountRial,
          unit: 'rial',
          is_deposit: true,
          bank: 'ملی',
        },
      }),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(['duplicate', 'matched']);

    const [userRow] = await getDb().select().from(users).where(eq(users.telegramId, 50001));
    expect(userRow?.balance).toBe(10_000 + order.payableAmount);

    // Personal round deposit (2,000,000 Toman = 20,000,000 Rial) -> ignored without unmatched queue noise
    const roundPersonal = await svc.processForAppWebhook({
      apiKeyHeader: apiKey,
      idempotencyKeyHeader: 'forapp-round-personal-int',
      body: {
        id: 'forapp-round-personal-int',
        amount: 20_000_000,
        unit: 'rial',
        is_deposit: true,
        bank: 'بلوبانک',
      },
    });
    expect(roundPersonal.outcome).toBe('ignored');
    expect(roundPersonal.deposit?.note).toBe('round_amount');
    expect(await svc.getForAppUnmatchedCount()).toBe(0);

    // Late deposit for a cancelled/expired ForApp order -> unmatched -> admin manually matches to user 50002
    const order2 = await svc.createForAppOrder({
      telegramId: 50002,
      requestedAmount: 25_000,
      locale: 'fa',
    });
    await svc.cancelOrderForUser(order2.id, 50002);

    const unmatched = await svc.processForAppWebhook({
      apiKeyHeader: apiKey,
      idempotencyKeyHeader: 'forapp-unmatched-int-2',
      body: {
        id: 'forapp-unmatched-int-2',
        amount: order2.payableAmountRial,
        unit: 'rial',
        is_deposit: true,
        bank: 'ملت',
      },
    });
    expect(unmatched.outcome).toBe('unmatched');
    expect(unmatched.relatedOrder?.id).toBe(order2.id);

    const manual = await svc.manualMatchForAppDeposit({
      depositId: unmatched.deposit!.id,
      targetTelegramId: 50002,
      adminId: 99999,
    });
    expect(manual.creditedAmount).toBe(order2.payableAmount);

    const [user2] = await getDb().select().from(users).where(eq(users.telegramId, 50002));
    expect(user2?.balance).toBe(order2.payableAmount);

    const allDeposits = await getDb().select().from(forappDeposits);
    expect(allDeposits).toHaveLength(3);
  });

  it('settles NOWPayments finished IPN atomically with cashback and ignores replays against real Postgres', async () => {
    await seedIntegrationUser(60001, { balance: 0 });
    const ts = new TranslationService();
    await ts.ensureDefaultSettings();

    const mockNpClient = {
      createInvoice: vi.fn(async () => ({
        id: 'inv_int_1',
        invoiceUrl: 'https://nowpayments.io/payment/?iid=inv_int_1',
        orderId: 'ignored',
        priceAmount: 10,
        priceCurrency: 'usd',
      })),
      getPaymentStatus: vi.fn(),
      getApiStatus: vi.fn(async () => ({ ok: true, message: 'OK' })),
    };

    const svc = new AutomatedPaymentService({
      translationService: ts,
      paymentService: new PaymentService(ts),
      credentialSecret: 'integration_test_master_secret_key_32b!',
      nowPaymentsClient: mockNpClient as unknown as NowPaymentsClient,
    });

    const ipnSecret = 'integration_ipn_secret_12345678';
    await svc.updateNowPaymentsConfig({
      enabled: true,
      apiKey: 'integration_api_key_12345678',
      ipnSecret,
      rateMode: 'manual',
      manualUsdRateToman: 80_000,
      cashbackPercent: 10,
    });

    const order = await svc.createNowPaymentsOrder({
      telegramId: 60001,
      amountToman: 800_000,
    });

    const ipnPayload = {
      payment_id: 901234,
      invoice_id: 'inv_int_1',
      order_id: order.id,
      payment_status: 'finished',
      pay_currency: 'usdttrc20',
      pay_amount: 10,
      actually_paid: 10,
    };
    const sig = computeNowPaymentsSignature(ipnPayload, ipnSecret);

    mockNpClient.getPaymentStatus.mockResolvedValue({
      paymentId: '901234',
      invoiceId: 'inv_int_1',
      orderId: order.id,
      paymentStatus: 'finished',
      payCurrency: 'usdttrc20',
      payAmount: '10',
      actuallyPaid: '10',
    });

    const res1 = await svc.processNowPaymentsIpn({ payload: ipnPayload, signatureHeader: sig });
    const res2 = await svc.processNowPaymentsIpn({ payload: ipnPayload, signatureHeader: sig });

    expect(res1.outcome).toBe('completed');
    expect(res1.creditedAmount).toBe(800_000);
    expect(res1.cashbackAmount).toBe(80_000);
    expect(res2.outcome).toBe('already_completed');

    const [userRow] = await getDb().select().from(users).where(eq(users.telegramId, 60001));
    expect(userRow?.balance).toBe(880_000);

    const [orderRow] = await getDb()
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.id, order.id));
    expect(orderRow?.status).toBe('completed');

    const txs = await getDb()
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.telegramId, 60001));
    expect(txs).toHaveLength(2); // topup + cashback
  });
});
