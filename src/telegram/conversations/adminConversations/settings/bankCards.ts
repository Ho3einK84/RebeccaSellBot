import { InlineKeyboard } from 'grammy';
import {
  detectIranianBankName,
  generateBankCardId,
  hasDuplicateCardNumber,
  isValidBankCardNumber,
  isValidLuhnCardNumber,
  maskCardNumberShort,
  MAX_BANK_CARDS,
  normalizeCardNumber,
  parseBankCardsJson,
  serializeBankCardsJson,
  type BankCardConfig,
  type BankCardStatus,
} from '../../../../domain/services/PaymentService.js';
import { logger } from '../../../../infra/logger.js';
import type { ConversationContext, MyConversation } from '../../../types.js';
import {
  localizedNumber,
  normalizeInputDigits,
  resolveContextLocale,
  t,
  tm,
} from '../../../locale.js';
import { callbackData } from '../../../callbackData.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../../rendering.js';
import { buildEmptyState, buildPromptScreen, buildScreen } from '../../../ui.js';
import { renderSalesMenu } from '../../../keyboards/adminMenu.js';
import { showReceiptQueue } from '../../../features/admin/receiptRoutes.js';
import { requireAdmin } from '../shared.js';
import { formatCardNumberGrouped } from '../wallet.js';
import { renderSettingsScreen, waitForSettingsInput } from './navigation.js';
import { truncateButtonLabel } from './presentation.js';

export type BankCardsManagerOutcome = 'back' | 'cancel';
type StepResult<T> = { type: 'value'; value: T } | { type: 'back' } | { type: 'cancel' };

const CARDS_PAGE_SIZE = 6;
const DAILY_CAP_PRESETS = [5_000_000, 10_000_000, 20_000_000, 50_000_000] as const;

export async function adminBankCardsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx))) return;

  const returnTo = await conversation.external((outsideCtx) => {
    const dest = outsideCtx.session.bankCardsReturnTo;
    delete outsideCtx.session.bankCardsReturnTo;
    return dest === 'receipts' ? ('receipts' as const) : ('sales' as const);
  });

  const outcome = await manageBankCards(conversation, ctx);
  if (outcome === 'cancel') return;

  await conversation.external(async (outsideCtx) => {
    if (returnTo === 'receipts') {
      await showReceiptQueue(outsideCtx, 1);
    } else {
      await renderSalesMenu(outsideCtx);
    }
  });
}

