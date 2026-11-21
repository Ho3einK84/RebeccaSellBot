import crypto from 'node:crypto';
import { and, eq, gte, inArray, isNotNull, or } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import { topupReceipts } from '../../infra/schema.js';
import type { TranslationService } from './TranslationService.js';
import type { WalletService } from './WalletService.js';
import { logger } from '../../infra/logger.js';
import { walletTransferEnabled, walletTransferMinAmount } from './FeatureSettings.js';

export type PaymentMethodType = 'manual' | 'automated';

export const MAX_BANK_CARDS = 20;
export const LEGACY_BANK_CARD_ID = 'legacy_default';

export interface BankCardConfig {
  id: string;
  cardNumber: string;
  cardHolder: string;
  enabled: boolean;
  dailyCapToman?: number | null;
  bankName?: string;
}

export interface BankCardStatus extends BankCardConfig {
  dailyUsageToman: number;
  remainingCapToman: number | null;
  isCapReached: boolean;
  detectedBankName?: string;
  luhnValid: boolean;
}

export interface SelectCardOptions {
  /** Requested top-up amount in Toman used to evaluate remaining daily cap. */
  amountToman?: number;
  /** Optional precomputed daily usage per card ID (or card number) in Toman. */
  dailyUsageByCardId?: ReadonlyMap<string, number> | Record<string, number>;
  /** Optional explicit rotation index for deterministic round-robin selection. */
  rotationIndex?: number;
  /** Optional timestamp for day-key calculation (defaults to now). */
  now?: Date;
}

export interface UniquePayableAmountOptions {
  /** Direction of offset: 'deduct' (default) subtracts offset, 'add' adds offset. */
  mode?: 'deduct' | 'add';
  /** Minimum offset in Toman (default: 1). */
  minOffset?: number;
  /** Maximum offset in Toman (default: 999). */
  maxOffset?: number;
  /** Step granularity in Toman (default: 1). */
  step?: number;
  /** Existing pending receipt amounts to avoid colliding with (skips DB lookup when supplied). */
  existingPendingAmounts?: Iterable<number>;
  /** Lookback window in hours for DB pending receipt lookup (default: 24). */
  lookbackHours?: number;
  /** Optional deterministic RNG returning [0, 1). */
  random?: () => number;
  /** Skip DB lookup when existingPendingAmounts is omitted. */
  skipDbLookup?: boolean;
}

export interface UniquePayableAmountAllocation {
  requestedAmount: number;
  payableAmount: number;
  offset: number;
  isUnique: boolean;
}

