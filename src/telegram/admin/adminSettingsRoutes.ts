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
} from '../../domain/services/PaymentService.js';
import {
  customServiceNameEnabled,
  expiredCleanupGraceDays,
  forappEnabled,
  nowpaymentsEnabled,
  onHoldDefaultEnabled,
  renewalRolloverEnabled,
  uniqueTopupAmountEnabled,
} from '../../domain/services/FeatureSettings.js';
import { previewConfigName } from '../../domain/services/ConfigService.js';
import {
  checkDomainDns,
  getServerPublicIp,
  normalizeDomainInput,
  verifyDomainSslAndReachability,
} from '../../domain/services/domainVerification.js';
import { countConfigsApproachingCleanup } from '../../jobs/expiredConfigCleanup.js';
import {
  localizedDateTime,
  localizedNumber,
  normalizeInputDigits,
  resolveContextLocale,
  t,
  tm,
} from '../locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../rendering.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  buildStatusBadge,
  renderScreen,
  type AdminScreenNotice,
} from '../ui.js';
import type { MenuContext } from '../types.js';
import {
  appendAdminFooterNav,
  appendAdminPagination,
  buildAdminConfirmKeyboard,
  markAdminContext,
} from './adminNav.js';
import { registerAdminRoute } from './adminRouter.js';
import {
  adminInputCancelKeyboard,
  registerAdminInputHandler,
  startAdminInput,
} from './adminInput.js';
import {
  getSettingDefinition,
  type SettingKey,
} from '../conversations/adminConversations/settings/catalog.js';
import { applyAdminSettingUpdate } from '../conversations/adminConversations/settings/conversation.js';
import {
  activeNamingFormula,
  displayAdminSettingValue,
  truncateButtonLabel,
} from '../conversations/adminConversations/settings/presentation.js';
import {
  isValidNamingTemplate,
  normalizeNamingTemplate,
  settingValidationMessage,
  validateAdminSetting,
} from '../conversations/adminConversations/settings/validation.js';
import { NAMING_TEMPLATE_PRESETS } from '../conversations/adminConversations/settings/naming.js';
import { formatCardNumberGrouped } from '../conversations/adminConversations/wallet.js';

const CARDS_PAGE_SIZE = 6;
const DAILY_CAP_PRESETS = [5_000_000, 10_000_000, 20_000_000, 50_000_000] as const;

interface BankCardDraft {
  kind: 'bc_add';
  cardNumber?: string;
  cardHolder?: string;
  bankName?: string;
}

// ── Bank Card Helpers ────────────────────────────────────────────────────────

