import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentService } from '../../src/domain/services/PaymentService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

describe('PaymentService', () => {
  let settings: Record<string, string>;
  let translationService: TranslationService;
  let service: PaymentService;

  beforeEach(() => {
    settings = {
      card_number: '6037997900000000',
      card_holder: 'Admin User',
      wallet_transfer_enabled: 'true',
      wallet_transfer_min_amount: '5000',
    };

    translationService = {
      getSetting: vi.fn((key: string, def?: string) => settings[key] ?? def ?? ''),
      getSettingNum: vi.fn((key: string, def?: number) => {
        const val = settings[key];
        return val !== undefined ? Number(val) : (def ?? 0);
      }),
      get: vi.fn((key: string) => (key === 'payment_method_card_to_card' ? 'کارت به کارت' : key)),
      updateSettings: vi.fn(async (pairs: Record<string, string>) => {
        Object.assign(settings, pairs);
      }),
    } as unknown as TranslationService;

    service = new PaymentService(translationService);
  });

  it('registers default card-to-card provider and generates instructions', async () => {
    const cardProvider = service.getProvider('card_to_card');
    expect(cardProvider).toBeDefined();
    expect(cardProvider?.getTitleKey()).toBe('payment_method_card_to_card');
    expect(cardProvider?.isEnabled()).toBe(true);
    expect(service.getAvailableProviders()).toHaveLength(1);

    await expect(
      cardProvider!.getInstructions({ amount: 25_000, telegramId: 42 })
    ).resolves.toEqual({
      methodId: 'card_to_card',
      type: 'manual',
      cardNumber: '6037997900000000',
      cardHolder: 'Admin User',
      amount: 25_000,
    });

    settings.card_number = '   ';
    expect(cardProvider?.isEnabled()).toBe(false);
    expect(service.getAvailableProviders()).toEqual([]);
  });

  it('aligns payment configuration with FeatureSettings defaults and boolean parsing', () => {
    delete settings.wallet_transfer_enabled;
    delete settings.wallet_transfer_min_amount;

    expect(service.getPaymentConfiguration()).toEqual({
      cardNumber: '6037997900000000',
      cardHolder: 'Admin User',
      walletTransferEnabled: true,
      walletTransferMinAmount: 5_000,
    });

    settings.wallet_transfer_enabled = '0';
    settings.wallet_transfer_min_amount = '25000';
    expect(service.getPaymentConfiguration()).toMatchObject({
      walletTransferEnabled: false,
      walletTransferMinAmount: 25_000,
    });
  });

  it('updates payment configuration and rejects invalid walletTransferMinAmount values', async () => {
    await service.updatePaymentConfiguration({
      cardNumber: '  5022291000000000  ',
      cardHolder: '  New Admin  ',
      walletTransferEnabled: false,
      walletTransferMinAmount: 15_000,
    });

    expect(settings.card_number).toBe('5022291000000000');
    expect(settings.card_holder).toBe('New Admin');
    expect(settings.wallet_transfer_enabled).toBe('false');
    expect(settings.wallet_transfer_min_amount).toBe('15000');

    for (const invalid of [0, -100, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        service.updatePaymentConfiguration({ walletTransferMinAmount: invalid })
      ).rejects.toThrow('INVALID_WALLET_TRANSFER_MIN_AMOUNT');
    }
  });
});