export async function manageBankCards(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<BankCardsManagerOutcome> {
  if (!ctx.services) return 'cancel';

  let activeCtx = ctx;
  let page = 0;

  for (;;) {
    const snapshot = await conversation.external(async (outsideCtx) =>
      loadBankCardsSnapshot(outsideCtx?.services ? outsideCtx : activeCtx)
    );
    const { cards, legacyCard } = snapshot;

    const totalPages = Math.max(1, Math.ceil(cards.length / CARDS_PAGE_SIZE));
    page = Math.min(Math.max(0, page), totalPages - 1);
    const visibleCards = cards.slice(page * CARDS_PAGE_SIZE, (page + 1) * CARDS_PAGE_SIZE);

    const screenText = buildBankCardsListScreen(activeCtx, visibleCards, {
      allCards: cards,
      legacyCard,
      page,
      totalPages,
    });
    const keyboard = buildBankCardsListKeyboard(activeCtx, visibleCards, {
      totalCards: cards.length,
      hasLegacyImport: cards.length === 0 && Boolean(legacyCard),
      page,
      totalPages,
    });

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['bc:o:', 'bc:p:', 'bc:add', 'bc:imp'],
      backCallbacks: ['bc:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return 'cancel';
    if (input.type === 'back') return 'back';
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data.startsWith('bc:p:')) {
      const parsedPage = Number(input.data.slice('bc:p:'.length));
      if (Number.isSafeInteger(parsedPage) && parsedPage >= 0 && parsedPage < totalPages) {
        page = parsedPage;
      }
      continue;
    }

    if (input.data === 'bc:imp') {
      if (!legacyCard || cards.length > 0) continue;
      const locale = resolveContextLocale(activeCtx);
      const detectedBank = detectIranianBankName(legacyCard.cardNumber, locale);
      const imported: BankCardConfig = {
        id: generateBankCardId([]),
        cardNumber: legacyCard.cardNumber,
        cardHolder: legacyCard.cardHolder || '—',
        enabled: true,
        dailyCapToman: null,
        ...(detectedBank ? { bankName: detectedBank } : {}),
      };
      const saved = await persistBankCards(conversation, activeCtx, [imported]);
      if (saved === 'cancel') return 'cancel';
      continue;
    }

    if (input.data === 'bc:add') {
      if (cards.length >= MAX_BANK_CARDS) {
        const noticeOutcome = await showBankCardsNotice(
          conversation,
          activeCtx,
          buildEmptyState(
            '⚠️',
            t(activeCtx, 'admin_sales_bank_cards_title'),
            t(activeCtx, 'admin_bank_cards_limit_reached', {
              count: localizedNumber(MAX_BANK_CARDS, activeCtx),
            })
          )
        );
        if (noticeOutcome === 'cancel') return 'cancel';
        continue;
      }

      const created = await promptNewBankCard(conversation, activeCtx, cards);
      if (created.type === 'cancel') return 'cancel';
      if (created.type === 'back') continue;

      const nextCards: BankCardConfig[] = [...cards.map(stripCardStatus), created.value];
      const saved = await persistBankCards(conversation, activeCtx, nextCards);
      if (saved === 'cancel') return 'cancel';
      page = Math.max(0, Math.ceil(nextCards.length / CARDS_PAGE_SIZE) - 1);
      continue;
    }

    if (input.data.startsWith('bc:o:')) {
      const cardId = input.data.slice('bc:o:'.length);
      if (!cards.some((card) => card.id === cardId)) continue;
      const detailOutcome = await manageSingleBankCard(conversation, activeCtx, cardId);
      if (detailOutcome.type === 'cancel') return 'cancel';
      activeCtx = detailOutcome.activeCtx;
    }
  }
}

async function manageSingleBankCard(
  conversation: MyConversation,
  initialCtx: ConversationContext,
  cardId: string
): Promise<{ type: 'cancel' } | { type: 'done'; activeCtx: ConversationContext }> {
  let activeCtx = initialCtx;

  for (;;) {
    const snapshot = await conversation.external(async (outsideCtx) =>
      loadBankCardsSnapshot(outsideCtx?.services ? outsideCtx : activeCtx)
    );
    const index = snapshot.cards.findIndex((card) => card.id === cardId);
    if (index === -1) {
      return { type: 'done', activeCtx };
    }
    const card = snapshot.cards[index]!;
    const rawCards = snapshot.cards.map(stripCardStatus);

    const screenText = buildBankCardDetailScreen(activeCtx, card, index, snapshot.cards.length);
    const keyboard = buildBankCardDetailKeyboard(activeCtx, card, index, snapshot.cards.length);

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: [
        'bc:en:',
        'bc:eh:',
        'bc:eb:',
        'bc:ec:',
        'bc:tg:',
        'bc:up:',
        'bc:dn:',
        'bc:del:',
      ],
      backCallbacks: ['bc:list'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return { type: 'cancel' };
    if (input.type === 'back') return { type: 'done', activeCtx: input.ctx ?? activeCtx };
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === `bc:tg:${cardId}`) {
      const nextCards = rawCards.map((item) =>
        item.id === cardId ? { ...item, enabled: !item.enabled } : item
      );
      const saved = await persistBankCards(conversation, activeCtx, nextCards);
      if (saved === 'cancel') return { type: 'cancel' };
      continue;
    }

    if (input.data === `bc:up:${cardId}` || input.data === `bc:dn:${cardId}`) {
      const delta = input.data.startsWith('bc:up:') ? -1 : 1;
      const targetIndex = index + delta;
      if (targetIndex >= 0 && targetIndex < rawCards.length) {
        const nextCards = [...rawCards];
        const [moved] = nextCards.splice(index, 1);
        nextCards.splice(targetIndex, 0, moved!);
        const saved = await persistBankCards(conversation, activeCtx, nextCards);
        if (saved === 'cancel') return { type: 'cancel' };
      }
      continue;
    }

    if (input.data === `bc:en:${cardId}`) {
      const res = await promptCardNumber(conversation, activeCtx, rawCards, cardId);
      if (res.type === 'cancel') return { type: 'cancel' };
      if (res.type === 'back') continue;

      const locale = resolveContextLocale(activeCtx);
      const nextAutoBank = detectIranianBankName(res.value, locale);
      const prevAutoBank = detectIranianBankName(card.cardNumber, locale);
      const nextCards = rawCards.map((item) => {
        if (item.id !== cardId) return item;
        const shouldReplaceBank =
          !item.bankName || (prevAutoBank && item.bankName === prevAutoBank);
        const updated: BankCardConfig = {
          id: item.id,
          cardNumber: res.value,
          cardHolder: item.cardHolder,
          enabled: item.enabled,
          dailyCapToman: item.dailyCapToman ?? null,
        };
        const resolvedBank = shouldReplaceBank ? nextAutoBank : item.bankName;
        if (resolvedBank) updated.bankName = resolvedBank;
        return updated;
      });
      const saved = await persistBankCards(conversation, activeCtx, nextCards);
      if (saved === 'cancel') return { type: 'cancel' };
      continue;
    }

    if (input.data === `bc:eh:${cardId}`) {
      const res = await promptCardHolder(conversation, activeCtx);
      if (res.type === 'cancel') return { type: 'cancel' };
      if (res.type === 'back') continue;

      const nextCards = rawCards.map((item) =>
        item.id === cardId ? { ...item, cardHolder: res.value } : item
      );
      const saved = await persistBankCards(conversation, activeCtx, nextCards);
      if (saved === 'cancel') return { type: 'cancel' };
      continue;
    }

    if (input.data === `bc:eb:${cardId}`) {
      const res = await promptCardBankName(conversation, activeCtx, card.cardNumber);
      if (res.type === 'cancel') return { type: 'cancel' };
      if (res.type === 'back') continue;

      const nextCards = rawCards.map((item) => {
        if (item.id !== cardId) return item;
        const updated: BankCardConfig = {
          id: item.id,
          cardNumber: item.cardNumber,
          cardHolder: item.cardHolder,
          enabled: item.enabled,
          dailyCapToman: item.dailyCapToman ?? null,
        };
        if (res.value) updated.bankName = res.value;
        return updated;
      });
      const saved = await persistBankCards(conversation, activeCtx, nextCards);
      if (saved === 'cancel') return { type: 'cancel' };
      continue;
    }

    if (input.data === `bc:ec:${cardId}`) {
      const res = await promptCardDailyCap(conversation, activeCtx);
      if (res.type === 'cancel') return { type: 'cancel' };
      if (res.type === 'back') continue;

      const nextCards = rawCards.map((item) =>
        item.id === cardId ? { ...item, dailyCapToman: res.value } : item
      );
      const saved = await persistBankCards(conversation, activeCtx, nextCards);
      if (saved === 'cancel') return { type: 'cancel' };
      continue;
    }

    if (input.data === `bc:del:${cardId}`) {
      const confirmKb = new InlineKeyboard()
        .text(
          t(activeCtx, 'admin_bank_cards_delete_confirm_button'),
          callbackData('bc', 'dc', cardId)
        )
        .row()
        .text(t(activeCtx, 'menu_cancel'), 'bc:delcancel');

      const confirmText = buildPromptScreen(
        '🗑️',
        t(activeCtx, 'admin_bank_cards_delete_title'),
        tm(
          activeCtx,
          'admin_bank_cards_delete_confirm_prompt',
          {
            card: sanitizeTelegramInlineCode(formatCardNumberGrouped(card.cardNumber)),
            holder: card.cardHolder || '—',
          },
          ['card']
        )
      );

      await renderSettingsScreen(conversation, activeCtx, confirmText, confirmKb);

      const confirmInput = await waitForSettingsInput(conversation, {
        callbackPrefixes: ['bc:dc:'],
        backCallbacks: ['bc:delcancel'],
        retryKeyboard: confirmKb,
      });

      if (confirmInput.type === 'cancel') return { type: 'cancel' };
      if (confirmInput.type === 'back') {
        if (confirmInput.ctx) activeCtx = confirmInput.ctx;
        continue;
      }
      if (
        confirmInput.type === 'callback' &&
        confirmInput.data === callbackData('bc', 'dc', cardId)
      ) {
        activeCtx = confirmInput.ctx;
        const nextCards = rawCards.filter((item) => item.id !== cardId);
        const saved = await persistBankCards(conversation, activeCtx, nextCards);
        if (saved === 'cancel') return { type: 'cancel' };
        return { type: 'done', activeCtx };
      }
    }
  }
}

async function promptNewBankCard(
  conversation: MyConversation,
  ctx: ConversationContext,
  existingCards: readonly BankCardConfig[]
): Promise<StepResult<BankCardConfig>> {
  const numberResult = await promptCardNumber(conversation, ctx, existingCards);
  if (numberResult.type !== 'value') return numberResult;

  const holderResult = await promptCardHolder(conversation, ctx);
  if (holderResult.type !== 'value') return holderResult;

  const bankResult = await promptCardBankName(conversation, ctx, numberResult.value);
  if (bankResult.type !== 'value') return bankResult;

  const capResult = await promptCardDailyCap(conversation, ctx);
  if (capResult.type !== 'value') return capResult;

  return {
    type: 'value',
    value: {
      id: generateBankCardId(existingCards),
      cardNumber: numberResult.value,
      cardHolder: holderResult.value,
      enabled: true,
      dailyCapToman: capResult.value,
      ...(bankResult.value ? { bankName: bankResult.value } : {}),
    },
  };
}

async function promptCardNumber(
  conversation: MyConversation,
  ctx: ConversationContext,
  existingCards: readonly BankCardConfig[],
  excludeCardId?: string
): Promise<StepResult<string>> {
  const backKb = new InlineKeyboard().text(t(ctx, 'menu_back'), 'bc:step:back');
  let activeCtx = ctx;
  let errorBanner: string | undefined;

  for (;;) {
    const body = errorBanner
      ? `${errorBanner}\n\n${t(activeCtx, 'admin_bank_cards_prompt_number')}`
      : t(activeCtx, 'admin_bank_cards_prompt_number');
    await renderSettingsScreen(
      conversation,
      activeCtx,
      buildPromptScreen('💳', t(activeCtx, 'admin_setting_card_number'), body),
      backKb
    );

    const input = await waitForSettingsInput(conversation, {
      allowText: true,
      backCallbacks: ['bc:step:back'],
      retryKeyboard: backKb,
    });
    if (input.type === 'cancel') return { type: 'cancel' };
    if (input.type === 'back') return { type: 'back' };
    if (input.type !== 'text') continue;
    activeCtx = input.ctx;

    const normalized = normalizeCardNumber(input.value);
    if (!isValidBankCardNumber(normalized)) {
      errorBanner = t(activeCtx, 'admin_setting_card_invalid');
      continue;
    }

    if (hasDuplicateCardNumber(existingCards, normalized, excludeCardId)) {
      errorBanner = t(activeCtx, 'admin_bank_cards_duplicate_number');
      continue;
    }

    errorBanner = undefined;

    if (normalized.length === 16 && !isValidLuhnCardNumber(normalized)) {
      const luhnKb = new InlineKeyboard()
        .text(t(activeCtx, 'admin_bank_cards_luhn_confirm_button'), 'bc:luhn:ok')
        .row()
        .text(t(activeCtx, 'admin_bank_cards_luhn_retry_button'), 'bc:luhn:retry')
        .row()
        .text(t(activeCtx, 'menu_back'), 'bc:step:back');

      await renderSettingsScreen(
        conversation,
        activeCtx,
        buildPromptScreen(
          '🔎',
          t(activeCtx, 'admin_bank_cards_luhn_warning_title'),
          tm(
            activeCtx,
            'admin_bank_cards_luhn_warning_body',
            { card: sanitizeTelegramInlineCode(formatCardNumberGrouped(normalized)) },
            ['card']
          )
        ),
        luhnKb
      );

      const luhnInput = await waitForSettingsInput(conversation, {
        callbackPrefixes: ['bc:luhn:'],
        backCallbacks: ['bc:step:back'],
        retryKeyboard: luhnKb,
      });
      if (luhnInput.type === 'cancel') return { type: 'cancel' };
      if (luhnInput.type === 'back') return { type: 'back' };
      if (luhnInput.type === 'callback' && luhnInput.data === 'bc:luhn:ok') {
        return { type: 'value', value: normalized };
      }
      if (luhnInput.type === 'callback') activeCtx = luhnInput.ctx;
      continue;
    }

    return { type: 'value', value: normalized };
  }
}

async function promptCardHolder(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<StepResult<string>> {
  const backKb = new InlineKeyboard().text(t(ctx, 'menu_back'), 'bc:step:back');
  let activeCtx = ctx;
  let errorBanner: string | undefined;

  for (;;) {
    const body = errorBanner
      ? `${errorBanner}\n\n${t(activeCtx, 'admin_bank_cards_prompt_holder')}`
      : t(activeCtx, 'admin_bank_cards_prompt_holder');
    await renderSettingsScreen(
      conversation,
      activeCtx,
      buildPromptScreen('👤', t(activeCtx, 'admin_setting_card_holder'), body),
      backKb
    );

    const input = await waitForSettingsInput(conversation, {
      allowText: true,
      backCallbacks: ['bc:step:back'],
      retryKeyboard: backKb,
    });
    if (input.type === 'cancel') return { type: 'cancel' };
    if (input.type === 'back') return { type: 'back' };
    if (input.type !== 'text') continue;
    activeCtx = input.ctx;

    const trimmed = input.value.trim();
    if (trimmed.length >= 1 && trimmed.length <= 120) {
      return { type: 'value', value: trimmed };
    }

    errorBanner = t(activeCtx, 'admin_bank_cards_holder_invalid');
  }
}

async function promptCardBankName(
  conversation: MyConversation,
  ctx: ConversationContext,
  cardNumber: string
): Promise<StepResult<string | undefined>> {
  const locale = resolveContextLocale(ctx);
  const autoBank = detectIranianBankName(cardNumber, locale);

  const kb = new InlineKeyboard();
  if (autoBank) {
    kb.text(
      truncateButtonLabel(t(ctx, 'admin_bank_cards_bank_auto_button', { bank: autoBank }), 60),
      'bc:bank:auto'
    ).row();
  }
  kb.text(t(ctx, 'admin_bank_cards_bank_skip_button'), 'bc:bank:skip')
    .row()
    .text(t(ctx, 'menu_back'), 'bc:step:back');

  let activeCtx = ctx;
  let errorBanner: string | undefined;

  for (;;) {
    const body = errorBanner
      ? `${errorBanner}\n\n${t(activeCtx, 'admin_bank_cards_prompt_bank')}`
      : t(activeCtx, 'admin_bank_cards_prompt_bank');
    await renderSettingsScreen(
      conversation,
      activeCtx,
      buildPromptScreen('🏦', t(activeCtx, 'topup_card_bank_label'), body),
      kb
    );

    const input = await waitForSettingsInput(conversation, {
      allowText: true,
      callbackPrefixes: ['bc:bank:'],
      backCallbacks: ['bc:step:back'],
      retryKeyboard: kb,
    });
    if (input.type === 'cancel') return { type: 'cancel' };
    if (input.type === 'back') return { type: 'back' };
    if (input.type === 'callback') {
      if (input.data === 'bc:bank:auto' && autoBank) {
        return { type: 'value', value: autoBank };
      }
      if (input.data === 'bc:bank:skip') {
        return { type: 'value', value: undefined };
      }
      continue;
    }
    activeCtx = input.ctx;

    const trimmed = input.value.trim();
    if (trimmed.length === 0) return { type: 'value', value: undefined };
    if (trimmed.length <= 60) return { type: 'value', value: trimmed };

    errorBanner = t(activeCtx, 'admin_bank_cards_bank_invalid');
  }
}

async function promptCardDailyCap(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<StepResult<number | null>> {
  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_bank_cards_cap_unlimited_button'), 'bc:cap:none')
    .row();

  for (let i = 0; i < DAILY_CAP_PRESETS.length; i += 2) {
    const first = DAILY_CAP_PRESETS[i]!;
    kb.text(`${localizedNumber(first, ctx)} ${t(ctx, 'currency_toman')}`, `bc:cap:${first}`);
    const second = DAILY_CAP_PRESETS[i + 1];
    if (second !== undefined) {
      kb.text(`${localizedNumber(second, ctx)} ${t(ctx, 'currency_toman')}`, `bc:cap:${second}`);
    }
    kb.row();
  }
  kb.text(t(ctx, 'menu_back'), 'bc:step:back');

  let activeCtx = ctx;
  let errorBanner: string | undefined;

  for (;;) {
    const body = errorBanner
      ? `${errorBanner}\n\n${t(activeCtx, 'admin_bank_cards_prompt_cap')}`
      : t(activeCtx, 'admin_bank_cards_prompt_cap');
    await renderSettingsScreen(
      conversation,
      activeCtx,
      buildPromptScreen('📊', t(activeCtx, 'admin_bank_cards_daily_cap_label'), body),
      kb
    );

    const input = await waitForSettingsInput(conversation, {
      allowText: true,
      callbackPrefixes: ['bc:cap:'],
      backCallbacks: ['bc:step:back'],
      retryKeyboard: kb,
    });
    if (input.type === 'cancel') return { type: 'cancel' };
    if (input.type === 'back') return { type: 'back' };

    if (input.type === 'callback') {
      const raw = input.data.slice('bc:cap:'.length);
      if (raw === 'none') return { type: 'value', value: null };
      const parsed = Number(raw);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        return { type: 'value', value: parsed };
      }
      continue;
    }
    activeCtx = input.ctx;

    const normalized = normalizeInputDigits(input.value.trim());
    if (
      normalized === '0' ||
      input.value.trim() === '-' ||
      input.value.trim().toLowerCase() === 'unlimited'
    ) {
      return { type: 'value', value: null };
    }
    if (/^\d+$/u.test(normalized)) {
      const parsed = Number(normalized);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        return { type: 'value', value: parsed };
      }
    }

    errorBanner = t(activeCtx, 'admin_bank_cards_cap_invalid');
  }
}

async function showBankCardsNotice(
  conversation: MyConversation,
  ctx: ConversationContext,
  text: string
): Promise<'continue' | 'cancel'> {
  const kb = new InlineKeyboard().text(t(ctx, 'admin_bank_cards_back_to_list'), 'bc:notice:ok');
  await renderSettingsScreen(conversation, ctx, text, kb);
  const input = await waitForSettingsInput(conversation, {
    backCallbacks: ['bc:notice:ok'],
    retryKeyboard: kb,
  });
  return input.type === 'cancel' ? 'cancel' : 'continue';
}

async function persistBankCards(
  conversation: MyConversation,
  ctx: ConversationContext,
  nextCards: readonly BankCardConfig[]
): Promise<'ok' | 'failed' | 'cancel'> {
  let failed = false;
  try {
    await conversation.external(async (outsideCtx) => {
      const services = outsideCtx?.services ?? ctx.services;
      if (!services) throw new Error('BANK_CARDS_SERVICES_UNAVAILABLE');
      if (typeof services.paymentService?.updateBankCards === 'function') {
        await services.paymentService.updateBankCards(nextCards);
      } else {
        await services.translationService.updateSetting(
          'bank_cards_json',
          serializeBankCardsJson(nextCards)
        );
      }
    });
  } catch (err) {
    failed = true;
    logger.error(
      { errorName: err instanceof Error ? err.name : typeof err },
      'Failed to persist bank cards'
    );
  }

  if (failed) {
    const noticeOutcome = await showBankCardsNotice(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_sales_bank_cards_title'),
        t(ctx, 'admin_bank_cards_save_failed')
      )
    );
    return noticeOutcome === 'cancel' ? 'cancel' : 'failed';
  }
  return 'ok';
}