async function loadBankCardsSnapshot(ctx: MenuContext): Promise<{
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
    cards = raw.map((card) => ({
      ...card,
      dailyUsageToman: 0,
      remainingCapToman: card.dailyCapToman ?? null,
      isCapReached: false,
      detectedBankName: detectIranianBankName(card.cardNumber, locale),
      luhnValid: isValidLuhnCardNumber(card.cardNumber),
    }));
  }

  let legacyCard: BankCardConfig | null = null;
  if (typeof paymentService?.getLegacyDefaultCard === 'function') {
    legacyCard = paymentService.getLegacyDefaultCard(locale);
  } else {
    const legacyNumber = normalizeCardNumber(ts.getSetting('card_number', ''));
    if (legacyNumber) {
      legacyCard = {
        id: 'legacy_default',
        cardNumber: legacyNumber,
        cardHolder: ts.getSetting('card_holder', '').trim(),
        enabled: true,
        dailyCapToman: null,
        bankName: detectIranianBankName(legacyNumber, locale),
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

async function persistBankCards(
  ctx: MenuContext,
  nextCards: readonly BankCardConfig[]
): Promise<void> {
  if (!ctx.services) return;
  if (typeof ctx.services.paymentService?.updateBankCards === 'function') {
    await ctx.services.paymentService.updateBankCards(nextCards);
  } else {
    await ctx.services.translationService.updateSetting(
      'bank_cards_json',
      serializeBankCardsJson(nextCards)
    );
  }
}

// ── 1. General & Security (`adm:cfg:gen`) ────────────────────────────────────

export async function renderGeneralSettingsScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const ts = ctx.services.translationService;
  const botEnabled = ts.getSettingBool('bot_enabled', true);
  const langSelection = ts.getSettingBool('language_selection_enabled', true);
  const defLocale = ts.getSetting('default_locale', 'fa') === 'en' ? 'en' : 'fa';
  const reqPhonePurchase = ts.getSettingBool('require_phone_for_purchase', false);
  const reqPhoneTrial = ts.getSettingBool('require_phone_for_trial', false);
  const iranOnly = ts.getSettingBool('phone_verify_iran_only', true);
  const nudgeOn = ts.getSettingBool('first_use_nudge_enabled', true);
  const cleanupOn = ts.getSettingBool('expired_cleanup_enabled', false);
  const graceDays = ts.getSettingNum('expired_cleanup_grace_days', 14);
  const warnDays = ts.getSetting('expired_cleanup_warn_days', '3,1');

  let approachingCount: number | undefined;
  try {
    const preview = await countConfigsApproachingCleanup(ts);
    approachingCount = preview.approachingDeletion;
  } catch {
    approachingCount = undefined;
  }

  const text = buildAdminScreen({
    emoji: '🛠️',
    title: t(ctx, 'admin_cfg_general_button'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_cfg_general_button')
    ),
    notice,
    primary: {
      emoji: botEnabled ? '🟢' : '🔴',
      label: t(ctx, 'admin_setting_bot_enabled'),
      value: botEnabled ? t(ctx, 'admin_overview_active') : t(ctx, 'admin_overview_maintenance'),
      inline: true,
    },
    sections: [
      {
        emoji: '🌐',
        title: t(ctx, 'admin_overview_language'),
        fields: [
          {
            label: t(ctx, 'admin_setting_default_locale'),
            value:
              defLocale === 'en'
                ? t(ctx, 'admin_setting_locale_en')
                : t(ctx, 'admin_setting_locale_fa'),
          },
          {
            label: t(ctx, 'admin_setting_language_selection_enabled'),
            value: buildStatusBadge(ctx, langSelection ? 'active' : 'inactive'),
          },
        ],
      },
      {
        emoji: '📱',
        title: t(ctx, 'admin_cfg_phone_section'),
        fields: [
          {
            label: t(ctx, 'admin_setting_require_phone_for_purchase'),
            value: buildStatusBadge(ctx, reqPhonePurchase ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_setting_require_phone_for_trial'),
            value: buildStatusBadge(ctx, reqPhoneTrial ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_setting_phone_verify_iran_only'),
            value: buildStatusBadge(ctx, iranOnly ? 'active' : 'inactive'),
          },
        ],
      },
      {
        emoji: '🧹',
        title: t(ctx, 'admin_cfg_retention_section'),
        fields: [
          {
            label: t(ctx, 'admin_setting_first_use_nudge_enabled'),
            value: buildStatusBadge(ctx, nudgeOn ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_setting_expired_cleanup_enabled'),
            value: buildStatusBadge(ctx, cleanupOn ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_setting_expired_cleanup_grace_days'),
            value: `${localizedNumber(graceDays, ctx)} ${t(ctx, 'days_unit')}`,
          },
          {
            label: t(ctx, 'admin_setting_expired_cleanup_warn_days'),
            value: `\`${sanitizeTelegramInlineCode(warnDays)}\``,
          },
          ...(approachingCount !== undefined
            ? [
                {
                  label: t(ctx, 'admin_setting_expired_cleanup_preview', {
                    count: localizedNumber(approachingCount, ctx),
                  }),
                  value: '',
                },
              ]
            : []),
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(
      truncateButtonLabel(
        `${t(ctx, 'admin_setting_bot_enabled')}: ${buildStatusBadge(ctx, botEnabled ? 'active' : 'inactive')}`
      ),
      'adm:cfg:tg:bot_enabled:gen'
    )
    .row()
    .text(
      `${t(ctx, 'admin_setting_default_locale')}: ${defLocale === 'en' ? '🇬🇧' : '🦁'}`,
      'adm:cfg:gen:locale'
    )
    .row()
    .text(
      truncateButtonLabel(
        `${t(ctx, 'admin_setting_language_selection_enabled')}: ${langSelection ? '🟢' : '⚪'}`
      ),
      'adm:cfg:tg:language_selection_enabled:gen'
    )
    .row()
    .text(
      truncateButtonLabel(
        `${t(ctx, 'admin_setting_require_phone_for_purchase')}: ${reqPhonePurchase ? '🟢' : '⚪'}`
      ),
      'adm:cfg:tg:require_phone_for_purchase:gen'
    )
    .row()
    .text(
      truncateButtonLabel(
        `${t(ctx, 'admin_setting_require_phone_for_trial')}: ${reqPhoneTrial ? '🟢' : '⚪'}`
      ),
      'adm:cfg:tg:require_phone_for_trial:gen'
    )
    .row()
    .text(
      truncateButtonLabel(
        `${t(ctx, 'admin_setting_phone_verify_iran_only')}: ${iranOnly ? '🟢' : '⚪'}`
      ),
      'adm:cfg:tg:phone_verify_iran_only:gen'
    )
    .row()
    .text(
      truncateButtonLabel(
        `${t(ctx, 'admin_setting_first_use_nudge_enabled')}: ${nudgeOn ? '🟢' : '⚪'}`
      ),
      'adm:cfg:tg:first_use_nudge_enabled:gen'
    )
    .row()
    .text(
      truncateButtonLabel(
        `${t(ctx, 'admin_setting_expired_cleanup_enabled')}: ${cleanupOn ? '🟢' : '⚪'}`
      ),
      'adm:cfg:tg:expired_cleanup_enabled:gen'
    )
    .row()
    .text(
      t(ctx, 'admin_setting_expired_cleanup_grace_days'),
      'adm:cfg:ed:expired_cleanup_grace_days:gen'
    )
    .row()
    .text(
      t(ctx, 'admin_setting_expired_cleanup_warn_days'),
      'adm:cfg:ed:expired_cleanup_warn_days:gen'
    )
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg',
    backLabel: t(ctx, 'admin_cfg_back_settings'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── 2. Payment & Bank Cards (`adm:cfg:pay` & `adm:bc:*`) ─────────────────────

export async function renderPaymentSettingsScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  if (ctx.session) {
    delete ctx.session.bankCardsReturnTo;
  }
  const ts = ctx.services.translationService;
  const configuredCards = parseBankCardsJson(ts.getSetting('bank_cards_json', '[]'));
  const activeCardsCount = configuredCards.filter((c) => c.enabled).length;
  const uniqueOn = uniqueTopupAmountEnabled(ts);
  const transferOn = ts.getSettingBool('wallet_transfer_enabled', true);
  const transferMin = ts.getSettingNum('wallet_transfer_min_amount', 5000);
  const notifyOn = ts.getSettingBool('receipt_notify_enabled', true);
  const notifyMode = ts.getSetting('receipt_notify_mode', 'full') === 'simple' ? 'simple' : 'full';
  const dupPolicy =
    ts.getSetting('receipt_duplicate_policy', 'warn').trim().toLowerCase() === 'block'
      ? 'block'
      : 'warn';
  const notifyAdminsRaw = ts.getSetting('receipt_notify_admins', '').trim();
  const isAllAdmins = !notifyAdminsRaw || notifyAdminsRaw === 'all';
  const notifyCount = isAllAdmins ? 0 : notifyAdminsRaw.split(',').filter(Boolean).length;
  const forappOn = forappEnabled(ts);
  const nowpaymentsOn = nowpaymentsEnabled(ts);
  const unmatchedCount =
    (await ctx.services.automatedPaymentService?.getForAppUnmatchedCount?.().catch(() => 0)) ?? 0;

  const text = buildAdminScreen({
    emoji: '💳',
    title: t(ctx, 'admin_cfg_payment_button'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_cfg_payment_button')
    ),
    notice,
    sections: [
      {
        emoji: '💳',
        title: t(ctx, 'payment_method_card_to_card'),
        fields: [
          {
            label: t(ctx, 'admin_setting_bank_cards_json'),
            value: escapeTelegramMarkdown(displayAdminSettingValue(ctx, 'bank_cards_json')),
          },
          {
            label: t(ctx, 'admin_setting_unique_topup_amount_enabled'),
            value: buildStatusBadge(ctx, uniqueOn ? 'active' : 'inactive'),
          },
        ],
      },
      {
        emoji: '⚡',
        title: t(ctx, 'admin_auto_pay_section'),
        fields: [
          {
            label: t(ctx, 'admin_forapp_title'),
            value:
              unmatchedCount > 0
                ? `${buildStatusBadge(ctx, forappOn ? 'active' : 'inactive')} · ${localizedNumber(unmatchedCount, ctx)} ${t(ctx, 'admin_forapp_unmatched_label')}`
                : buildStatusBadge(ctx, forappOn ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_nowpayments_title'),
            value: buildStatusBadge(ctx, nowpaymentsOn ? 'active' : 'inactive'),
          },
        ],
      },
      {
        emoji: '🔄',
        title: t(ctx, 'admin_setting_wallet_transfer_enabled'),
        fields: [
          {
            label: t(ctx, 'admin_setting_wallet_transfer_enabled'),
            value: buildStatusBadge(ctx, transferOn ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_setting_wallet_transfer_min_amount'),
            value: `${localizedNumber(transferMin, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
      {
        emoji: '🔔',
        title: t(ctx, 'admin_setting_receipt_notify_enabled'),
        fields: [
          {
            label: t(ctx, 'admin_setting_receipt_notify_enabled'),
            value: buildStatusBadge(ctx, notifyOn ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_setting_receipt_notify_mode'),
            value:
              notifyMode === 'simple'
                ? t(ctx, 'admin_receipt_notify_mode_simple')
                : t(ctx, 'admin_receipt_notify_mode_full'),
          },
          {
            label: t(ctx, 'admin_setting_receipt_duplicate_policy'),
            value:
              dupPolicy === 'block'
                ? t(ctx, 'admin_receipt_duplicate_policy_block')
                : t(ctx, 'admin_receipt_duplicate_policy_warn'),
          },
          {
            label: t(ctx, 'admin_setting_receipt_notify_admins'),
            value: isAllAdmins
              ? t(ctx, 'admin_receipt_notify_admins_all')
              : `${localizedNumber(notifyCount, ctx)} ${t(ctx, 'admin_receipt_notify_admins_select')}`,
          },
        ],
      },
    ],
  });

  const cardsBadge =
    configuredCards.length > 0
      ? ` (${localizedNumber(activeCardsCount, ctx)}/${localizedNumber(configuredCards.length, ctx)})`
      : '';
  const unmatchedBadge = unmatchedCount > 0 ? ` (${localizedNumber(unmatchedCount, ctx)})` : '';

  const kb = new InlineKeyboard()
    .text(`${t(ctx, 'admin_sales_bank_cards_button')}${cardsBadge}`, 'adm:bc:p:1')
    .row()
    .text(`${t(ctx, 'admin_forapp_button')}${unmatchedBadge}`, 'adm:pg:fa')
    .text(t(ctx, 'admin_nowpayments_button'), 'adm:pg:np')
    .row()
    .text(
      `${t(ctx, 'admin_setting_unique_topup_amount_enabled')}: ${uniqueOn ? '🟢' : '⚪'}`,
      'adm:cfg:tg:unique_topup_amount_enabled:pay'
    )
    .row()
    .text(
      `${t(ctx, 'admin_setting_wallet_transfer_enabled')}: ${transferOn ? '🟢' : '⚪'}`,
      'adm:cfg:tg:wallet_transfer_enabled:pay'
    )
    .row()
    .text(
      t(ctx, 'admin_setting_wallet_transfer_min_amount'),
      'adm:cfg:ed:wallet_transfer_min_amount:pay'
    )
    .row()
    .text(
      `${t(ctx, 'admin_setting_receipt_notify_enabled')}: ${notifyOn ? '🟢' : '⚪'}`,
      'adm:cfg:tg:receipt_notify_enabled:pay'
    )
    .row()
    .text(
      notifyMode === 'simple'
        ? t(ctx, 'admin_receipt_notify_mode_simple')
        : t(ctx, 'admin_receipt_notify_mode_full'),
      'adm:cfg:pay:mode'
    )
    .text(
      dupPolicy === 'block'
        ? t(ctx, 'admin_receipt_duplicate_policy_block')
        : t(ctx, 'admin_receipt_duplicate_policy_warn'),
      'adm:cfg:pay:dup'
    )
    .row()
    .text(t(ctx, 'admin_setting_receipt_notify_admins'), 'adm:cfg:pay:adm')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg',
    backLabel: t(ctx, 'admin_cfg_back_settings'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

/** Named admin selector for receipt notifications (shows display names / usernames, not raw IDs!). */
async function renderReceiptNotifyAdminsScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const ts = ctx.services.translationService;
  const raw = ts.getSetting('receipt_notify_admins', '').trim();
  const isAll = !raw || raw === 'all';
  const selectedIds = new Set(
    isAll
      ? []
      : raw
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isSafeInteger(n) && n > 0)
  );
  const adminIds = ctx.services.adminIds ?? [];
  const profiles = await Promise.all(
    adminIds.map(
      (id) =>
        ctx.services!.userService?.findProfile?.(String(id)).catch(() => null) ??
        Promise.resolve(null)
    )
  );

  const kb = new InlineKeyboard()
    .text(
      `${isAll ? '✅ ' : '⬜ '}${t(ctx, 'admin_receipt_notify_admins_all')}`,
      'adm:cfg:pay:adm:all'
    )
    .row();
  adminIds.forEach((id, i) => {
    const profile = profiles[i];
    const nameLabel = profile?.username
      ? `@${profile.username}`
      : profile?.firstName?.trim()
        ? `${profile.firstName.trim()} (${id})`
        : String(id);
    const isSel = !isAll && selectedIds.has(id);
    kb.text(
      truncateButtonLabel(`${isSel ? '✅ ' : '⬜ '}${nameLabel}`),
      `adm:cfg:pay:adm:tg:${id}`
    ).row();
  });
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg:pay',
    backLabel: `‹ ${t(ctx, 'admin_cfg_payment_button')}`,
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: '👥',
    title: t(ctx, 'admin_receipt_notify_admins_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_cfg_payment_button'),
      t(ctx, 'admin_receipt_notify_admins_title')
    ),
    subtitle: t(ctx, 'admin_receipt_notify_admins_subtitle'),
    notice,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── Bank Cards Stateless Manager (`adm:bc:*`) ────────────────────────────────

export async function renderBankCardsListScreen(
  ctx: MenuContext,
  requestedPage = 1,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const { cards, legacyCard } = await loadBankCardsSnapshot(ctx);
  const totalPages = Math.max(1, Math.ceil(cards.length / CARDS_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const visible = cards.slice((page - 1) * CARDS_PAGE_SIZE, page * CARDS_PAGE_SIZE);
  const activeCount = cards.filter((c) => c.enabled).length;

  const kb = new InlineKeyboard();
  for (const card of visible) {
    const icon = !card.enabled ? '⚪' : card.isCapReached ? '🔴' : '🟢';
    const bank = card.bankName || card.detectedBankName;
    kb.text(
      truncateButtonLabel(
        `${icon} ${maskCardNumberShort(card.cardNumber)}${bank ? ` · ${bank}` : ''} · ${card.cardHolder}`
      ),
      `adm:bc:v:${card.id}`
    ).row();
  }

  appendAdminPagination(kb, ctx, {
    page,
    totalPages,
    pageCallback: (p) => `adm:bc:p:${p}`,
  });

  if (cards.length === 0 && legacyCard) {
    kb.text(t(ctx, 'admin_bank_cards_import_legacy_button'), 'adm:bc:imp').row();
  }
  kb.text(t(ctx, 'admin_sales_bank_cards_add_button'), 'adm:bc:add').row();
  const returnToReceipts = ctx.session?.bankCardsReturnTo === 'receipts';
  appendAdminFooterNav(kb, ctx, {
    backCallback: returnToReceipts ? 'adm:rcpt:q:1' : 'adm:cfg:pay',
    backLabel: returnToReceipts
      ? t(ctx, 'admin_receipt_back_queue')
      : `‹ ${t(ctx, 'admin_cfg_payment_button')}`,
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: '💳',
    title: t(ctx, 'admin_sales_bank_cards_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_cfg_payment_button'),
      t(ctx, 'admin_sales_bank_cards_title')
    ),
    notice,
    primary: {
      emoji: '💳',
      label: t(ctx, 'admin_setting_bank_cards_json'),
      value:
        cards.length > 0
          ? t(ctx, 'admin_bank_cards_summary_counts', {
              active: localizedNumber(activeCount, ctx),
              total: localizedNumber(cards.length, ctx),
            })
          : t(ctx, 'admin_bank_cards_summary_fallback'),
      inline: true,
    },
    footer:
      cards.length === 0
        ? t(ctx, 'admin_sales_bank_cards_empty')
        : activeCount >= 2
          ? t(ctx, 'admin_bank_cards_rotation_active', { count: localizedNumber(activeCount, ctx) })
          : cards.length > 0 && activeCount === 0
            ? t(ctx, 'admin_bank_cards_all_disabled_warning')
            : undefined,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderBankCardDetailScreen(
  ctx: MenuContext,
  cardId: string,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const { cards } = await loadBankCardsSnapshot(ctx);
  const idx = cards.findIndex((c) => c.id === cardId);
  if (idx === -1) {
    await renderBankCardsListScreen(ctx, 1);
    return;
  }
  const card = cards[idx]!;
  const bankLabel = card.bankName || card.detectedBankName || '—';

  const text = buildAdminScreen({
    emoji: '💳',
    title: t(ctx, 'admin_bank_cards_detail_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_cfg_payment_button'),
      t(ctx, 'admin_sales_bank_cards_title'),
      maskCardNumberShort(card.cardNumber)
    ),
    notice,
    primary: {
      emoji: card.enabled ? (card.isCapReached ? '🔴' : '🟢') : '⚪️',
      label: t(ctx, 'admin_bank_cards_status_label'),
      value: card.isCapReached
        ? t(ctx, 'admin_bank_cards_cap_reached_badge')
        : buildStatusBadge(ctx, card.enabled ? 'active' : 'inactive'),
      inline: true,
    },
    sections: [
      {
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
            value: escapeTelegramMarkdown(bankLabel),
          },
          {
            label: t(ctx, 'admin_bank_cards_daily_cap_label'),
            value:
              card.dailyCapToman && card.dailyCapToman > 0
                ? `${localizedNumber(card.dailyCapToman, ctx)} ${t(ctx, 'currency_toman')}`
                : t(ctx, 'admin_bank_cards_unlimited'),
          },
          {
            label: t(ctx, 'admin_bank_cards_daily_usage_label'),
            value: `${localizedNumber(card.dailyUsageToman, ctx)} ${t(ctx, 'currency_toman')}`,
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(
      card.enabled
        ? t(ctx, 'admin_bank_cards_disable_button')
        : t(ctx, 'admin_bank_cards_enable_button'),
      `adm:bc:tg:${card.id}`
    )
    .row()
    .text(t(ctx, 'admin_bank_cards_edit_number_button'), `adm:bc:ed:num:${card.id}`)
    .text(t(ctx, 'admin_bank_cards_edit_holder_button'), `adm:bc:ed:hld:${card.id}`)
    .row()
    .text(t(ctx, 'admin_bank_cards_edit_bank_button'), `adm:bc:ed:bnk:${card.id}`)
    .text(t(ctx, 'admin_bank_cards_edit_cap_button'), `adm:bc:ed:cap:${card.id}`)
    .row();

  if (idx > 0) kb.text(t(ctx, 'admin_bank_cards_move_up_button'), `adm:bc:mv:up:${card.id}`);
  if (idx < cards.length - 1)
    kb.text(t(ctx, 'admin_bank_cards_move_down_button'), `adm:bc:mv:dn:${card.id}`);
  if (idx > 0 || idx < cards.length - 1) kb.row();

  kb.text(t(ctx, 'admin_bank_cards_delete_button'), `adm:bc:del:${card.id}`).row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: `adm:bc:p:${Math.floor(idx / CARDS_PAGE_SIZE) + 1}`,
    backLabel: `‹ ${t(ctx, 'admin_sales_bank_cards_title')}`,
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── 3. Naming & Service Rules (`adm:cfg:svc`) ────────────────────────────────

export async function renderServiceRulesScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice,
  sampleOverride?: { sampleId: number; sampleCounter: number }
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const ts = ctx.services.translationService;
  const mode = ts.getSetting('naming_mode', 'custom');
  const prefix = ts.getSetting('naming_prefix', 'rebecca');
  const template = ts.getSetting('custom_naming_template', '{prefix}_{telegram_id}_{counter}');
  const formula = activeNamingFormula(mode, template);
  const preview = previewConfigName(ts, sampleOverride?.sampleId, sampleOverride?.sampleCounter);
  const customNameOn = customServiceNameEnabled(ts);
  const displayMode = ts.getSetting('package_display_mode', 'specs') === 'name' ? 'name' : 'specs';
  const onHoldOn = onHoldDefaultEnabled(ts);
  const rolloverOn = renewalRolloverEnabled(ts);
  const lowTraffic = ts.getSetting('low_traffic_threshold_gb', '2');
  const expiryWarn = ts.getSettingNum('expiry_warning_days', 3);
  const refundHours = ts.getSettingNum('refund_window_hours', 24);

  const text = buildAdminScreen({
    emoji: '🏷️',
    title: t(ctx, 'admin_cfg_service_button'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_cfg_service_button')
    ),
    notice,
    primary: {
      emoji: '✨',
      label: t(ctx, 'admin_naming_preview_label'),
      value: `\u200e\`${sanitizeTelegramInlineCode(preview)}\`\u200e`,
      inline: true,
    },
    sections: [
      {
        emoji: '🏷️',
        title: t(ctx, 'admin_naming_config_section'),
        fields: [
          {
            label: t(ctx, 'admin_naming_active_mode'),
            value: displayAdminSettingValue(ctx, 'naming_mode'),
          },
          {
            label: t(ctx, 'admin_naming_prefix_label'),
            value: `\u200e\`${sanitizeTelegramInlineCode(prefix)}\`\u200e`,
          },
          {
            label: t(ctx, 'admin_naming_template_label'),
            value: `\u200e\`${sanitizeTelegramInlineCode(formula)}\`\u200e`,
          },
          {
            label: t(ctx, 'admin_setting_custom_service_name_enabled'),
            value: buildStatusBadge(ctx, customNameOn ? 'active' : 'inactive'),
          },
        ],
      },
      {
        emoji: '⚙️',
        title: t(ctx, 'admin_pkg_settings_btn'),
        fields: [
          {
            label: t(ctx, 'admin_pkg_display_mode_label'),
            value:
              displayMode === 'name'
                ? t(ctx, 'admin_pkg_display_mode_name')
                : t(ctx, 'admin_pkg_display_mode_specs'),
          },
          {
            label: t(ctx, 'admin_setting_on_hold_default_enabled'),
            value: buildStatusBadge(ctx, onHoldOn ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_setting_renewal_rollover_enabled'),
            value: buildStatusBadge(ctx, rolloverOn ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_setting_low_traffic_threshold_gb'),
            value: `${escapeTelegramMarkdown(lowTraffic)} ${t(ctx, 'traffic_unit_gb')}`,
          },
          {
            label: t(ctx, 'admin_setting_expiry_warning_days'),
            value: `${localizedNumber(expiryWarn, ctx)} ${t(ctx, 'days_unit')}`,
          },
          {
            label: t(ctx, 'admin_setting_refund_window_hours'),
            value:
              refundHours === 0
                ? t(ctx, 'admin_pkg_unlimited_refund')
                : `${localizedNumber(refundHours, ctx)} ${t(ctx, 'hours_unit')}`,
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_naming_btn_change_mode'), 'adm:cfg:svc:mode')
    .text(t(ctx, 'admin_naming_btn_refresh_preview'), 'adm:cfg:svc:ref')
    .row()
    .text(
      truncateButtonLabel(`${t(ctx, 'admin_naming_btn_edit_prefix')}: ${prefix}`, 30),
      'adm:cfg:ed:naming_prefix:svc'
    )
    .text(t(ctx, 'admin_naming_btn_edit_template'), 'adm:cfg:svc:tmpl')
    .row()
    .text(
      truncateButtonLabel(
        `${t(ctx, 'admin_setting_custom_service_name_enabled')}: ${customNameOn ? '🟢' : '⚪'}`
      ),
      'adm:cfg:tg:custom_service_name_enabled:svc'
    )
    .row()
    .text(
      `${t(ctx, 'admin_pkg_display_mode_label')}: ${displayMode === 'name' ? t(ctx, 'admin_pkg_display_mode_name') : t(ctx, 'admin_pkg_display_mode_specs')}`,
      'adm:cfg:svc:dmode'
    )
    .row()
    .text(
      `${t(ctx, 'admin_setting_on_hold_default_enabled')}: ${onHoldOn ? '🟢' : '⚪'}`,
      'adm:cfg:tg:on_hold_default_enabled:svc'
    )
    .row()
    .text(
      `${t(ctx, 'admin_setting_renewal_rollover_enabled')}: ${rolloverOn ? '🟢' : '⚪'}`,
      'adm:cfg:tg:renewal_rollover_enabled:svc'
    )
    .row()
    .text(
      t(ctx, 'admin_setting_low_traffic_threshold_gb'),
      'adm:cfg:ed:low_traffic_threshold_gb:svc'
    )
    .text(t(ctx, 'admin_setting_expiry_warning_days'), 'adm:cfg:ed:expiry_warning_days:svc')
    .row()
    .text(t(ctx, 'admin_setting_refund_window_hours'), 'adm:cfg:ed:refund_window_hours:svc')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg',
    backLabel: t(ctx, 'admin_cfg_back_settings'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── 4. Web Mini App (`adm:cfg:web` + `adm:cfg:web:dns`) ──────────────────────

export async function renderWebAppScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const ts = ctx.services.translationService;
  const enabled = ts.getSettingBool('webapp_enabled', false) && Boolean(ctx.services.webAppUrl);
  const webAppUrl = ctx.services.webAppUrl || ts.getSetting('webapp_url', '').trim();
  const port = ctx.services.webAppHostPort ?? ctx.services.webAppPort ?? 3002;
  const isRunning = ctx.services.isWebAppRunning
    ? ctx.services.isWebAppRunning()
    : Boolean(ctx.services.webAppUrl);
  const serverIp = (await getServerPublicIp().catch(() => '')) || '';

  const text = buildAdminScreen({
    emoji: '🌐',
    title: t(ctx, 'admin_webapp_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_webapp_title')
    ),
    notice,
    primary: {
      emoji: enabled ? '🟢' : '⚪️',
      label: t(ctx, 'admin_webapp_status_label'),
      value: buildStatusBadge(ctx, enabled ? 'active' : 'inactive'),
      inline: true,
    },
    sections: [
      {
        emoji: '🔌',
        title: t(ctx, 'admin_webapp_connection_title'),
        fields: [
          {
            label: t(ctx, 'admin_webapp_url_label'),
            value: webAppUrl
              ? `\`${sanitizeTelegramInlineCode(webAppUrl)}\``
              : t(ctx, 'admin_setting_not_configured'),
          },
          {
            label: t(ctx, 'admin_webapp_port_label'),
            value: `\`${sanitizeTelegramInlineCode(String(port))}\``,
          },
          {
            label: t(ctx, 'admin_webapp_server_state_label'),
            value: isRunning
              ? t(ctx, 'admin_webapp_server_running')
              : t(ctx, 'admin_webapp_server_stopped'),
          },
          ...(serverIp
            ? [
                {
                  label: t(ctx, 'admin_webapp_server_ip_label'),
                  value: `\`${sanitizeTelegramInlineCode(serverIp)}\``,
                },
              ]
            : []),
        ],
      },
    ],
  });

  const kb = new InlineKeyboard();
  if (enabled && webAppUrl) {
    kb.webApp(t(ctx, 'admin_webapp_preview_button'), webAppUrl).row();
  }
  kb.text(
    enabled ? t(ctx, 'admin_webapp_toggle_disable') : t(ctx, 'admin_webapp_toggle_enable'),
    'adm:cfg:web:tg'
  )
    .row()
    .text(
      webAppUrl ? t(ctx, 'admin_webapp_change_url') : t(ctx, 'admin_webapp_edit_url'),
      'adm:cfg:web:url'
    );
  if (webAppUrl) {
    kb.row().text(t(ctx, 'admin_webapp_verify_dns_button'), 'adm:cfg:web:dns');
  }
  kb.row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg',
    backLabel: t(ctx, 'admin_cfg_back_settings'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── 5. Auto Backup (`adm:cfg:bak`) ───────────────────────────────────────────

export async function renderBackupScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const ts = ctx.services.translationService;
  const enabled = ts.getSettingBool('backup_enabled', false);
  const intervalHours = ts.getSettingNum('backup_interval_hours', 24);
  const targetChatId = ts.getSetting('backup_target_chat_id', '').trim();
  const includeEnv = ts.getSettingBool('backup_include_env', true);
  const lastRunRaw = ts.getSetting('backup_last_run_at', '').trim();
  const lastStatus = ts.getSetting('backup_last_status', '').trim();

  const parsedLastRun = lastRunRaw ? new Date(lastRunRaw) : undefined;
  const formattedLastRun =
    parsedLastRun && !Number.isNaN(parsedLastRun.getTime())
      ? localizedDateTime(parsedLastRun, ctx)
      : '—';

  const statusDisplay =
    lastStatus === 'success'
      ? `✅ ${t(ctx, 'admin_setting_saved_title')}`
      : lastStatus.startsWith('error:')
        ? `⚠️ ${escapeTelegramMarkdown(lastStatus.slice(6).trim())}`
        : lastStatus
          ? escapeTelegramMarkdown(lastStatus)
          : '—';

  const text = buildAdminScreen({
    emoji: '💾',
    title: t(ctx, 'admin_backup_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_backup_title')
    ),
    notice,
    primary: {
      emoji: enabled ? '🟢' : '⚪️',
      label: t(ctx, 'admin_setting_backup_enabled'),
      value: buildStatusBadge(ctx, enabled ? 'active' : 'inactive'),
      inline: true,
    },
    sections: [
      {
        fields: [
          {
            label: t(ctx, 'admin_setting_backup_interval_hours'),
            value: `${localizedNumber(intervalHours, ctx)} ${t(ctx, 'hours_unit')}`,
          },
          {
            label: t(ctx, 'admin_setting_backup_target_chat_id'),
            value: targetChatId
              ? `\`${sanitizeTelegramInlineCode(targetChatId)}\``
              : t(ctx, 'admin_setting_not_configured'),
          },
          {
            label: t(ctx, 'admin_setting_backup_include_env'),
            value: buildStatusBadge(ctx, includeEnv ? 'active' : 'inactive'),
          },
          { label: t(ctx, 'admin_setting_backup_last_run'), value: formattedLastRun },
          { label: t(ctx, 'admin_setting_backup_last_status'), value: statusDisplay },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(
      `${t(ctx, 'admin_setting_backup_enabled')}: ${enabled ? '🟢' : '⚪'}`,
      'adm:cfg:tg:backup_enabled:bak'
    )
    .row()
    .text(t(ctx, 'admin_setting_backup_interval_hours'), 'adm:cfg:ed:backup_interval_hours:bak')
    .text(t(ctx, 'admin_setting_backup_target_chat_id'), 'adm:cfg:ed:backup_target_chat_id:bak')
    .row()
    .text(
      `${t(ctx, 'admin_setting_backup_include_env')}: ${includeEnv ? '🟢' : '⚪'}`,
      'adm:cfg:tg:backup_include_env:bak'
    )
    .row()
    .text(t(ctx, 'admin_backup_send_now_button'), 'adm:cfg:bak:send')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg',
    backLabel: t(ctx, 'admin_cfg_back_settings'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── 6. Admins & Support (`adm:cfg:adm`) ──────────────────────────────────────

export async function renderAdminsAndSupportScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const ts = ctx.services.translationService;
  const supportOn = ts.getSettingBool('support_enabled', true);
  const supportDest = displayAdminSettingValue(ctx, 'support_destination');
  const adminCount = ctx.services.adminIds?.length ?? 0;

  const text = buildAdminScreen({
    emoji: '🛡️',
    title: t(ctx, 'admin_cfg_admins_support_button'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_cfg_admins_support_button')
    ),
    notice,
    sections: [
      {
        emoji: '💬',
        title: t(ctx, 'admin_cfg_support_section'),
        fields: [
          {
            label: t(ctx, 'admin_setting_support_enabled'),
            value: buildStatusBadge(ctx, supportOn ? 'active' : 'inactive'),
          },
          {
            label: t(ctx, 'admin_setting_support_destination'),
            value: `\`${sanitizeTelegramInlineCode(supportDest)}\``,
          },
        ],
      },
      {
        emoji: '🛡️',
        title: t(ctx, 'admin_registry_title'),
        fields: [
          {
            label: t(ctx, 'admin_registry_count_label'),
            value: localizedNumber(adminCount, ctx),
          },
        ],
      },
    ],
  });

  const kb = new InlineKeyboard()
    .text(
      `${t(ctx, 'admin_setting_support_enabled')}: ${supportOn ? '🟢' : '⚪'}`,
      'adm:cfg:tg:support_enabled:adm'
    )
    .row()
    .text(t(ctx, 'admin_setting_support_destination'), 'adm:cfg:ed:support_destination:adm')
    .row()
    .text(t(ctx, 'admin_registry_title'), 'admin:admins:open')
    .text(t(ctx, 'admin_add_admin_button'), 'admin:admins:add')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg',
    backLabel: t(ctx, 'admin_cfg_back_settings'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ── Route & Input Registration ───────────────────────────────────────────────

export function registerAdminSettingsRoutes(): void {
  // Section views
  registerAdminRoute('adm:cfg:gen', async (ctx, _m, notice) =>
    renderGeneralSettingsScreen(ctx, notice)
  );
  registerAdminRoute('adm:cfg:pay', async (ctx, _m, notice) =>
    renderPaymentSettingsScreen(ctx, notice)
  );
  registerAdminRoute('adm:cfg:svc', async (ctx, _m, notice) =>
    renderServiceRulesScreen(ctx, notice)
  );
  registerAdminRoute('adm:cfg:web', async (ctx, _m, notice) => renderWebAppScreen(ctx, notice));
  registerAdminRoute('adm:cfg:bak', async (ctx, _m, notice) => renderBackupScreen(ctx, notice));
  registerAdminRoute('adm:cfg:adm', async (ctx, _m, notice) =>
    renderAdminsAndSupportScreen(ctx, notice)
  );

  const sectionRouteMap: Record<string, string> = {
    gen: 'adm:cfg:gen',
    pay: 'adm:cfg:pay',
    svc: 'adm:cfg:svc',
    bak: 'adm:cfg:bak',
    adm: 'adm:cfg:adm',
  };

  // Generic 1-tap boolean toggle across all Settings sections
  registerAdminRoute(/^adm:cfg:tg:([a-z_]+):(gen|pay|svc|bak|adm)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const key = match![1] as SettingKey;
    const section = match![2]!;
    const def = getSettingDefinition(key);
    if (!def || def.editor.type !== 'boolean') return;
    const defaultTrue = new Set([
      'bot_enabled',
      'language_selection_enabled',
      'support_enabled',
      'wallet_transfer_enabled',
      'receipt_notify_enabled',
      'renewal_rollover_enabled',
      'first_use_nudge_enabled',
      'phone_verify_iran_only',
      'backup_include_env',
    ]);
    const current = ctx.services.translationService.getSettingBool(key, defaultTrue.has(key));
    await applyAdminSettingUpdate(ctx.services.translationService, key, String(!current));
    const notice: AdminScreenNotice = {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    };
    if (section === 'gen') await renderGeneralSettingsScreen(ctx, notice);
    else if (section === 'pay') await renderPaymentSettingsScreen(ctx, notice);
    else if (section === 'svc') await renderServiceRulesScreen(ctx, notice);
    else if (section === 'bak') await renderBackupScreen(ctx, notice);
    else await renderAdminsAndSupportScreen(ctx, notice);
  });

  // Generic single-setting text edit via non-blocking adminInput
  registerAdminRoute(/^adm:cfg:ed:([a-z_]+):(gen|pay|svc|bak|adm)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const key = match![1] as SettingKey;
    const section = match![2]!;
    const def = getSettingDefinition(key);
    if (!def) return;
    const current = ctx.services.translationService.getSetting(key, '—');
    const kb = adminInputCancelKeyboard(ctx, (inner) => {
      if (key === 'support_destination' || key === 'backup_target_chat_id') {
        inner.text(t(ctx, 'admin_setting_clear_button'), `adm:cfg:clr:${key}:${section}`).row();
      }
    });
    await startAdminInput(ctx, {
      kind: 'cfg:setting',
      payload: { key, section },
      returnRoute: sectionRouteMap[section] ?? 'adm:cfg',
      promptText: buildAdminPromptScreen({
        emoji: '✏️',
        title: t(ctx, def.labelKey),
        body: t(ctx, 'admin_setting_value_prompt', {
          setting: t(ctx, def.labelKey),
          current_value: `\`${sanitizeTelegramInlineCode(current)}\``,
        }),
      }),
      keyboard: kb,
    });
  });

  registerAdminRoute(
    /^adm:cfg:clr:(support_destination|backup_target_chat_id):(adm|bak)$/u,
    async (ctx, match) => {
      if (!ctx.services) return;
      const key = match![1] as SettingKey;
      const section = match![2]!;
      await ctx.services.translationService.updateSetting(key, '');
      const notice: AdminScreenNotice = {
        tone: 'success',
        text: t(ctx, 'admin_setting_saved_title'),
      };
      if (section === 'bak') await renderBackupScreen(ctx, notice);
      else await renderAdminsAndSupportScreen(ctx, notice);
    }
  );

  registerAdminInputHandler('cfg:setting', async (ctx, text, state) => {
    if (!ctx.services) return { status: 'done' };
    const key = String(state.payload?.key ?? '') as SettingKey;
    const def = getSettingDefinition(key);
    if (!def) return { status: 'done' };
    const graceDays =
      key === 'expired_cleanup_warn_days'
        ? expiredCleanupGraceDays(ctx.services.translationService)
        : undefined;
    const validated = validateAdminSetting(
      key,
      text,
      graceDays !== undefined ? { graceDays } : undefined
    );
    if (validated === undefined) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '✏️',
          title: t(ctx, def.labelKey),
          body: t(ctx, 'admin_setting_value_prompt', {
            setting: t(ctx, def.labelKey),
            current_value: `\`${sanitizeTelegramInlineCode(ctx.services.translationService.getSetting(key, '—'))}\``,
          }),
          error: settingValidationMessage(ctx, key),
        }),
      };
    }
    const prev = ctx.services.translationService.getSetting(key, '');
    await applyAdminSettingUpdate(ctx.services.translationService, key, validated);
    if (key === 'naming_prefix') {
      try {
        await ctx.services.configService.syncCounters();
      } catch {
        await ctx.services.translationService.updateSetting(key, prev);
        return {
          status: 'done',
          notice: { tone: 'error', text: t(ctx, 'admin_setting_apply_failed') },
        };
      }
    }
    return {
      status: 'done',
      notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
    };
  });

  // General: toggle default locale
  registerAdminRoute('adm:cfg:gen:locale', async (ctx) => {
    if (!ctx.services) return;
    const cur = ctx.services.translationService.getSetting('default_locale', 'fa');
    await ctx.services.translationService.updateSetting(
      'default_locale',
      cur === 'en' ? 'fa' : 'en'
    );
    await renderGeneralSettingsScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  // Payment: receipt mode, duplicate policy, named notify admins
  registerAdminRoute('adm:cfg:pay:mode', async (ctx) => {
    if (!ctx.services) return;
    const cur = ctx.services.translationService.getSetting('receipt_notify_mode', 'full');
    await ctx.services.translationService.updateSetting(
      'receipt_notify_mode',
      cur === 'simple' ? 'full' : 'simple'
    );
    await renderPaymentSettingsScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute('adm:cfg:pay:dup', async (ctx) => {
    if (!ctx.services) return;
    const cur = ctx.services.translationService.getSetting('receipt_duplicate_policy', 'warn');
    await ctx.services.translationService.updateSetting(
      'receipt_duplicate_policy',
      cur === 'block' ? 'warn' : 'block'
    );
    await renderPaymentSettingsScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute('adm:cfg:pay:adm', async (ctx, _m, notice) =>
    renderReceiptNotifyAdminsScreen(ctx, notice)
  );

  registerAdminRoute('adm:cfg:pay:adm:all', async (ctx) => {
    await ctx.services?.translationService.updateSetting('receipt_notify_admins', '');
    await renderReceiptNotifyAdminsScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:cfg:pay:adm:tg:(\d+)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const targetId = Number(match![1]);
    const raw = ctx.services.translationService.getSetting('receipt_notify_admins', '').trim();
    const isAll = !raw || raw === 'all';
    const set = new Set(
      isAll
        ? []
        : raw
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isSafeInteger(n) && n > 0)
    );
    if (isAll) {
      set.add(targetId);
    } else if (set.has(targetId)) {
      set.delete(targetId);
    } else {
      set.add(targetId);
    }
    await ctx.services.translationService.updateSetting(
      'receipt_notify_admins',
      set.size === 0 ? '' : Array.from(set).join(',')
    );
    await renderReceiptNotifyAdminsScreen(ctx);
  });

  // Service Rules: refresh naming preview, display mode, mode picker, template presets
  registerAdminRoute('adm:cfg:svc:ref', async (ctx) => {
    const sampleId = Math.floor(1_000_000_000 + Math.random() * 8_999_999_999);
    const sampleCounter = Math.floor(1 + Math.random() * 99);
    await renderServiceRulesScreen(ctx, undefined, { sampleId, sampleCounter });
  });

  registerAdminRoute('adm:cfg:svc:dmode', async (ctx) => {
    if (!ctx.services) return;
    const cur = ctx.services.translationService.getSetting('package_display_mode', 'specs');
    await ctx.services.translationService.updateSetting(
      'package_display_mode',
      cur === 'name' ? 'specs' : 'name'
    );
    await renderServiceRulesScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute('adm:cfg:svc:mode', async (ctx) => {
    if (!ctx.services) return;
    const current = ctx.services.translationService.getSetting('naming_mode', 'custom');
    const modes = [
      'prefix_number',
      'telegramid_number',
      'prefix_telegramid_number',
      'prefix_random',
      'random_alphanumeric',
      'prefix_date_counter',
      'custom',
    ] as const;
    const kb = new InlineKeyboard();
    for (const m of modes) {
      kb.text(
        `${current === m ? '✅ ' : ''}${t(ctx, `admin_setting_naming_mode_${m}`)}`,
        `adm:cfg:svc:setm:${m}`
      ).row();
    }
    appendAdminFooterNav(kb, ctx, { backCallback: 'adm:cfg:svc' });
    await renderScreen(
      ctx,
      buildAdminScreen({
        emoji: '🏷️',
        title: t(ctx, 'admin_setting_naming_mode'),
      }),
      { parse_mode: 'Markdown', reply_markup: kb }
    );
  });

  registerAdminRoute(/^adm:cfg:svc:setm:([a-z_]+)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const mode = validateAdminSetting('naming_mode', match![1]!);
    if (mode) {
      await ctx.services.translationService.updateSetting('naming_mode', mode);
      await ctx.services.configService.syncCounters().catch(() => {
        // best-effort sync
      });
    }
    await renderServiceRulesScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute('adm:cfg:svc:tmpl', async (ctx) => {
    if (!ctx.services) return;
    const current = ctx.services.translationService.getSetting(
      'custom_naming_template',
      '{prefix}_{telegram_id}_{counter}'
    );
    const kb = adminInputCancelKeyboard(ctx, (inner) => {
      for (const p of NAMING_TEMPLATE_PRESETS) {
        inner
          .text(
            `\u200e${current === p.template ? '✅ ' : '🧩 '}${p.template}\u200e`,
            `adm:cfg:svc:tpl:${p.id}`
          )
          .row();
      }
    });
    await startAdminInput(ctx, {
      kind: 'cfg:naming_template',
      returnRoute: 'adm:cfg:svc',
      promptText: buildAdminPromptScreen({
        emoji: '🎨',
        title: t(ctx, 'admin_setting_custom_naming_template'),
        body:
          t(ctx, 'admin_naming_template_label') + `: \`${sanitizeTelegramInlineCode(current)}\``,
      }),
      keyboard: kb,
    });
  });

  registerAdminRoute(/^adm:cfg:svc:tpl:([a-z0-9_]+)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const preset = NAMING_TEMPLATE_PRESETS.find((p) => p.id === match![1]);
    if (!preset) return;
    await ctx.services.translationService.updateSetting('custom_naming_template', preset.template);
    await ctx.services.translationService.updateSetting('naming_mode', 'custom');
    await ctx.services.configService.syncCounters().catch(() => {
      // best-effort sync
    });
    await renderServiceRulesScreen(ctx, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminInputHandler('cfg:naming_template', async (ctx, rawText) => {
    if (!ctx.services) return { status: 'done' };
    if (!isValidNamingTemplate(rawText)) {
      const current = ctx.services.translationService.getSetting(
        'custom_naming_template',
        '{prefix}_{telegram_id}_{counter}'
      );
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '🎨',
          title: t(ctx, 'admin_setting_custom_naming_template'),
          body: `${t(ctx, 'admin_naming_template_label')}: \`${sanitizeTelegramInlineCode(current)}\``,
          error: t(ctx, 'admin_setting_naming_template_invalid'),
        }),
      };
    }
    const normalized = normalizeNamingTemplate(rawText);
    await ctx.services.translationService.updateSetting('custom_naming_template', normalized);
    await ctx.services.translationService.updateSetting('naming_mode', 'custom');
    await ctx.services.configService.syncCounters().catch(() => {
      // best-effort sync
    });
    return {
      status: 'done',
      redirectRoute: 'adm:cfg:svc',
      notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
    };
  });

  // ── Web Mini App routes (`adm:cfg:web:*`) ──
  registerAdminRoute('adm:cfg:web:tg', async (ctx) => {
    if (!ctx.services) return;
    const ts = ctx.services.translationService;
    const enabled = ts.getSettingBool('webapp_enabled', false) && Boolean(ctx.services.webAppUrl);
    const webAppUrl = ctx.services.webAppUrl || ts.getSetting('webapp_url', '').trim();
    if (enabled) {
      await ctx.services.disableWebApp?.();
      await renderWebAppScreen(ctx, {
        tone: 'info',
        text: t(ctx, 'admin_webapp_disabled_success'),
      });
      return;
    }
    if (!webAppUrl) {
      const port = ctx.services.webAppHostPort ?? ctx.services.webAppPort ?? 3002;
      const ip = sanitizeTelegramInlineCode(
        (await getServerPublicIp().catch(() => '')) || 'SERVER_IP'
      );
      await startAdminInput(ctx, {
        kind: 'cfg:webapp_url',
        returnRoute: 'adm:cfg:web',
        promptText: buildAdminPromptScreen({
          emoji: '🌐',
          title: t(ctx, 'admin_webapp_prompt_title'),
          body: t(ctx, 'admin_webapp_prompt_url', { port, serverIp: ip }),
        }),
      });
      return;
    }
    const res = await ctx.services.enableWebApp?.(webAppUrl);
    if (!res?.success) {
      await renderWebAppScreen(ctx, {
        tone: 'error',
        text: escapeTelegramMarkdown(res?.error || t(ctx, 'operation_failed')),
      });
      return;
    }
    const safeUrl = sanitizeTelegramInlineCode(res.normalizedUrl || webAppUrl);
    await renderWebAppScreen(ctx, {
      tone: 'success',
      text: res.sslActive
        ? t(ctx, 'admin_webapp_enabled_success', { url: safeUrl })
        : t(ctx, 'admin_webapp_enabled_pending_ssl', { url: safeUrl }),
    });
  });

  registerAdminRoute('adm:cfg:web:url', async (ctx) => {
    if (!ctx.services) return;
    const port = ctx.services.webAppHostPort ?? ctx.services.webAppPort ?? 3002;
    const ip = sanitizeTelegramInlineCode(
      (await getServerPublicIp().catch(() => '')) || 'SERVER_IP'
    );
    await startAdminInput(ctx, {
      kind: 'cfg:webapp_url',
      returnRoute: 'adm:cfg:web',
      promptText: buildAdminPromptScreen({
        emoji: '🌐',
        title: t(ctx, 'admin_webapp_prompt_title'),
        body: t(ctx, 'admin_webapp_prompt_url', { port, serverIp: ip }),
      }),
    });
  });

  registerAdminInputHandler('cfg:webapp_url', async (ctx, rawText) => {
    if (!ctx.services) return { status: 'done' };
    const normalized = normalizeDomainInput(rawText.trim());
    if (!normalized.valid) {
      const port = ctx.services.webAppHostPort ?? ctx.services.webAppPort ?? 3002;
      const ip = sanitizeTelegramInlineCode(
        (await getServerPublicIp().catch(() => '')) || 'SERVER_IP'
      );
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '🌐',
          title: t(ctx, 'admin_webapp_invalid_url_title'),
          body: t(ctx, 'admin_webapp_prompt_url', { port, serverIp: ip }),
          error: t(ctx, 'admin_webapp_invalid_url'),
        }),
      };
    }
    const serverIp = (await getServerPublicIp().catch(() => '')) || '';
    const dnsResult = await checkDomainDns(normalized.hostname, serverIp);
    if (dnsResult.resolved && !dnsResult.matchesServer && serverIp) {
      if (ctx.session) {
        ctx.session.adminDraft = { kind: 'webapp_url', url: normalized.url };
      }
      await renderScreen(
        ctx,
        buildAdminScreen({
          emoji: '⚠️',
          title: t(ctx, 'admin_webapp_dns_warning_title'),
          footer: t(ctx, 'admin_webapp_dns_mismatch_warning', {
            domain: sanitizeTelegramInlineCode(normalized.hostname),
            resolvedIp: sanitizeTelegramInlineCode(dnsResult.ips.join(', ') || 'N/A'),
            serverIp: sanitizeTelegramInlineCode(serverIp),
          }),
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: buildAdminConfirmKeyboard(ctx, {
            confirmCallback: 'adm:cfg:web:proceed',
            cancelCallback: 'adm:cfg:web',
            confirmLabel: t(ctx, 'admin_webapp_dns_btn_proceed'),
            cancelLabel: t(ctx, 'admin_webapp_dns_btn_cancel'),
          }),
        }
      );
      return { status: 'handled' };
    }
    const res = await ctx.services.enableWebApp?.(normalized.url);
    if (!res?.success) {
      return {
        status: 'done',
        redirectRoute: 'adm:cfg:web',
        notice: {
          tone: 'error',
          text: escapeTelegramMarkdown(res?.error || t(ctx, 'operation_failed')),
        },
      };
    }
    const safeUrl = sanitizeTelegramInlineCode(res.normalizedUrl || normalized.url);
    return {
      status: 'done',
      redirectRoute: 'adm:cfg:web',
      notice: {
        tone: 'success',
        text: res.sslActive
          ? t(ctx, 'admin_webapp_enabled_success', { url: safeUrl })
          : t(ctx, 'admin_webapp_enabled_pending_ssl', { url: safeUrl }),
      },
    };
  });

  registerAdminRoute('adm:cfg:web:proceed', async (ctx) => {
    if (!ctx.services) return;
    const url = String(ctx.session?.adminDraft?.url ?? '');
    if (ctx.session) delete ctx.session.adminDraft;
    if (!url) {
      await renderWebAppScreen(ctx);
      return;
    }
    const res = await ctx.services.enableWebApp?.(url);
    if (!res?.success) {
      await renderWebAppScreen(ctx, {
        tone: 'error',
        text: escapeTelegramMarkdown(res?.error || t(ctx, 'operation_failed')),
      });
      return;
    }
    const safeUrl = sanitizeTelegramInlineCode(res.normalizedUrl || url);
    await renderWebAppScreen(ctx, {
      tone: 'success',
      text: res.sslActive
        ? t(ctx, 'admin_webapp_enabled_success', { url: safeUrl })
        : t(ctx, 'admin_webapp_enabled_pending_ssl', { url: safeUrl }),
    });
  });

  // Dedicated DNS/SSL Diagnostics screen (NEVER overwritten!)
  registerAdminRoute('adm:cfg:web:dns', async (ctx) => {
    if (!ctx.services) return;
    markAdminContext(ctx);
    const webAppUrl =
      ctx.services.webAppUrl || ctx.services.translationService.getSetting('webapp_url', '').trim();
    const normalized = normalizeDomainInput(webAppUrl);
    if (!normalized.valid) {
      await renderWebAppScreen(ctx, { tone: 'error', text: t(ctx, 'admin_webapp_invalid_url') });
      return;
    }
    const serverIp = (await getServerPublicIp().catch(() => '')) || '';
    const [dnsResult, sslProbe] = await Promise.all([
      checkDomainDns(normalized.hostname, serverIp),
      verifyDomainSslAndReachability(normalized.url, 6000),
    ]);
    const dnsStatus = !dnsResult.resolved
      ? t(ctx, 'admin_webapp_dns_unresolved')
      : dnsResult.matchesServer || !serverIp
        ? t(ctx, 'admin_webapp_dns_match_ok')
        : t(ctx, 'admin_webapp_dns_match_mismatch');

    const text = buildAdminScreen({
      emoji: sslProbe.ok ? '✅' : '⚠️',
      title: t(ctx, 'admin_webapp_dns_check_title'),
      breadcrumb: buildBreadcrumb(
        t(ctx, 'admin_menu_settings'),
        t(ctx, 'admin_webapp_title'),
        t(ctx, 'admin_webapp_dns_check_title')
      ),
      sections: [
        {
          fields: [
            {
              label: t(ctx, 'admin_webapp_url_label'),
              value: `\`${sanitizeTelegramInlineCode(normalized.url)}\``,
            },
            { label: t(ctx, 'admin_webapp_dns_status_label'), value: dnsStatus },
            ...(dnsResult.ips.length > 0
              ? [
                  {
                    label: t(ctx, 'admin_webapp_dns_ips_label'),
                    value: `\`${sanitizeTelegramInlineCode(dnsResult.ips.join(', '))}\``,
                  },
                ]
              : []),
            ...(serverIp
              ? [
                  {
                    label: t(ctx, 'admin_webapp_server_ip_label'),
                    value: `\`${sanitizeTelegramInlineCode(serverIp)}\``,
                  },
                ]
              : []),
            {
              label: t(ctx, 'admin_webapp_ssl_status_label'),
              value: sslProbe.ok
                ? t(ctx, 'admin_webapp_ssl_reachable')
                : t(ctx, 'admin_webapp_ssl_unreachable'),
            },
            ...(!sslProbe.ok && sslProbe.error
              ? [
                  {
                    label: t(ctx, 'admin_webapp_ssl_error_note'),
                    value: escapeTelegramMarkdown(sslProbe.error),
                  },
                ]
              : []),
          ],
        },
      ],
    });
    const kb = new InlineKeyboard()
      .text(t(ctx, 'admin_broadcast_refresh_button'), 'adm:cfg:web:dns')
      .row();
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:cfg:web',
      backLabel: `‹ ${t(ctx, 'admin_webapp_title')}`,
      showHome: true,
    });
    await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
  });

  // ── Backup send now (`adm:cfg:bak:send`) ──
  registerAdminRoute('adm:cfg:bak:send', async (ctx) => {
    if (!ctx.services) return;
    const targetChatId = ctx.services.translationService
      .getSetting('backup_target_chat_id', '')
      .trim();
    if (!targetChatId) {
      await renderBackupScreen(ctx, {
        tone: 'warning',
        text: t(ctx, 'admin_setting_not_configured'),
      });
      return;
    }
    await ctx.answerCallbackQuery({ text: t(ctx, 'admin_backup_sending_notice') }).catch(() => {
      // ignore already-answered callback
    });
    const result = await ctx.services.backupService.sendBackupToChat(ctx.api, targetChatId, {
      label: 'manual_backup',
      locale: ctx.userLocale ?? 'fa',
    });
    await renderBackupScreen(ctx, {
      tone: result.success ? 'success' : 'error',
      text: result.success
        ? t(ctx, 'admin_backup_send_success')
        : t(ctx, 'admin_backup_send_failed', {
            error: escapeTelegramMarkdown(result.error ?? 'Unknown error'),
          }),
    });
  });

  // ── Bank Cards Stateless Routes (`adm:bc:*`) ──
  registerAdminRoute(/^adm:bc:p:(\d+)$/u, async (ctx, match, notice) => {
    await renderBankCardsListScreen(ctx, Number(match?.[1]) || 1, notice);
  });

  registerAdminRoute(/^adm:bc:v:([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match, notice) => {
    await renderBankCardDetailScreen(ctx, match![1]!, notice);
  });

  registerAdminRoute('adm:bc:imp', async (ctx) => {
    const { cards, legacyCard } = await loadBankCardsSnapshot(ctx);
    if (!legacyCard || cards.length > 0) {
      await renderBankCardsListScreen(ctx, 1);
      return;
    }
    const locale = resolveContextLocale(ctx);
    const detected = detectIranianBankName(legacyCard.cardNumber, locale);
    const imported: BankCardConfig = {
      id: generateBankCardId([]),
      cardNumber: legacyCard.cardNumber,
      cardHolder: legacyCard.cardHolder || '—',
      enabled: true,
      dailyCapToman: null,
      ...(detected ? { bankName: detected } : {}),
    };
    await persistBankCards(ctx, [imported]);
    await renderBankCardDetailScreen(ctx, imported.id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:bc:tg:([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match) => {
    const id = match![1]!;
    const { cards } = await loadBankCardsSnapshot(ctx);
    const next = cards
      .map(stripCardStatus)
      .map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c));
    await persistBankCards(ctx, next);
    await renderBankCardDetailScreen(ctx, id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:bc:mv:(up|dn):([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match) => {
    const dir = match![1] === 'up' ? -1 : 1;
    const id = match![2]!;
    const { cards } = await loadBankCardsSnapshot(ctx);
    const list = cards.map(stripCardStatus);
    const idx = list.findIndex((c) => c.id === id);
    const target = idx + dir;
    if (idx >= 0 && target >= 0 && target < list.length) {
      const [moved] = list.splice(idx, 1);
      list.splice(target, 0, moved!);
      await persistBankCards(ctx, list);
    }
    await renderBankCardDetailScreen(ctx, id);
  });

  registerAdminRoute(/^adm:bc:del:([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match) => {
    const id = match![1]!;
    const { cards } = await loadBankCardsSnapshot(ctx);
    const card = cards.find((c) => c.id === id);
    if (!card) {
      await renderBankCardsListScreen(ctx, 1);
      return;
    }
    await renderScreen(
      ctx,
      buildAdminScreen({
        emoji: '🗑️',
        title: t(ctx, 'admin_bank_cards_delete_title'),
        footer: tm(
          ctx,
          'admin_bank_cards_delete_confirm_prompt',
          {
            card: sanitizeTelegramInlineCode(formatCardNumberGrouped(card.cardNumber)),
            holder: card.cardHolder || '—',
          },
          ['card']
        ),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: buildAdminConfirmKeyboard(ctx, {
          confirmCallback: `adm:bc:del_ok:${id}`,
          cancelCallback: `adm:bc:v:${id}`,
          confirmLabel: t(ctx, 'admin_bank_cards_delete_confirm_button'),
        }),
      }
    );
  });

  registerAdminRoute(/^adm:bc:del_ok:([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match) => {
    const id = match![1]!;
    const { cards } = await loadBankCardsSnapshot(ctx);
    await persistBankCards(
      ctx,
      cards.map(stripCardStatus).filter((c) => c.id !== id)
    );
    await renderBankCardsListScreen(ctx, 1, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  // Bank Card single-field edits & presets
  registerAdminRoute(/^adm:bc:ed:(num|hld|bnk|cap):([a-zA-Z0-9_-]{1,64})$/u, async (ctx, match) => {
    const field = match![1]!;
    const id = match![2]!;
    const { cards } = await loadBankCardsSnapshot(ctx);
    const card = cards.find((c) => c.id === id);
    if (!card) {
      await renderBankCardsListScreen(ctx, 1);
      return;
    }
    const promptKeyMap: Record<string, string> = {
      num: 'admin_bank_cards_prompt_number',
      hld: 'admin_bank_cards_prompt_holder',
      bnk: 'admin_bank_cards_prompt_bank',
      cap: 'admin_bank_cards_prompt_cap',
    };
    const autoBank = detectIranianBankName(card.cardNumber, resolveContextLocale(ctx));
    const keyboard = adminInputCancelKeyboard(ctx, (kb) => {
      if (field === 'bnk') {
        if (autoBank) {
          kb.text(
            truncateButtonLabel(
              t(ctx, 'admin_bank_cards_bank_auto_button', { bank: autoBank }),
              56
            ),
            `adm:bc:setbnk:${id}:auto`
          ).row();
        }
        kb.text(t(ctx, 'admin_bank_cards_bank_skip_button'), `adm:bc:setbnk:${id}:skip`).row();
      } else if (field === 'cap') {
        kb.text(t(ctx, 'admin_bank_cards_cap_unlimited_button'), `adm:bc:setcap:${id}:0`).row();
        for (let i = 0; i < DAILY_CAP_PRESETS.length; i += 2) {
          const a = DAILY_CAP_PRESETS[i]!;
          kb.text(
            `${localizedNumber(a, ctx)} ${t(ctx, 'currency_toman')}`,
            `adm:bc:setcap:${id}:${a}`
          );
          const b = DAILY_CAP_PRESETS[i + 1];
          if (b !== undefined) {
            kb.text(
              `${localizedNumber(b, ctx)} ${t(ctx, 'currency_toman')}`,
              `adm:bc:setcap:${id}:${b}`
            );
          }
          kb.row();
        }
      }
    });
    await startAdminInput(ctx, {
      kind: 'bc:edit_field',
      payload: { id, field },
      returnRoute: `adm:bc:v:${id}`,
      promptText: buildAdminPromptScreen({
        emoji: '💳',
        title: t(ctx, 'admin_bank_cards_detail_title'),
        body: t(ctx, promptKeyMap[field]!),
      }),
      keyboard,
    });
  });

  registerAdminRoute(/^adm:bc:setbnk:([a-zA-Z0-9_-]{1,64}):(auto|skip)$/u, async (ctx, match) => {
    const id = match![1]!;
    const mode = match![2]!;
    const { cards } = await loadBankCardsSnapshot(ctx);
    const list = cards.map(stripCardStatus).map((c) => {
      if (c.id !== id) return c;
      const autoBank =
        mode === 'auto'
          ? detectIranianBankName(c.cardNumber, resolveContextLocale(ctx))
          : undefined;
      const updated: BankCardConfig = {
        id: c.id,
        cardNumber: c.cardNumber,
        cardHolder: c.cardHolder,
        enabled: c.enabled,
        dailyCapToman: c.dailyCapToman ?? null,
      };
      if (autoBank) updated.bankName = autoBank;
      return updated;
    });
    await persistBankCards(ctx, list);
    await renderBankCardDetailScreen(ctx, id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminRoute(/^adm:bc:setcap:([a-zA-Z0-9_-]{1,64}):(\d+)$/u, async (ctx, match) => {
    const id = match![1]!;
    const raw = Number(match![2]);
    const cap = raw === 0 ? null : raw;
    const { cards } = await loadBankCardsSnapshot(ctx);
    await persistBankCards(
      ctx,
      cards.map(stripCardStatus).map((c) => (c.id === id ? { ...c, dailyCapToman: cap } : c))
    );
    await renderBankCardDetailScreen(ctx, id, {
      tone: 'success',
      text: t(ctx, 'admin_setting_saved_title'),
    });
  });

  registerAdminInputHandler('bc:edit_field', async (ctx, rawText, state) => {
    const id = String(state.payload?.id ?? '');
    const field = String(state.payload?.field ?? '');
    const { cards } = await loadBankCardsSnapshot(ctx);
    const list = cards.map(stripCardStatus);
    const promptKeyMap: Record<string, string> = {
      num: 'admin_bank_cards_prompt_number',
      hld: 'admin_bank_cards_prompt_holder',
      bnk: 'admin_bank_cards_prompt_bank',
      cap: 'admin_bank_cards_prompt_cap',
    };
    const retry = (errKey: string) => ({
      status: 'retry' as const,
      promptText: buildAdminPromptScreen({
        emoji: '💳',
        title: t(ctx, 'admin_bank_cards_detail_title'),
        body: t(ctx, promptKeyMap[field] ?? 'admin_bank_cards_prompt_number'),
        error: t(ctx, errKey),
      }),
    });

    if (field === 'num') {
      const normalized = normalizeCardNumber(rawText);
      if (!isValidBankCardNumber(normalized)) return retry('admin_setting_card_invalid');
      if (hasDuplicateCardNumber(list, normalized, id))
        return retry('admin_bank_cards_duplicate_number');
      await persistBankCards(
        ctx,
        list.map((c) => (c.id === id ? { ...c, cardNumber: normalized } : c))
      );
    } else if (field === 'hld') {
      const holder = rawText.trim();
      if (holder.length < 1 || holder.length > 120) return retry('admin_bank_cards_holder_invalid');
      await persistBankCards(
        ctx,
        list.map((c) => (c.id === id ? { ...c, cardHolder: holder } : c))
      );
    } else if (field === 'bnk') {
      const bank = rawText.trim();
      if (bank.length > 60) return retry('admin_bank_cards_bank_invalid');
      await persistBankCards(
        ctx,
        list.map((c) => {
          if (c.id !== id) return c;
          const updated: BankCardConfig = {
            id: c.id,
            cardNumber: c.cardNumber,
            cardHolder: c.cardHolder,
            enabled: c.enabled,
            dailyCapToman: c.dailyCapToman ?? null,
          };
          if (bank) updated.bankName = bank;
          return updated;
        })
      );
    } else if (field === 'cap') {
      const norm = normalizeInputDigits(rawText.trim());
      if (norm === '0' || rawText.trim() === '-' || rawText.trim().toLowerCase() === 'unlimited') {
        await persistBankCards(
          ctx,
          list.map((c) => (c.id === id ? { ...c, dailyCapToman: null } : c))
        );
      } else if (/^\d+$/u.test(norm) && Number(norm) > 0) {
        await persistBankCards(
          ctx,
          list.map((c) => (c.id === id ? { ...c, dailyCapToman: Number(norm) } : c))
        );
      } else {
        return retry('admin_bank_cards_cap_invalid');
      }
    }
    return {
      status: 'done',
      redirectRoute: `adm:bc:v:${id}`,
      notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
    };
  });

  // Add new bank card via non-blocking draft + adminInput
  registerAdminRoute('adm:bc:add', async (ctx) => {
    const { cards } = await loadBankCardsSnapshot(ctx);
    if (cards.length >= MAX_BANK_CARDS) {
      await renderBankCardsListScreen(ctx, 1, {
        tone: 'warning',
        text: t(ctx, 'admin_bank_cards_limit_reached', {
          count: localizedNumber(MAX_BANK_CARDS, ctx),
        }),
      });
      return;
    }
    if (ctx.session) ctx.session.adminDraft = { kind: 'bc_add' } satisfies BankCardDraft;
    await startAdminInput(ctx, {
      kind: 'bc:add:step',
      payload: { step: 'num' },
      returnRoute: 'adm:bc:p:1',
      promptText: buildAdminPromptScreen({
        emoji: '💳',
        title: t(ctx, 'admin_sales_bank_cards_add_button'),
        body: t(ctx, 'admin_bank_cards_prompt_number'),
      }),
    });
  });

  registerAdminRoute('adm:bc:luhn:ok', async (ctx) => {
    await startAdminInput(ctx, {
      kind: 'bc:add:step',
      payload: { step: 'hld' },
      returnRoute: 'adm:bc:p:1',
      promptText: buildAdminPromptScreen({
        emoji: '👤',
        title: t(ctx, 'admin_setting_card_holder'),
        body: t(ctx, 'admin_bank_cards_prompt_holder'),
      }),
    });
  });

  registerAdminInputHandler('bc:add:step', async (ctx, rawText, state) => {
    const step = String(state.payload?.step ?? 'num');
    const draft = (ctx.session?.adminDraft as BankCardDraft | undefined) ?? { kind: 'bc_add' };
    const { cards } = await loadBankCardsSnapshot(ctx);
    const rawList = cards.map(stripCardStatus);

    if (step === 'num') {
      const normalized = normalizeCardNumber(rawText);
      if (!isValidBankCardNumber(normalized)) {
        return {
          status: 'retry',
          promptText: buildAdminPromptScreen({
            emoji: '💳',
            title: t(ctx, 'admin_setting_card_number'),
            body: t(ctx, 'admin_bank_cards_prompt_number'),
            error: t(ctx, 'admin_setting_card_invalid'),
          }),
        };
      }
      if (hasDuplicateCardNumber(rawList, normalized)) {
        return {
          status: 'retry',
          promptText: buildAdminPromptScreen({
            emoji: '💳',
            title: t(ctx, 'admin_setting_card_number'),
            body: t(ctx, 'admin_bank_cards_prompt_number'),
            error: t(ctx, 'admin_bank_cards_duplicate_number'),
          }),
        };
      }
      draft.cardNumber = normalized;
      if (ctx.session) ctx.session.adminDraft = draft as unknown as Record<string, unknown>;
      if (normalized.length === 16 && !isValidLuhnCardNumber(normalized)) {
        await renderScreen(
          ctx,
          buildAdminScreen({
            emoji: '🔎',
            title: t(ctx, 'admin_bank_cards_luhn_warning_title'),
            footer: tm(
              ctx,
              'admin_bank_cards_luhn_warning_body',
              { card: sanitizeTelegramInlineCode(formatCardNumberGrouped(normalized)) },
              ['card']
            ),
          }),
          {
            parse_mode: 'Markdown',
            reply_markup: buildAdminConfirmKeyboard(ctx, {
              confirmCallback: 'adm:bc:luhn:ok',
              cancelCallback: 'adm:bc:add',
              confirmLabel: t(ctx, 'admin_bank_cards_luhn_confirm_button'),
              cancelLabel: t(ctx, 'admin_bank_cards_luhn_retry_button'),
            }),
          }
        );
        return { status: 'handled' };
      }
      await startAdminInput(ctx, {
        kind: 'bc:add:step',
        payload: { step: 'hld' },
        returnRoute: 'adm:bc:p:1',
        promptText: buildAdminPromptScreen({
          emoji: '👤',
          title: t(ctx, 'admin_setting_card_holder'),
          body: t(ctx, 'admin_bank_cards_prompt_holder'),
        }),
      });
      return { status: 'handled' };
    }

    const holder = rawText.trim();
    if (holder.length < 1 || holder.length > 120) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '👤',
          title: t(ctx, 'admin_setting_card_holder'),
          body: t(ctx, 'admin_bank_cards_prompt_holder'),
          error: t(ctx, 'admin_bank_cards_holder_invalid'),
        }),
      };
    }
    const cardNumber = draft.cardNumber ?? '';
    const autoBank = detectIranianBankName(cardNumber, resolveContextLocale(ctx));
    const created: BankCardConfig = {
      id: generateBankCardId(rawList),
      cardNumber,
      cardHolder: holder,
      enabled: true,
      dailyCapToman: null,
      ...(autoBank ? { bankName: autoBank } : {}),
    };
    await persistBankCards(ctx, [...rawList, created]);
    if (ctx.session) delete ctx.session.adminDraft;
    return {
      status: 'done',
      redirectRoute: `adm:bc:v:${created.id}`,
      notice: { tone: 'success', text: t(ctx, 'admin_setting_saved_title') },
    };
  });

  void buildAdminEmptyState;
}