export interface PaymentInstructions {
  methodId: string;
  type: PaymentMethodType;
  cardId?: string;
  cardNumber?: string;
  cardHolder?: string;
  bankName?: string;
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

const LEGACY_CARD_ID = LEGACY_BANK_CARD_ID;
const DEFAULT_UNIQUE_MIN_OFFSET = 1;
const DEFAULT_UNIQUE_MAX_OFFSET = 999;
const DEFAULT_UNIQUE_STEP = 1;
const DEFAULT_PENDING_LOOKBACK_HOURS = 24;
const IRAN_TZ_OFFSET_MS = 3.5 * 60 * 60 * 1000;

interface IranianBankBinEntry {
  prefix: string;
  fa: string;
  en: string;
}

/**
 * Iranian Shetab BIN prefix directory.
 * Ordered with 8-digit sub-brands (e.g. Blu Bank) before 6-digit parent BINs.
 */
const IRANIAN_BANK_BINS: readonly IranianBankBinEntry[] = [
  { prefix: '62198619', fa: 'بلوبانک (سامان)', en: 'Blu Bank (Saman)' },
  { prefix: '603799', fa: 'بانک ملی', en: 'Bank Melli' },
  { prefix: '603769', fa: 'بانک صادرات', en: 'Bank Saderat' },
  { prefix: '610433', fa: 'بانک ملت', en: 'Bank Mellat' },
  { prefix: '991975', fa: 'بانک ملت', en: 'Bank Mellat' },
  { prefix: '621986', fa: 'بانک سامان', en: 'Saman Bank' },
  { prefix: '502229', fa: 'بانک پاسارگاد', en: 'Pasargad Bank' },
  { prefix: '639347', fa: 'بانک پاسارگاد', en: 'Pasargad Bank' },
  { prefix: '589210', fa: 'بانک سپه', en: 'Bank Sepah' },
  { prefix: '603770', fa: 'بانک کشاورزی', en: 'Keshavarzi Bank' },
  { prefix: '639217', fa: 'بانک کشاورزی', en: 'Keshavarzi Bank' },
  { prefix: '628023', fa: 'بانک مسکن', en: 'Bank Maskan' },
  { prefix: '589463', fa: 'بانک رفاه', en: 'Refah Bank' },
  { prefix: '627353', fa: 'بانک تجارت', en: 'Tejarat Bank' },
  { prefix: '585983', fa: 'بانک تجارت', en: 'Tejarat Bank' },
  { prefix: '627412', fa: 'بانک اقتصاد نوین', en: 'EN Bank' },
  { prefix: '622106', fa: 'بانک پارسیان', en: 'Parsian Bank' },
  { prefix: '639194', fa: 'بانک پارسیان', en: 'Parsian Bank' },
  { prefix: '627884', fa: 'بانک پارسیان', en: 'Parsian Bank' },
  { prefix: '627488', fa: 'بانک کارآفرین', en: 'Karafarin Bank' },
  { prefix: '502910', fa: 'بانک کارآفرین', en: 'Karafarin Bank' },
  { prefix: '639346', fa: 'بانک سینا', en: 'Sina Bank' },
  { prefix: '639607', fa: 'بانک سرمایه', en: 'Sarmayeh Bank' },
  { prefix: '636214', fa: 'بانک آینده', en: 'Ayandeh Bank' },
  { prefix: '502806', fa: 'بانک شهر', en: 'Shahr Bank' },
  { prefix: '504706', fa: 'بانک شهر', en: 'Shahr Bank' },
  { prefix: '502938', fa: 'بانک دی', en: 'Day Bank' },
  { prefix: '502908', fa: 'بانک توسعه تعاون', en: 'Tosee Taavon Bank' },
  { prefix: '627648', fa: 'بانک توسعه صادرات', en: 'Export Development Bank' },
  { prefix: '207177', fa: 'بانک توسعه صادرات', en: 'Export Development Bank' },
  { prefix: '627961', fa: 'بانک صنعت و معدن', en: 'Bank of Industry & Mine' },
  { prefix: '627760', fa: 'پست بانک', en: 'Post Bank' },
  { prefix: '606373', fa: 'بانک مهر ایران', en: 'Mehr Iran Bank' },
  { prefix: '504172', fa: 'بانک رسالت', en: 'Resalat Bank' },
  { prefix: '505416', fa: 'بانک گردشگری', en: 'Tourism Bank' },
  { prefix: '505785', fa: 'بانک ایران زمین', en: 'Iran Zamin Bank' },
  { prefix: '585947', fa: 'بانک خاورمیانه', en: 'Middle East Bank' },
  { prefix: '606256', fa: 'مؤسسه اعتباری ملل', en: 'Melal Credit' },
  { prefix: '628157', fa: 'مؤسسه اعتباری توسعه', en: 'Tosee Credit' },
  { prefix: '639599', fa: 'بانک قوامین', en: 'Ghavamin Bank' },
  { prefix: '627381', fa: 'بانک انصار', en: 'Ansar Bank' },
  { prefix: '636949', fa: 'بانک حکمت ایرانیان', en: 'Hekmat Bank' },
  { prefix: '505801', fa: 'مؤسسه کوثر', en: 'Kosar Credit' },
  { prefix: '636795', fa: 'بانک مرکزی', en: 'Central Bank' },
];

function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Normalize a raw bank card number by converting Persian/Arabic numerals,
 * stripping BiDi/zero-width marks (e.g. LRM copied from Telegram), spaces,
 * and common separators (`-`, `–`, `—`, `−`, `_`, `.`).
 */
export function normalizeCardNumber(raw: string): string {
  return normalizeDigits(raw)
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, '')
    .replace(/[\s\-–—−_.]/gu, '')
    .trim();
}