async function loadBankCardsSnapshot(ctx: ConversationContext): Promise<{
  cards: BankCardStatus[];
  legacyCard: BankCardConfig | null;
}> {
  const services = ctx.services;
  const locale = resolveContextLocale(ctx);
  if (!services) return { cards: [], legacyCard: null };

  const paymentService = services.paymentService;
  const ts = services.translationService;

  let cards: BankCardStatus[];
  if (typeof paymentService?.getBankCardsWithDailyUsage === 'function') {
    cards = await paymentService.getBankCardsWithDailyUsage(new Date(), locale);
  } else {
    const raw = parseBankCardsJson(ts.getSetting('bank_cards_json', '[]'));
    cards = raw.map((card) => {
      const detectedBankName = detectIranianBankName(card.cardNumber, locale);
      return {
        ...card,
        dailyUsageToman: 0,
        remainingCapToman: card.dailyCapToman ?? null,
        isCapReached: false,
        ...(detectedBankName ? { detectedBankName } : {}),
        luhnValid: isValidLuhnCardNumber(card.cardNumber),
      };
    });
  }

  let legacyCard: BankCardConfig | null = null;
  if (typeof paymentService?.getLegacyDefaultCard === 'function') {
    legacyCard = paymentService.getLegacyDefaultCard(locale);
  } else {
    const legacyNumber = normalizeCardNumber(ts.getSetting('card_number', ''));
    if (legacyNumber) {
      const detectedBank = detectIranianBankName(legacyNumber, locale);
      legacyCard = {
        id: 'legacy_default',
        cardNumber: legacyNumber,
        cardHolder: ts.getSetting('card_holder', '').trim(),
        enabled: true,
        dailyCapToman: null,
        ...(detectedBank ? { bankName: detectedBank } : {}),
      };
    }
  }

  return { cards, legacyCard };
}

