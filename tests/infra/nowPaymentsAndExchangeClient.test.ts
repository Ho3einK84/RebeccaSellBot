import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeNowPaymentsSignature,
  NowPaymentsApiError,
  NowPaymentsClient,
  sortJsonKeysRecursively,
  verifyNowPaymentsSignature,
} from '../../src/infra/NowPaymentsClient.js';
import { ExchangeRateClient } from '../../src/infra/ExchangeRateClient.js';

describe('NowPaymentsClient & Signature Verification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recursively sorts object keys and verifies HMAC-SHA512 IPN signatures in constant time', () => {
    const secret = 'ipn_secret_super_strong_key_123';
    const payloadA = {
      payment_status: 'finished',
      payment_id: 987654321,
      order_id: 'po_123_abc',
      nested: { z: 1, a: [{ d: 4, b: 2 }, null] },
    };
    const payloadB = {
      nested: { a: [{ b: 2, d: 4 }, null], z: 1 },
      order_id: 'po_123_abc',
      payment_id: 987654321,
      payment_status: 'finished',
    };

    expect(JSON.stringify(sortJsonKeysRecursively(payloadA))).toBe(
      JSON.stringify(sortJsonKeysRecursively(payloadB))
    );

    const sig = computeNowPaymentsSignature(payloadA, secret);
    expect(sig).toMatch(/^[a-f0-9]{128}$/u);
    expect(verifyNowPaymentsSignature(payloadB, sig, secret)).toBe(true);
    expect(verifyNowPaymentsSignature(payloadB, sig.toUpperCase(), secret)).toBe(true);
    expect(verifyNowPaymentsSignature(payloadB, sig, 'wrong_secret')).toBe(false);
    expect(verifyNowPaymentsSignature({ ...payloadB, payment_status: 'failed' }, sig, secret)).toBe(
      false
    );
    expect(verifyNowPaymentsSignature(payloadB, 'not_hex_at_all', secret)).toBe(false);
    expect(verifyNowPaymentsSignature(payloadB, undefined, secret)).toBe(false);
    expect(verifyNowPaymentsSignature(payloadB, sig, '')).toBe(false);
  });

  it('creates invoices against live and sandbox endpoints and validates response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 55443322,
          invoice_url: 'https://nowpayments.io/payment/?iid=55443322',
          order_id: 'po_1_abcd',
          price_amount: 12.5,
          price_currency: 'usd',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new NowPaymentsClient();
    const invoice = await client.createInvoice({
      apiKey: 'np_live_key_123456',
      sandbox: true,
      priceAmount: 12.5,
      priceCurrency: 'usd',
      orderId: 'po_1_abcd',
      orderDescription: 'Wallet top-up',
      ipnCallbackUrl: 'https://bot.example.com/api/webhooks/nowpayments',
    });

    expect(invoice).toEqual({
      id: '55443322',
      invoiceUrl: 'https://nowpayments.io/payment/?iid=55443322',
      orderId: 'po_1_abcd',
      priceAmount: '12.5',
      priceCurrency: 'usd',
      payCurrency: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api-sandbox.nowpayments.io/v1/invoice');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('np_live_key_123456');
  });

  it('fetches authoritative payment status and throws NowPaymentsApiError on HTTP failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            payment_id: 778899,
            invoice_id: 55443322,
            order_id: 'po_1_abcd',
            payment_status: 'finished',
            pay_currency: 'usdttrc20',
            pay_amount: 12.5,
            actually_paid: 12.5,
            price_amount: 12.5,
            price_currency: 'usd',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 403 })
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new NowPaymentsClient();
    const detail = await client.getPaymentStatus('778899', 'np_live_key_123456', false);
    expect(detail).toMatchObject({
      paymentId: '778899',
      invoiceId: '55443322',
      orderId: 'po_1_abcd',
      paymentStatus: 'finished',
      payCurrency: 'usdttrc20',
      actuallyPaid: '12.5',
    });

    await expect(client.getPaymentStatus('778899', 'bad_key', false)).rejects.toBeInstanceOf(
      NowPaymentsApiError
    );
  });
});

describe('ExchangeRateClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses Nobitex Rial rate into Toman, caches result, and falls back to Wallex on error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', lastTradePrice: '850000' }), { status: 200 })
      )
      .mockRejectedValueOnce(new Error('nobitex timeout'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: { symbols: { USDTIRT: { stats: { lastPrice: '86500' } } } },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new ExchangeRateClient();
    const first = await client.fetchUsdTomanRate();
    expect(first).toMatchObject({ rateToman: 85_000, provider: 'nobitex' });

    // Cached second call does not trigger fetch
    const cached = await client.fetchUsdTomanRate();
    expect(cached?.rateToman).toBe(85_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Forced refresh fails Nobitex -> succeeds via Wallex
    const refreshed = await client.fetchUsdTomanRate({ forceRefresh: true });
    expect(refreshed).toMatchObject({ rateToman: 86_500, provider: 'wallex' });
  });

  it('returns null when cold and all live providers fail or return out-of-bounds prices', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', lastTradePrice: '50' }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new ExchangeRateClient();
    expect(await client.fetchUsdTomanRate()).toBeNull();
  });
});
