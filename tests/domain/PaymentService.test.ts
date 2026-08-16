import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PaymentService,
  CardToCardPaymentProvider,
} from '../../src/domain/services/PaymentService.js';
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

  it('registers default card-to-card provider', () => {
    const cardProvider = service.getProvider('card_to_card');
    expect(cardProvider).toBeDefined();
    expect(cardProvider?.getTitleKey()).toBe('payment_method_card_to_card');
    expect(cardProvider?.isEnabled()).toBe(true);
  });

  it('returns payment configuration correctly', () => {
    const config = service.getPaymentConfiguration();
    expect(config.cardNumber).toBe('6037997900000000');
    expect(config.cardHolder).toBe('Admin User');
    expect(config.walletTransferEnabled).toBe(true);
    expect(config.walletTransferMinAmount).toBe(5000);
  });

  it('updates payment configuration', async () => {
    await service.updatePaymentConfiguration({
      cardNumber: '5022291000000000',
      cardHolder: 'New Admin',
      walletTransferEnabled: false,
    });

    expect(settings.card_number).toBe('5022291000000000');
    expect(settings.card_holder).toBe('New Admin');
    expect(settings.wallet_transfer_enabled).toBe('false');
  });
});