function stripCardStatus(card: BankCardStatus): BankCardConfig {
  return {
    id: card.id,
    cardNumber: card.cardNumber,
    cardHolder: card.cardHolder,
    enabled: card.enabled,
    dailyCapToman: card.dailyCapToman ?? null,
    ...(card.bankName ? { bankName: card.bankName } : {}),
  };
}

export function buildBankCardsListScreen(
  ctx: ConversationContext,
  visibleCards: readonly BankCardStatus[],
  options: {
    allCards: readonly BankCardStatus[];
    legacyCard: BankCardConfig | null;
    page: number;
    totalPages: number;
  }
): string {
  const activeCount = options.allCards.filter((card) => card.enabled).length;
  const totalCount = options.allCards.length;
  const allDisabledWithLegacy = totalCount > 0 && activeCount === 0 && Boolean(options.legacyCard);

  const primaryValue =
    totalCount > 0
      ? t(ctx, 'admin_bank_cards_summary_counts', {
          active: localizedNumber(activeCount, ctx),
          total: localizedNumber(totalCount, ctx),
        })
      : t(ctx, 'admin_bank_cards_summary_fallback');

  const sections: Parameters<typeof buildScreen>[0]['sections'] = [];

  if (totalCount === 0) {
    const emptyFields: Array<{ emoji?: string; label: string; value: string }> = [];
    if (options.legacyCard) {
      emptyFields.push(
        {
          label: t(ctx, 'topup_card_number_label'),
          value: `\`${sanitizeTelegramInlineCode(formatCardNumberGrouped(options.legacyCard.cardNumber))}\``,
        },
        {
          label: t(ctx, 'topup_card_holder_label'),
          value: escapeTelegramMarkdown(options.legacyCard.cardHolder || '—'),
        }
      );
      if (options.legacyCard.bankName) {
        emptyFields.push({
          label: t(ctx, 'topup_card_bank_label'),
          value: escapeTelegramMarkdown(options.legacyCard.bankName),
        });
      }
      sections.push({
        emoji: '🏦',
        title: t(ctx, 'admin_bank_cards_legacy_section'),
        fields: emptyFields,
      });
    } else {
      sections.push({
        emoji: '📭',
        title: t(ctx, 'admin_bank_cards_list_section'),
        fields: [{ label: '—', value: t(ctx, 'admin_sales_bank_cards_empty') }],
      });
    }
  } else {
    sections.push({
      emoji: '📋',
      title: t(ctx, 'admin_bank_cards_list_section'),
      fields: visibleCards.map((card) => {
        const dot = !card.enabled ? '⚪️' : card.isCapReached ? '🔴' : '🟢';
        const rawBankLabel =
          card.bankName || card.detectedBankName || t(ctx, 'topup_card_number_label');
        const safeBoldBank = escapeTelegramMarkdown(rawBankLabel.replaceAll('*', ''));
        const capInfo =
          card.dailyCapToman != null
            ? `${localizedNumber(card.dailyUsageToman, ctx)} / ${localizedNumber(card.dailyCapToman, ctx)} ${t(ctx, 'currency_toman')}${card.isCapReached ? ` · ${t(ctx, 'admin_bank_cards_cap_reached_badge')}` : ''}`
            : card.dailyUsageToman > 0
              ? `${t(ctx, 'admin_bank_cards_unlimited')} (${t(ctx, 'admin_bank_cards_daily_usage_label')}: ${localizedNumber(card.dailyUsageToman, ctx)} ${t(ctx, 'currency_toman')})`
              : t(ctx, 'admin_bank_cards_unlimited');
        const holder = escapeTelegramMarkdown(card.cardHolder || '—');
        const grouped = sanitizeTelegramInlineCode(formatCardNumberGrouped(card.cardNumber));
        return {
          label: `${dot} ${safeBoldBank}`,
          value: `\`${grouped}\`\n${t(ctx, 'topup_card_holder_label')}: ${holder}\n${t(ctx, 'admin_bank_cards_daily_cap_label')}: ${capInfo}`,
        };
      }),
    });
  }

  const footerParts: string[] = [];
  if (totalCount === 0 && options.legacyCard) {
    footerParts.push(`ℹ️ ${t(ctx, 'admin_sales_bank_cards_empty')}`);
  } else if (allDisabledWithLegacy) {
    footerParts.push(t(ctx, 'admin_bank_cards_all_disabled_warning'));
  } else if (activeCount >= 2) {
    footerParts.push(
      t(ctx, 'admin_bank_cards_rotation_active', { count: localizedNumber(activeCount, ctx) })
    );
  }
  if (options.totalPages > 1) {
    footerParts.push(
      `📄 ${t(ctx, 'admin_bank_cards_page_status', {
        page: localizedNumber(options.page + 1, ctx),
        total: localizedNumber(options.totalPages, ctx),
      })}`
    );
  }
  footerParts.push(`ℹ️ ${t(ctx, 'admin_home_hint')}`);

  return buildScreen({
    emoji: '💳',
    title: t(ctx, 'admin_sales_bank_cards_title'),
    subtitle: t(ctx, 'admin_sales_bank_cards_subtitle'),
    primary: {
      emoji: activeCount > 0 ? '🟢' : '🏦',
      label: t(ctx, 'admin_setting_bank_cards_json'),
      value: primaryValue,
    },
    sections,
    footer: footerParts.join('\n'),
  });
}

