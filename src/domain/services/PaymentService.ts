import type { TranslationService } from './TranslationService.js';
import type { WalletService } from './WalletService.js';
import { logger } from '../../infra/logger.js';

export type PaymentMethodType = 'manual' | 'automated';

export interface PaymentInstructions {
  methodId: string;
  type: PaymentMethodType;
  cardNumber?: string;
  cardHolder?: string;
  instructions?: string;
  amount: number;
}

export interface PaymentProvider {
  readonly id: string;
  readonly type: PaymentMethodType;
  isEnabled(): boolean;
  getTitleKey(): string;
  getDescriptionKey(): string;
  getInstructions(params: { amount: number; telegramId: number }): Promise<PaymentInstructions>;
}

export class CardToCardPaymentProvider implements PaymentProvider {
  readonly id = 'card_to_card';
  readonly type: PaymentMethodType = 'manual';

  constructor(private readonly translationService: TranslationService) {}

  isEnabled(): boolean {
    const cardNumber = this.translationService.getSetting('card_number', '').trim();
    return cardNumber.length > 0;
  }

  getTitleKey(): string {
    return 'payment_method_card_to_card';
  }

  getDescriptionKey(): string {
    return 'payment_method_card_to_card_desc';
  }

  async getInstructions(params: {
    amount: number;
    telegramId: number;
  }): Promise<PaymentInstructions> {
    const cardNumber = this.translationService.getSetting('card_number', '').trim();
    const cardHolder = this.translationService.getSetting('card_holder', '').trim();

    return {
      methodId: this.id,
      type: this.type,
      cardNumber: cardNumber || undefined,
      cardHolder: cardHolder || undefined,
      amount: params.amount,
    };
  }
}

export interface PaymentConfiguration {
  cardNumber: string;
  cardHolder: string;
  walletTransferEnabled: boolean;
  walletTransferMinAmount: number;
}

export class PaymentService {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(
    private readonly translationService: TranslationService,
    public readonly walletService?: WalletService
  ) {
    this.registerProvider(new CardToCardPaymentProvider(translationService));
  }

  registerProvider(provider: PaymentProvider): void {
    this.providers.set(provider.id, provider);
    logger.debug({ providerId: provider.id }, 'Payment provider registered');
  }

  getProvider(id: string): PaymentProvider | undefined {
    return this.providers.get(id);
  }

  getAvailableProviders(): PaymentProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.isEnabled());
  }

  getAllProviders(): PaymentProvider[] {
    return Array.from(this.providers.values());
  }

  getPaymentConfiguration(): PaymentConfiguration {
    return {
      cardNumber: this.translationService.getSetting('card_number', ''),
      cardHolder: this.translationService.getSetting('card_holder', ''),
      walletTransferEnabled:
        this.translationService.getSetting('wallet_transfer_enabled', 'true') !== 'false',
      walletTransferMinAmount: this.translationService.getSettingNum(
        'wallet_transfer_min_amount',
        10_000
      ),
    };
  }

  async updatePaymentConfiguration(updates: Partial<PaymentConfiguration>): Promise<void> {
    const entries: Record<string, string> = {};

    if (updates.cardNumber !== undefined) {
      entries.card_number = updates.cardNumber.trim();
    }
    if (updates.cardHolder !== undefined) {
      entries.card_holder = updates.cardHolder.trim();
    }
    if (updates.walletTransferEnabled !== undefined) {
      entries.wallet_transfer_enabled = updates.walletTransferEnabled ? 'true' : 'false';
    }
    if (updates.walletTransferMinAmount !== undefined) {
      entries.wallet_transfer_min_amount = String(Math.max(1, updates.walletTransferMinAmount));
    }

    if (Object.keys(entries).length > 0) {
      await this.translationService.updateSettings(entries);
    }
  }
}
