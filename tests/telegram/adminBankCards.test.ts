import { describe, expect, it, vi } from 'vitest';
import {
  PaymentService,
  detectIranianBankName,
  generateBankCardId,
  hasDuplicateCardNumber,
  isValidBankCardNumber,
  isValidLuhnCardNumber,
  maskCardNumberShort,
  normalizeCardNumber,
  serializeBankCardsJson,
  type BankCardConfig,
} from '../../src/domain/services/PaymentService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import {
  adminBankCardsConversation,
  adminEditSettingsConversation,
  adminPaymentSettingsConversation,
  buildBankCardDetailKeyboard,
  buildBankCardDetailScreen,
  buildBankCardsListKeyboard,
  buildBankCardsListScreen,
  displayAdminSettingValue,
  validateAdminSetting,
} from '../../src/telegram/conversations/adminConversations/settings.js';
import {
  formatCardNumberGrouped,
  topupConversation,
} from '../../src/telegram/conversations/adminConversations/wallet.js';
import { isAdminCallbackData } from '../../src/telegram/botRuntime.js';
import { validateTelegramMarkdown } from '../../src/telegram/rendering.js';
import {
  CONFIGURATION_DEFAULTS,
  DEFAULT_SETTINGS,
} from '../../src/domain/services/TranslationCatalog.js';
import type { ConversationContext } from '../../src/telegram/types.js';
import { createMockServices } from './helpers/botHarness.js';
import { createConversationHarness } from './helpers/conversationHarness.js';

function createRealTranslationService(initialSettings: Record<string, string> = {}) {
  const settings = new Map<string, string>([
    ...Object.entries(CONFIGURATION_DEFAULTS),
    ...Object.entries(initialSettings),
  ]);

  const service = {
    resolveLocale: vi.fn((locale?: string | null) =>
      locale?.toLowerCase().startsWith('en') ? 'en' : 'fa'
    ),
    getDefaultLocale: vi.fn(() => 'fa' as const),
    get: vi.fn(
      (key: string, locale: 'fa' | 'en' = 'fa', params?: Record<string, string | number>) => {
        const qualified = `${locale}.${key}`;
        let template = DEFAULT_SETTINGS[qualified] ?? DEFAULT_SETTINGS[`fa.${key}`] ?? key;
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            template = template.replaceAll(`{${k}}`, String(v));
          }
        }
        return template;
      }
    ),
    getSetting: vi.fn((key: string, fallback = '') => settings.get(key) ?? fallback),
    getSettingBool: vi.fn((key: string, fallback = false) => {
      const val = settings.get(key);
      if (val === undefined) return fallback;
      return val === 'true' || val === '1';
    }),
    getSettingNum: vi.fn((key: string, fallback = 0) => {
      const val = settings.get(key);
      if (val === undefined) return fallback;
      const num = Number(val);
      return Number.isFinite(num) ? num : fallback;
    }),
    updateSetting: vi.fn(async (key: string, value: string) => {
      settings.set(key, value);
    }),
    updateSettings: vi.fn(async (entries: Record<string, string>) => {
      for (const [k, v] of Object.entries(entries)) {
        settings.set(k, v);
      }
    }),
  };

  return { service: service as unknown as TranslationService, settings };
}

function extractCallbacks(replyMarkup: unknown): string[] {
  if (!replyMarkup || typeof replyMarkup !== 'object' || !('inline_keyboard' in replyMarkup)) {
    return [];
  }
  const rows = (replyMarkup as { inline_keyboard: Array<Array<{ callback_data?: string }>> })
    .inline_keyboard;
  return rows.flatMap((row) =>
    row.map((btn) => btn.callback_data).filter((d): d is string => Boolean(d))
  );
}