export function buildBankCardsListKeyboard(
  ctx: ConversationContext,
  visibleCards: readonly BankCardStatus[],
  options: {
    totalCards: number;
    hasLegacyImport: boolean;
    page: number;
    totalPages: number;
  }
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const card of visibleCards) {
    const dot = !card.enabled ? '⚪️' : card.isCapReached ? '🔴' : '🟢';
    const bankPart = card.bankName || card.detectedBankName || '';
    const shortNum = maskCardNumberShort(card.cardNumber);
    const holderPart = card.cardHolder ? ` · ${card.cardHolder}` : '';
    const label = bankPart
      ? `${dot} ${bankPart} · ${shortNum}${holderPart}`
      : `${dot} ${shortNum}${holderPart}`;
    kb.text(truncateButtonLabel(label, 58), callbackData('bc', 'o', card.id)).row();
  }

  if (options.totalPages > 1) {
    if (options.page > 0) {
      kb.text(t(ctx, 'pagination_previous'), callbackData('bc', 'p', options.page - 1));
    }
    kb.text(
      `${localizedNumber(options.page + 1, ctx)} / ${localizedNumber(options.totalPages, ctx)}`,
      'ui:noop'
    );
    if (options.page + 1 < options.totalPages) {
      kb.text(t(ctx, 'pagination_next'), callbackData('bc', 'p', options.page + 1));
    }
    kb.row();
  }

  if (options.totalCards < MAX_BANK_CARDS) {
    kb.text(t(ctx, 'admin_sales_bank_cards_add_button'), 'bc:add').row();
  }
  if (options.hasLegacyImport) {
    kb.text(t(ctx, 'admin_bank_cards_import_legacy_button'), 'bc:imp').row();
  }

  kb.text(t(ctx, 'menu_back'), 'bc:back');
  return kb;
}