export function isValidBankCardNumber(raw: string): boolean {
  const normalized = normalizeCardNumber(raw);
  return /^\d{12,24}$/u.test(normalized);
}

/** Standard Mod-10 (Luhn) checksum verification for bank card numbers. */
export function isValidLuhnCardNumber(raw: string): boolean {
  const digits = normalizeCardNumber(raw);
  if (!/^\d{12,24}$/u.test(digits)) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/** Auto-detect Iranian Shetab bank name from card BIN prefix. */
export function detectIranianBankName(
  rawCardNumber: string,
  locale: 'fa' | 'en' = 'fa'
): string | undefined {
  const digits = normalizeCardNumber(rawCardNumber);
  if (digits.length < 6) return undefined;
  for (const entry of IRANIAN_BANK_BINS) {
    if (digits.startsWith(entry.prefix)) {
      return locale === 'en' ? entry.en : entry.fa;
    }
  }
  return undefined;
}

/** Return a compact masked label such as `•••• 6846` for buttons and audit rows. */
export function maskCardNumberShort(rawCardNumber: string): string {
  const digits = normalizeCardNumber(rawCardNumber);
  if (digits.length >= 4) {
    return `•••• ${digits.slice(-4)}`;
  }
  return digits || '—';
}

export function generateBankCardId(existingCards: readonly Pick<BankCardConfig, 'id'>[]): string {
  const existingIds = new Set(existingCards.map((c) => c.id));
  for (let i = 1; i <= 999; i += 1) {
    const candidate = `card_${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `c_${crypto.randomBytes(4).toString('hex')}`;
}

export function hasDuplicateCardNumber(
  cards: readonly BankCardConfig[],
  cardNumber: string,
  excludeCardId?: string
): boolean {
  const target = normalizeCardNumber(cardNumber);
  if (!target) return false;
  return cards.some(
    (card) => card.id !== excludeCardId && normalizeCardNumber(card.cardNumber) === target
  );
}

export function parseBankCardsJson(raw: string | null | undefined): BankCardConfig[] {
  if (!raw || typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const cards: BankCardConfig[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i];
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;

    const rawId = typeof record.id === 'string' ? record.id.trim() : '';
    const rawCardNumber =
      typeof record.cardNumber === 'string' ? normalizeCardNumber(record.cardNumber) : '';
    const rawCardHolder = typeof record.cardHolder === 'string' ? record.cardHolder.trim() : '';

    if (!rawId || !rawCardNumber) continue;
    if (seenIds.has(rawId)) continue;
    seenIds.add(rawId);

    const enabled = record.enabled === undefined ? true : Boolean(record.enabled);

    let dailyCapToman: number | null = null;
    if (record.dailyCapToman !== undefined && record.dailyCapToman !== null) {
      const capNum =
        typeof record.dailyCapToman === 'number'
          ? record.dailyCapToman
          : typeof record.dailyCapToman === 'string'
            ? Number(
                normalizeDigits(record.dailyCapToman)
                  .replace(/[,_،٬\s]/gu, '')
                  .trim()
              )
            : Number.NaN;
      if (Number.isSafeInteger(capNum) && capNum > 0) {
        dailyCapToman = capNum;
      }
    }

    const bankName =
      typeof record.bankName === 'string' && record.bankName.trim().length > 0
        ? record.bankName.trim()
        : undefined;

    cards.push({
      id: rawId,
      cardNumber: rawCardNumber,
      cardHolder: rawCardHolder,
      enabled,
      dailyCapToman,
      ...(bankName ? { bankName } : {}),
    });
  }

  return cards;
}

export function serializeBankCardsJson(cards: readonly BankCardConfig[]): string {
  const sanitized = cards
    .filter((card) => Boolean(card.id?.trim()) && Boolean(normalizeCardNumber(card.cardNumber)))
    .map((card) => ({
      id: card.id.trim(),
      cardNumber: normalizeCardNumber(card.cardNumber),
      cardHolder: card.cardHolder.trim(),
      enabled: Boolean(card.enabled),
      dailyCapToman:
        card.dailyCapToman !== undefined &&
        card.dailyCapToman !== null &&
        Number.isSafeInteger(card.dailyCapToman) &&
        card.dailyCapToman > 0
          ? card.dailyCapToman
          : null,
      ...(card.bankName?.trim() ? { bankName: card.bankName.trim() } : {}),
    }));
  return JSON.stringify(sanitized);
}

/**
 * Pure, collision-avoiding payable-amount allocator.
 *
 * Applies a small randomized offset/deduction (default 1..999 Toman) so each
 * pending manual card-to-card transfer has an easily distinguishable amount.
 * Guarantees `payableAmount > 0` and avoids collisions with `existingPendingAmounts`.
 */
export function computeUniquePayableAmount(
  requestedAmount: number,
  existingPendingAmounts: Iterable<number>,
  options: Omit<
    UniquePayableAmountOptions,
    'existingPendingAmounts' | 'lookbackHours' | 'skipDbLookup'
  > = {}
): UniquePayableAmountAllocation {
  if (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0) {
    throw new Error('INVALID_TOPUP_AMOUNT');
  }

  const minOffset =
    options.minOffset !== undefined &&
    Number.isSafeInteger(options.minOffset) &&
    options.minOffset >= 1
      ? options.minOffset
      : DEFAULT_UNIQUE_MIN_OFFSET;
  const maxOffset =
    options.maxOffset !== undefined &&
    Number.isSafeInteger(options.maxOffset) &&
    options.maxOffset >= minOffset
      ? options.maxOffset
      : Math.max(minOffset, DEFAULT_UNIQUE_MAX_OFFSET);
  const step =
    options.step !== undefined && Number.isSafeInteger(options.step) && options.step >= 1
      ? options.step
      : DEFAULT_UNIQUE_STEP;

  const preferredMode = options.mode ?? 'deduct';
  const effectiveMode: 'deduct' | 'add' =
    preferredMode === 'deduct' && requestedAmount <= minOffset ? 'add' : preferredMode;

  const pendingSet = new Set<number>();
  for (const value of existingPendingAmounts) {
    if (Number.isSafeInteger(value) && value > 0) {
      pendingSet.add(value);
    }
  }

  const effectiveMaxOffset =
    effectiveMode === 'deduct' ? Math.min(maxOffset, requestedAmount - 1) : maxOffset;

  const availableCandidates: Array<{ payableAmount: number; offset: number }> = [];
  for (let offset = minOffset; offset <= effectiveMaxOffset; offset += step) {
    const candidate =
      effectiveMode === 'deduct' ? requestedAmount - offset : requestedAmount + offset;
    if (candidate > 0 && Number.isSafeInteger(candidate) && !pendingSet.has(candidate)) {
      availableCandidates.push({
        payableAmount: candidate,
        offset: effectiveMode === 'deduct' ? -offset : offset,
      });
    }
  }

  if (availableCandidates.length > 0) {
    const pickedIndex =
      typeof options.random === 'function'
        ? Math.min(
            availableCandidates.length - 1,
            Math.max(0, Math.floor(options.random() * availableCandidates.length))
          )
        : crypto.randomInt(0, availableCandidates.length);
    const chosen = availableCandidates[pickedIndex]!;
    return {
      requestedAmount,
      payableAmount: chosen.payableAmount,
      offset: chosen.offset,
      isUnique: true,
    };
  }

  // All offsets in the primary band collided: expand cleanly above requestedAmount
  // so every concurrent transfer still gets a distinct payable amount.
  for (let extra = 1; extra <= 2_000; extra += 1) {
    const offset = maxOffset + extra * step;
    const candidate = requestedAmount + offset;
    if (Number.isSafeInteger(candidate) && !pendingSet.has(candidate)) {
      return {
        requestedAmount,
        payableAmount: candidate,
        offset,
        isUnique: true,
      };
    }
  }

  return {
    requestedAmount,
    payableAmount: requestedAmount,
    offset: 0,
    isUnique: !pendingSet.has(requestedAmount),
  };
}

function resolveTehranDayKey(now: Date): string {
  const tehran = new Date(now.getTime() + IRAN_TZ_OFFSET_MS);
  const year = tehran.getUTCFullYear();
  const month = String(tehran.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tehran.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveTehranDayStartUtc(now: Date = new Date()): Date {
  const tehran = new Date(now.getTime() + IRAN_TZ_OFFSET_MS);
  const midnightTehranAsUtcMs = Date.UTC(
    tehran.getUTCFullYear(),
    tehran.getUTCMonth(),
    tehran.getUTCDate(),
    0,
    0,
    0,
    0
  );
  return new Date(midnightTehranAsUtcMs - IRAN_TZ_OFFSET_MS);
}

function readCardUsage(
  usageSource: ReadonlyMap<string, number> | Record<string, number> | undefined,
  card: Pick<BankCardConfig, 'id' | 'cardNumber'>
): number {
  if (!usageSource) return 0;
  if (usageSource instanceof Map) {
    const byId = usageSource.get(card.id) ?? 0;
    const byNum = usageSource.get(card.cardNumber) ?? 0;
    return Math.max(byId, byNum);
  }
  const record = usageSource as Record<string, number>;
  const byId = record[card.id] ?? 0;
  const byNum = record[card.cardNumber] ?? 0;
  return Math.max(byId, byNum);
}

export class CardToCardPaymentProvider implements PaymentProvider {
  readonly id = 'card_to_card';
  readonly type: PaymentMethodType = 'manual';

  constructor(
    private readonly translationService: TranslationService,
    private readonly cardSelector?: (options?: SelectCardOptions) => BankCardConfig | null
  ) {}

  isEnabled(): boolean {
    const configured = parseBankCardsJson(
      this.translationService.getSetting('bank_cards_json', '[]')
    );
    if (configured.some((card) => card.enabled)) {
      return true;
    }
    const cardNumber = normalizeCardNumber(this.translationService.getSetting('card_number', ''));
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
    const selected = this.cardSelector?.({ amountToman: params.amount }) ?? null;
    if (selected && selected.id !== LEGACY_CARD_ID) {
      return {
        methodId: this.id,
        type: this.type,
        cardId: selected.id,
        cardNumber: selected.cardNumber || undefined,
        cardHolder: selected.cardHolder || undefined,
        ...(selected.bankName ? { bankName: selected.bankName } : {}),
        amount: params.amount,
      };
    }

    const cardNumber = normalizeCardNumber(this.translationService.getSetting('card_number', ''));
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
  private rotationCounter = 0;
  private dailyUsageDayKey = '';
  private readonly dailyUsageByCard = new Map<string, number>();

  constructor(
    private readonly translationService: TranslationService,
    public readonly walletService?: WalletService
  ) {
    this.registerProvider(
      new CardToCardPaymentProvider(translationService, (opts) => this.selectCardForTopup(opts))
    );
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
      walletTransferEnabled: walletTransferEnabled(this.translationService),
      walletTransferMinAmount: walletTransferMinAmount(this.translationService),
    };
  }

  async updatePaymentConfiguration(updates: Partial<PaymentConfiguration>): Promise<void> {
    const entries: Record<string, string> = {};

    if (updates.cardNumber !== undefined) {
      entries.card_number = normalizeCardNumber(updates.cardNumber);
    }
    if (updates.cardHolder !== undefined) {
      entries.card_holder = updates.cardHolder.trim();
    }
    if (updates.walletTransferEnabled !== undefined) {
      entries.wallet_transfer_enabled = updates.walletTransferEnabled ? 'true' : 'false';
    }
    if (updates.walletTransferMinAmount !== undefined) {
      if (
        !Number.isSafeInteger(updates.walletTransferMinAmount) ||
        updates.walletTransferMinAmount < 1
      ) {
        throw new Error('INVALID_WALLET_TRANSFER_MIN_AMOUNT');
      }
      entries.wallet_transfer_min_amount = String(updates.walletTransferMinAmount);
    }

    if (Object.keys(entries).length > 0) {
      await this.translationService.updateSettings(entries);
    }
  }

  /** Return all bank cards parsed from `bank_cards_json`. */
  getConfiguredBankCards(): BankCardConfig[] {
    return parseBankCardsJson(this.translationService.getSetting('bank_cards_json', '[]'));
  }

  /** Return legacy fallback card from `card_number` / `card_holder` if configured. */
  getLegacyDefaultCard(locale: 'fa' | 'en' = 'fa'): BankCardConfig | null {
    const legacyCardNumber = normalizeCardNumber(
      this.translationService.getSetting('card_number', '')
    );
    if (!legacyCardNumber) {
      return null;
    }
    const detectedBank = detectIranianBankName(legacyCardNumber, locale);
    return {
      id: LEGACY_CARD_ID,
      cardNumber: legacyCardNumber,
      cardHolder: this.translationService.getSetting('card_holder', '').trim(),
      enabled: true,
      dailyCapToman: null,
      ...(detectedBank ? { bankName: detectedBank } : {}),
    };
  }

  /**
   * Return active bank cards, falling back to legacy `card_number` / `card_holder`
   * when `bank_cards_json` is empty or contains no enabled cards.
   */
  getActiveBankCards(): BankCardConfig[] {
    const enabledConfigured = this.getConfiguredBankCards().filter((card) => card.enabled);
    if (enabledConfigured.length > 0) {
      return enabledConfigured;
    }

    const legacyCardNumber = normalizeCardNumber(
      this.translationService.getSetting('card_number', '')
    );
    if (!legacyCardNumber) {
      return [];
    }

    return [
      {
        id: LEGACY_CARD_ID,
        cardNumber: legacyCardNumber,
        cardHolder: this.translationService.getSetting('card_holder', '').trim(),
        enabled: true,
        dailyCapToman: null,
      },
    ];
  }

  /** Persist validated multi-card list into `bank_cards_json`. */
  async updateBankCards(cards: readonly BankCardConfig[]): Promise<void> {
    await this.translationService.updateSettings({
      bank_cards_json: serializeBankCardsJson(cards),
    });
  }

  /** Record today's top-up volume against a card for daily-cap rotation tracking. */
  recordCardDailyUsage(cardId: string, amountToman: number, now: Date = new Date()): void {
    if (!cardId.trim() || !Number.isSafeInteger(amountToman) || amountToman <= 0) return;
    this.ensureDailyUsageWindow(now);
    const current = this.dailyUsageByCard.get(cardId) ?? 0;
    this.dailyUsageByCard.set(cardId, current + amountToman);
  }

  /** Read in-memory daily usage tracked for a card ID on the given day. */
  getCardDailyUsage(cardId: string, now: Date = new Date()): number {
    this.ensureDailyUsageWindow(now);
    return this.dailyUsageByCard.get(cardId) ?? 0;
  }

  /**
   * Load today's (Tehran day) card volume from PostgreSQL (`pending` + `approved` receipts),
   * merged with any in-memory tracked volume. Safe when DB is uninitialized in unit tests.
   */
  async getTodayCardUsageMap(now: Date = new Date()): Promise<Map<string, number>> {
    this.ensureDailyUsageWindow(now);
    const merged = new Map<string, number>(this.dailyUsageByCard);
    const dayStartUtc = resolveTehranDayStartUtc(now);

    try {
      const db = getDb();
      const rows = await db
        .select({
          cardId: topupReceipts.cardId,
          cardNumber: topupReceipts.cardNumber,
          amount: topupReceipts.amount,
        })
        .from(topupReceipts)
        .where(
          and(
            inArray(topupReceipts.status, ['pending', 'approved']),
            gte(topupReceipts.createdAt, dayStartUtc),
            or(isNotNull(topupReceipts.cardId), isNotNull(topupReceipts.cardNumber))
          )
        );

      const dbById = new Map<string, number>();
      const dbByNumber = new Map<string, number>();

      for (const row of rows) {
        const amount = Number(row.amount);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const cid = row.cardId?.trim();
        const cnum = row.cardNumber ? normalizeCardNumber(row.cardNumber) : '';
        if (cid) {
          dbById.set(cid, (dbById.get(cid) ?? 0) + amount);
        }
        if (cnum) {
          dbByNumber.set(cnum, (dbByNumber.get(cnum) ?? 0) + amount);
        }
      }

      for (const [key, total] of dbById) {
        merged.set(key, Math.max(merged.get(key) ?? 0, total));
      }
      for (const [key, total] of dbByNumber) {
        merged.set(key, Math.max(merged.get(key) ?? 0, total));
      }
    } catch (err) {
      logger.debug({ err }, 'Could not query DB for today card usage; using in-memory usage map');
    }

    return merged;
  }

  /** Return all configured bank cards enriched with today's usage, remaining cap, and BIN metadata. */
  async getBankCardsWithDailyUsage(
    now: Date = new Date(),
    locale: 'fa' | 'en' = 'fa'
  ): Promise<BankCardStatus[]> {
    const cards = this.getConfiguredBankCards();
    const usageMap = await this.getTodayCardUsageMap(now);

    return cards.map((card) => {
      const dailyUsageToman = readCardUsage(usageMap, card);
      const remainingCapToman =
        card.dailyCapToman != null ? Math.max(0, card.dailyCapToman - dailyUsageToman) : null;
      const isCapReached = card.dailyCapToman != null && dailyUsageToman >= card.dailyCapToman;
      const detectedBankName = detectIranianBankName(card.cardNumber, locale);
      return {
        ...card,
        dailyUsageToman,
        remainingCapToman,
        isCapReached,
        ...(detectedBankName ? { detectedBankName } : {}),
        luhnValid: isValidLuhnCardNumber(card.cardNumber),
      };
    });
  }

  /** Check whether a specific card still has remaining daily capacity for `amountToman`. */
  canCardAcceptAmount(
    card: BankCardConfig,
    amountToman: number,
    dailyUsageByCardId?: ReadonlyMap<string, number> | Record<string, number>,
    now: Date = new Date()
  ): boolean {
    if (!card.enabled) return false;
    if (card.dailyCapToman == null) return true;
    this.ensureDailyUsageWindow(now);
    const usageSource = dailyUsageByCardId ?? this.dailyUsageByCard;
    const usedToday = readCardUsage(usageSource, card);
    if (usedToday >= card.dailyCapToman) return false;
    const requested = Number.isSafeInteger(amountToman) && amountToman > 0 ? amountToman : 0;
    return usedToday + requested <= card.dailyCapToman;
  }

  /**
   * Select an enabled bank card for a top-up with optional daily-cap enforcement
   * and round-robin rotation. Falls back to legacy `card_number`/`card_holder`
   * when `bank_cards_json` is empty or has no enabled cards.
   */
  selectCardForTopup(options: SelectCardOptions = {}): BankCardConfig | null {
    const activeCards = this.getActiveBankCards();
    if (activeCards.length === 0) return null;

    const now = options.now ?? new Date();
    this.ensureDailyUsageWindow(now);
    const usageSource = options.dailyUsageByCardId ?? this.dailyUsageByCard;
    const requestedAmount =
      options.amountToman !== undefined &&
      Number.isSafeInteger(options.amountToman) &&
      options.amountToman > 0
        ? options.amountToman
        : 0;

    const eligibleCards = activeCards.filter((card) => {
      if (card.dailyCapToman == null) return true;
      const usedToday = readCardUsage(usageSource, card);
      if (usedToday >= card.dailyCapToman) return false;
      return usedToday + requestedAmount <= card.dailyCapToman;
    });

    if (eligibleCards.length === 0) return null;

    const rawIndex =
      options.rotationIndex !== undefined && Number.isSafeInteger(options.rotationIndex)
        ? Math.abs(options.rotationIndex)
        : this.rotationCounter++;

    return eligibleCards[rawIndex % eligibleCards.length]!;
  }

  /**
   * Async variant of `selectCardForTopup` that hydrates today's usage from PostgreSQL
   * before evaluating `dailyCapToman`.
   */
  async selectCardForTopupWithDailyCaps(
    options: SelectCardOptions = {}
  ): Promise<BankCardConfig | null> {
    if (options.dailyUsageByCardId !== undefined) {
      return this.selectCardForTopup(options);
    }
    const now = options.now ?? new Date();
    const usageMap = await this.getTodayCardUsageMap(now);
    return this.selectCardForTopup({ ...options, dailyUsageByCardId: usageMap, now });
  }

  /** Resolve a concise human-readable card label for receipt reviews and admin alerts. */
  resolveCardDisplayLabel(
    params: { cardId?: string | null; cardNumber?: string | null },
    locale: 'fa' | 'en' = 'fa'
  ): string | null {
    const configured = this.getConfiguredBankCards();
    const matched =
      (params.cardId ? configured.find((c) => c.id === params.cardId) : undefined) ??
      (params.cardNumber
        ? configured.find(
            (c) => normalizeCardNumber(c.cardNumber) === normalizeCardNumber(params.cardNumber!)
          )
        : undefined);

    const cardNumber =
      matched?.cardNumber ?? (params.cardNumber ? normalizeCardNumber(params.cardNumber) : '');
    if (!cardNumber) return null;

    const bankName = matched?.bankName || detectIranianBankName(cardNumber, locale);
    const holder =
      matched?.cardHolder ||
      (params.cardId === LEGACY_CARD_ID
        ? this.translationService.getSetting('card_holder', '').trim()
        : '');
    const masked = maskCardNumberShort(cardNumber);

    const parts: string[] = [];
    if (bankName) parts.push(bankName);
    parts.push(masked);
    if (holder) parts.push(holder);
    return parts.join(' · ');
  }

  /**
   * Allocate a unique payable amount for a manual transfer by avoiding collisions
   * with recent `pending` top-up receipt amounts.
   */
  async allocateUniquePayableAmount(
    requestedAmount: number,
    options: UniquePayableAmountOptions = {}
  ): Promise<UniquePayableAmountAllocation> {
    let existingPendingAmounts: Iterable<number>;

    if (options.existingPendingAmounts !== undefined) {
      existingPendingAmounts = options.existingPendingAmounts;
    } else if (options.skipDbLookup) {
      existingPendingAmounts = [];
    } else {
      existingPendingAmounts = await this.loadRecentPendingReceiptAmounts(
        options.lookbackHours ?? DEFAULT_PENDING_LOOKBACK_HOURS
      );
    }

    return computeUniquePayableAmount(requestedAmount, existingPendingAmounts, options);
  }

  private async loadRecentPendingReceiptAmounts(lookbackHours: number): Promise<number[]> {
    const safeHours =
      Number.isFinite(lookbackHours) && lookbackHours > 0
        ? lookbackHours
        : DEFAULT_PENDING_LOOKBACK_HOURS;
    const cutoff = new Date(Date.now() - safeHours * 60 * 60 * 1000);
    try {
      const db = getDb();
      const rows = await db
        .select({ amount: topupReceipts.amount })
        .from(topupReceipts)
        .where(and(eq(topupReceipts.status, 'pending'), gte(topupReceipts.createdAt, cutoff)));
      return rows.map((row) => row.amount);
    } catch (err) {
      logger.warn(
        { err },
        'Could not load recent pending receipt amounts; continuing without DB set'
      );
      return [];
    }
  }

  private ensureDailyUsageWindow(now: Date): void {
    const dayKey = resolveTehranDayKey(now);
    if (this.dailyUsageDayKey !== dayKey) {
      this.dailyUsageDayKey = dayKey;
      this.dailyUsageByCard.clear();
    }
  }
}