describe('Bank Cards Domain Utilities & Iranian BIN Detection', () => {
  it('normalizes Persian/Arabic numerals, dashes, spaces, and BiDi LRM characters copied from Telegram', () => {
    expect(normalizeCardNumber('\u200E6037 \u200E6981 \u200E1130 \u200E6846')).toBe(
      '6037698111306846'
    );
    expect(normalizeCardNumber('۶۰۳۷-۶۹۸۱-۱۱۳۰-۶۸۴۶')).toBe('6037698111306846');
    expect(normalizeCardNumber('٦٠٣٧–٩٩٧٩—١١١١−٢٢٢٢')).toBe('6037997911112222');
    expect(isValidBankCardNumber('۶۰۳۷-۶۹۸۱-۱۱۳۰-۶۸۴۶')).toBe(true);
    expect(isValidBankCardNumber('1234')).toBe(false);
    expect(validateAdminSetting('card_number', '\u200E6037 \u200E6981 \u200E1130 \u200E6846')).toBe(
      '6037698111306846'
    );
  });

  it('formats 16-digit Persian/Arabic card numbers into LRM-prefixed 4-digit groups', () => {
    expect(formatCardNumberGrouped('۶۰۳۷-۹۹۱۸-۱۲۳۴-۵۶۷۸')).toBe(
      '\u200E6037 \u200E9918 \u200E1234 \u200E5678'
    );
  });

  it('detects Iranian Shetab banks including 8-digit Blu Bank before 6-digit Saman Bank', () => {
    expect(detectIranianBankName('6037698111306846', 'fa')).toBe('بانک صادرات');
    expect(detectIranianBankName('6037698111306846', 'en')).toBe('Bank Saderat');
    expect(detectIranianBankName('6219861912345678', 'fa')).toBe('بلوبانک (سامان)');
    expect(detectIranianBankName('6219861012345678', 'fa')).toBe('بانک سامان');
    expect(detectIranianBankName('6037997911112222', 'fa')).toBe('بانک ملی');
    expect(detectIranianBankName('9999991111222233', 'fa')).toBeUndefined();
  });

  it('validates Luhn checksum, generates compact unique IDs, masks numbers, and checks duplicates', () => {
    // 6037991111111111 -> compute valid Luhn card: 4000000000000002 is valid Luhn
    expect(isValidLuhnCardNumber('4000000000000002')).toBe(true);
    expect(isValidLuhnCardNumber('4000000000000003')).toBe(false);
    expect(maskCardNumberShort('6037698111306846')).toBe('•••• 6846');

    const id1 = generateBankCardId([]);
    expect(id1).toBe('card_1');
    const id2 = generateBankCardId([{ id: 'card_1' }]);
    expect(id2).toBe('card_2');

    const cards: BankCardConfig[] = [
      { id: 'card_1', cardNumber: '6037698111306846', cardHolder: 'Hossein', enabled: true },
    ];
    expect(hasDuplicateCardNumber(cards, '۶۰۳۷-۶۹۸۱-۱۱۳۰-۶۸۴۶')).toBe(true);
    expect(hasDuplicateCardNumber(cards, '6037698111306846', 'card_1')).toBe(false);
    expect(isAdminCallbackData('bc:o:card_1')).toBe(true);
  });
});