export function buildBankCardDetailScreen(
  ctx: ConversationContext,
  card: BankCardStatus,
  index: number,
  total: number
): string {
  const statusText = !card.enabled
    ? t(ctx, 'admin_overview_inactive')
    : card.isCapReached
      ? t(ctx, 'admin_bank_cards_cap_reached_badge')
      : t(ctx, 'admin_overview_active');

  const bankDisplay = card.bankName
    ? escapeTelegramMarkdown(card.bankName)
    : card.detectedBankName
      ? `${escapeTelegramMarkdown(card.detectedBankName)} (auto)`
      : '—';

  const capFields: Array<{ label: string; value: string }> = [
    {
      label: t(ctx, 'admin_bank_cards_daily_cap_label'),
      value:
        card.dailyCapToman != null
          ? `${localizedNumber(card.dailyCapToman, ctx)} ${t(ctx, 'currency_toman')}`
          : t(ctx, 'admin_bank_cards_unlimited'),
    },
    {
      label: t(ctx, 'admin_bank_cards_daily_usage_label'),
      value: `${localizedNumber(card.dailyUsageToman, ctx)} ${t(ctx, 'currency_toman')}`,
    },
  ];
  if (card.remainingCapToman !== null) {
    capFields.push({
      label: t(ctx, 'admin_bank_cards_daily_remaining_label'),
      value: `${localizedNumber(card.remainingCapToman, ctx)} ${t(ctx, 'currency_toman')}`,
    });
  }

  return buildScreen({
    emoji: '💳',
    title: t(ctx, 'admin_bank_cards_detail_title'),
    subtitle: t(ctx, 'admin_bank_cards_detail_subtitle'),
    primary: {
      emoji: !card.enabled ? '⚪️' : card.isCapReached ? '🔴' : '🟢',
      label: t(ctx, 'admin_bank_cards_status_label'),
      value: statusText,
    },
    sections: [
      {
        emoji: '🏦',
        title: t(ctx, 'topup_payment_section'),
        fields: [
          {
            label: t(ctx, 'topup_card_number_label'),
            value: `\`${sanitizeTelegramInlineCode(formatCardNumberGrouped(card.cardNumber))}\``,
          },
          {
            label: t(ctx, 'topup_card_holder_label'),
            value: escapeTelegramMarkdown(card.cardHolder || '—'),
          },
          {
            label: t(ctx, 'topup_card_bank_label'),
            value: bankDisplay,
          },
          {
            label: t(ctx, 'admin_bank_cards_order_label'),
            value: `${localizedNumber(index + 1, ctx)} / ${localizedNumber(total, ctx)}`,
          },
        ],
      },
      {
        emoji: '📊',
        title: t(ctx, 'admin_bank_cards_daily_cap_label'),
        fields: capFields,
      },
    ],
    footer: `ℹ️ ${t(ctx, 'admin_home_hint')}`,
  });
}