describe('Interactive Admin Bank Cards Manager & Payment Settings', () => {
  it('opens the interactive Bank Cards Manager from Payment Settings instead of raw JSON prompt, imports legacy card, adds/edits/toggles/reorders/deletes cards', async () => {
    const { service: ts, settings } = createRealTranslationService({
      card_number: '6037698111306846',
      card_holder: 'Hossein Karimi',
      bank_cards_json: '[]',
    });
    const paymentService = new PaymentService(ts);
    const services = createMockServices({
      adminIds: [1],
      translationService: ts as unknown as Record<string, unknown>,
    });
    services.paymentService = paymentService;

    const harness = createConversationHarness({
      services,
      defaultLocale: 'fa',
      conversations: [
        ['adminPaymentSettingsConversation', adminPaymentSettingsConversation],
        ['adminBankCardsConversation', adminBankCardsConversation],
        ['adminEditSettingsConversation', adminEditSettingsConversation],
      ],
    });
    harness.bot.command('pay', async (ctx) => {
      await ctx.conversation.enter('adminPaymentSettingsConversation');
    });

    const lastRenderedText = () =>
      String(
        harness.apiCalls
          .filter((c) => c.method === 'editMessageText' || c.method === 'sendMessage')
          .at(-1)?.payload.text
      );

    // 1. Open Payment Settings -> verify clean summary (no raw "[]")
    await harness.sendText('/pay', { userId: 1 });
    const payScreen = lastRenderedText();
    expect(validateTelegramMarkdown(payScreen).valid).toBe(true);
    expect(payScreen).not.toContain('[]');
    expect(payScreen).toContain('حالت تک‌کارت');

    // 2. Click Manage Bank Cards -> opens interactive Bank Cards Manager (NEVER raw "مقدار جدید:")
    await harness.sendCallback('pay:cards', { userId: 1 });
    const managerText = lastRenderedText();
    expect(validateTelegramMarkdown(managerText).valid).toBe(true);
    expect(managerText).toContain('کارت‌های بانکی');
    expect(managerText).not.toContain('مقدار جدید:');
    expect(managerText).not.toContain('\\[');

    // 3. Import legacy default card in one tap
    await harness.sendCallback('bc:imp', { userId: 1 });
    expect(paymentService.getConfiguredBankCards()).toHaveLength(1);
    expect(paymentService.getConfiguredBankCards()[0]).toMatchObject({
      cardNumber: '6037698111306846',
      cardHolder: 'Hossein Karimi',
      bankName: 'بانک صادرات',
      enabled: true,
    });

    // 4. Add second card via guided wizard (Persian digits + Luhn check confirm + auto bank + daily cap preset)
    await harness.sendCallback('bc:add', { userId: 1 });
    await harness.sendText('۶۲۱۹-۸۶۱۹-۱۱۱۱-۲۲۲۲', { userId: 1 });
    // If Luhn failed, confirm keeping the number
    if (lastRenderedText().includes('Luhn')) {
      await harness.sendCallback('bc:luhn:ok', { userId: 1 });
    }
    await harness.sendText('علی رضایی', { userId: 1 });
    await harness.sendCallback('bc:bank:auto', { userId: 1 });
    await harness.sendCallback('bc:cap:5000000', { userId: 1 });

    const cardsAfterAdd = paymentService.getConfiguredBankCards();
    expect(cardsAfterAdd).toHaveLength(2);
    expect(cardsAfterAdd[1]).toMatchObject({
      cardNumber: '6219861911112222',
      cardHolder: 'علی رضایی',
      bankName: 'بلوبانک (سامان)',
      dailyCapToman: 5_000_000,
      enabled: true,
    });

    // 5. Open card 2 detail -> toggle disabled -> move up -> delete with confirmation
    const card2Id = cardsAfterAdd[1]!.id;
    await harness.sendCallback(`bc:o:${card2Id}`, { userId: 1 });
    await harness.sendCallback(`bc:tg:${card2Id}`, { userId: 1 });
    expect(paymentService.getConfiguredBankCards().find((c) => c.id === card2Id)?.enabled).toBe(
      false
    );

    await harness.sendCallback(`bc:up:${card2Id}`, { userId: 1 });
    expect(paymentService.getConfiguredBankCards()[0]?.id).toBe(card2Id);

    await harness.sendCallback(`bc:del:${card2Id}`, { userId: 1 });
    await harness.sendCallback(`bc:dc:${card2Id}`, { userId: 1 });
    expect(paymentService.getConfiguredBankCards()).toHaveLength(1);

    // 6. Back to payment settings and toggle unique topup amount
    await harness.sendCallback('bc:back', { userId: 1 });
    await harness.sendCallback('pay:toggle:unique_amount', { userId: 1 });
    expect(settings.get('unique_topup_amount_enabled')).toBe('true');

    await harness.sendCallback('conversation:cancel', { userId: 1 });
  });

  it('keeps all Bank Cards Manager screens valid Markdown and all callback_data within 64 bytes', () => {
    const { service: ts } = createRealTranslationService();
    const fakeCtx = {
      from: { id: 1, is_bot: false, first_name: 'Admin', language_code: 'fa' },
      userLocale: 'fa',
      services: { translationService: ts },
    } as unknown as ConversationContext;

    const statusCards = [
      {
        id: 'card_1',
        cardNumber: '6037698111306846',
        cardHolder: 'Hossein_Karimi*`[Test]',
        bankName: 'بانک صادرات',
        enabled: true,
        dailyCapToman: 5_000_000,
        dailyUsageToman: 5_000_000,
        remainingCapToman: 0,
        isCapReached: true,
        detectedBankName: 'بانک صادرات',
        luhnValid: true,
      },
      {
        id: 'card_2',
        cardNumber: '6219861911112222',
        cardHolder: 'Reza',
        enabled: false,
        dailyCapToman: null,
        dailyUsageToman: 0,
        remainingCapToman: null,
        isCapReached: false,
        detectedBankName: 'بلوبانک (سامان)',
        luhnValid: false,
      },
    ];

    const listScreen = buildBankCardsListScreen(fakeCtx, statusCards, {
      allCards: statusCards,
      legacyCard: null,
      page: 0,
      totalPages: 2,
    });
    expect(validateTelegramMarkdown(listScreen).valid).toBe(true);

    const listKb = buildBankCardsListKeyboard(fakeCtx, statusCards, {
      totalCards: statusCards.length,
      hasLegacyImport: false,
      page: 0,
      totalPages: 2,
    });
    for (const cb of extractCallbacks(listKb)) {
      expect(Buffer.byteLength(cb, 'utf8')).toBeLessThanOrEqual(64);
    }

    const detailScreen = buildBankCardDetailScreen(fakeCtx, statusCards[0]!, 0, 2);
    expect(validateTelegramMarkdown(detailScreen).valid).toBe(true);

    const detailKb = buildBankCardDetailKeyboard(fakeCtx, statusCards[0]!, 0, 2);
    for (const cb of extractCallbacks(detailKb)) {
      expect(Buffer.byteLength(cb, 'utf8')).toBeLessThanOrEqual(64);
    }

    // Also verify displayAdminSettingValue renders localized count summary instead of bare digit
    ts.updateSetting('bank_cards_json', serializeBankCardsJson(statusCards));
    expect(displayAdminSettingValue(fakeCtx, 'bank_cards_json')).toContain('فعال');
  });
});