export function buildBankCardDetailKeyboard(
  ctx: ConversationContext,
  card: BankCardStatus,
  index: number,
  total: number
): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_bank_cards_edit_number_button'), callbackData('bc', 'en', card.id))
    .text(t(ctx, 'admin_bank_cards_edit_holder_button'), callbackData('bc', 'eh', card.id))
    .row()
    .text(t(ctx, 'admin_bank_cards_edit_bank_button'), callbackData('bc', 'eb', card.id))
    .text(t(ctx, 'admin_bank_cards_edit_cap_button'), callbackData('bc', 'ec', card.id))
    .row()
    .text(
      card.enabled
        ? t(ctx, 'admin_bank_cards_disable_button')
        : t(ctx, 'admin_bank_cards_enable_button'),
      callbackData('bc', 'tg', card.id)
    )
    .row();

  if (total > 1) {
    if (index > 0) {
      kb.text(t(ctx, 'admin_bank_cards_move_up_button'), callbackData('bc', 'up', card.id));
    }
    if (index + 1 < total) {
      kb.text(t(ctx, 'admin_bank_cards_move_down_button'), callbackData('bc', 'dn', card.id));
    }
    kb.row();
  }

  kb.text(t(ctx, 'admin_bank_cards_delete_button'), callbackData('bc', 'del', card.id))
    .row()
    .text(t(ctx, 'admin_bank_cards_back_to_list'), 'bc:list');

  return kb;
}