describe('Topup Flow Multi-Card Selection, Daily Caps & Receipt Card Attribution', () => {
  it('switches to an eligible card when requested amount exceeds initial card cap, records daily usage, and tags receipt + admin alert with card details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ ok: false }),
      } as unknown as Response)
    );

    const cards: BankCardConfig[] = [
      {
        id: 'card_small',
        cardNumber: '6037698111306846',
        cardHolder: 'Small Cap Holder',
        bankName: 'بانک صادرات',
        enabled: true,
        dailyCapToman: 100_000,
      },
      {
        id: 'card_big',
        cardNumber: '6037997911112222',
        cardHolder: 'Big Cap Holder',
        bankName: 'بانک ملی',
        enabled: true,
        dailyCapToman: 5_000_000,
      },
    ];
    const { service: ts } = createRealTranslationService({
      bank_cards_json: serializeBankCardsJson(cards),
      card_number: '',
      topup_min_amount: '10000',
      topup_max_amount: '10000000',
    });
    const paymentService = new PaymentService(ts);
    // Simulate card_small already used 80,000 today (only 20,000 remaining)
    paymentService.recordCardDailyUsage('card_small', 80_000);

    const submitTopupReceiptDetailed = vi.fn().mockResolvedValue({
      receiptId: 'rec_card_1',
      duplicateOfReceiptId: null,
    });

    const services = createMockServices({
      adminIds: [999],
      translationService: ts as unknown as Record<string, unknown>,
      walletService: { submitTopupReceiptDetailed },
    });
    services.paymentService = paymentService;

    const harness = createConversationHarness({
      services,
      defaultLocale: 'fa',
      conversations: [['topupConversation', topupConversation]],
    });
    harness.bot.command('topup', async (ctx) => {
      await ctx.conversation.enter('topupConversation');
    });

    await harness.sendText('/topup', { userId: 42 });
    // User requests 200,000 -> exceeds card_small remaining cap (20,000) -> must switch to card_big!
    await harness.sendText('200000', { userId: 42 });

    const receiptPrompt = String(harness.callsFor('sendMessage').at(-1)?.payload.text);
    expect(receiptPrompt).toContain('Big Cap Holder');
    expect(receiptPrompt).toContain('بانک ملی');

    await harness.sendPhoto('photo_123', { userId: 42 });
    await harness.sendCallback('topup:confirm', { userId: 42, isCaptionMessage: true });

    expect(submitTopupReceiptDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: 42,
        amount: 200_000,
        cardId: 'card_big',
        cardNumber: '6037997911112222',
      })
    );
    expect(paymentService.getCardDailyUsage('card_big')).toBe(200_000);

    const adminPhoto = harness.callsFor('sendPhoto').find((c) => c.payload.chat_id === 999);
    expect(String(adminPhoto?.payload.caption)).toContain('بانک ملی');
    expect(String(adminPhoto?.payload.caption)).toContain('2222');
  });

  it('shows a clean daily-cap-reached message instead of "—" when all active cards have reached their daily cap', async () => {
    const { service: ts } = createRealTranslationService({
      bank_cards_json: serializeBankCardsJson([
        {
          id: 'card_full',
          cardNumber: '6037698111306846',
          cardHolder: 'Full Card',
          enabled: true,
          dailyCapToman: 100_000,
        },
      ]),
      card_number: '',
    });
    const paymentService = new PaymentService(ts);
    // Exactly at daily cap (100,000 / 100,000) -> remaining is 0 -> must be treated as cap reached!
    paymentService.recordCardDailyUsage('card_full', 100_000);

    const services = createMockServices({
      adminIds: [999],
      translationService: ts as unknown as Record<string, unknown>,
    });
    services.paymentService = paymentService;

    const harness = createConversationHarness({
      services,
      defaultLocale: 'fa',
      conversations: [['topupConversation', topupConversation]],
    });
    harness.bot.command('topup', async (ctx) => {
      await ctx.conversation.enter('topupConversation');
    });

    await harness.sendText('/topup', { userId: 55 });
    const msg = String(harness.callsFor('sendMessage').at(-1)?.payload.text);
    expect(msg).toContain('سقف روزانه');
    expect(msg).not.toContain('`—`');
  });
});
