import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { logger } from '../../../infra/logger.js';
import { localizedNumber, t } from '../../locale.js';
import {
  DEFAULT_SETTINGS,
  templatePlaceholders,
  validateTranslationOverrideDetailed,
  type SupportedLocale,
} from '../../../domain/services/TranslationService.js';
import {
  acceptConversationOwner,
  buildEmptyState,
  buildPromptScreen,
  buildScreen,
  conversationOwnerId,
  deleteConsumedInputMessage,
  forwardConversationNavigation,
  handleAdminConversationCancel,
  promptInConversation,
  replyInAdminConversation,
} from '../../ui.js';
import { requireAdmin } from './shared.js';
import { escapeTelegramMarkdown, validateTelegramMarkdown } from '../../rendering.js';

// ── Essential User-Facing Texts ───────────────────────────────────────────────

export type EssentialTextItem = {
  id: string;
  key: string;
  labelKey: string;
  descKey: string;
};

export const ESSENTIAL_USER_TEXTS: readonly EssentialTextItem[] = [
  {
    id: 'welcome',
    key: 'welcome',
    labelKey: 'admin_text_item_welcome',
    descKey: 'admin_text_desc_welcome',
  },
  {
    id: 'onboarding_welcome',
    key: 'onboarding_welcome',
    labelKey: 'admin_text_item_onboarding',
    descKey: 'admin_text_desc_onboarding',
  },
  {
    id: 'shop',
    key: 'shop',
    labelKey: 'admin_text_item_shop',
    descKey: 'admin_text_desc_shop',
  },
  {
    id: 'topup_subtitle',
    key: 'topup_subtitle',
    labelKey: 'admin_text_item_topup',
    descKey: 'admin_text_desc_topup',
  },
  {
    id: 'payment_method_card_to_card_desc',
    key: 'payment_method_card_to_card_desc',
    labelKey: 'admin_text_item_card_to_card',
    descKey: 'admin_text_desc_card_to_card',
  },
  {
    id: 'trial_preview_subtitle',
    key: 'trial_preview_subtitle',
    labelKey: 'admin_text_item_trial',
    descKey: 'admin_text_desc_trial',
  },
  {
    id: 'trial_terms',
    key: 'trial_terms',
    labelKey: 'admin_text_item_trial_terms',
    descKey: 'admin_text_desc_trial_terms',
  },
  {
    id: 'referral_subtitle',
    key: 'referral_subtitle',
    labelKey: 'admin_text_item_referral',
    descKey: 'admin_text_desc_referral',
  },
  {
    id: 'support_message',
    key: 'support_message',
    labelKey: 'admin_text_item_support',
    descKey: 'admin_text_desc_support',
  },
  {
    id: 'bot_maintenance_message',
    key: 'bot_maintenance_message',
    labelKey: 'admin_text_item_maintenance',
    descKey: 'admin_text_desc_maintenance',
  },
  {
    id: 'home_near_expiry_warning',
    key: 'home_near_expiry_warning',
    labelKey: 'admin_text_item_expiry_warning',
    descKey: 'admin_text_desc_expiry_warning',
  },
  {
    id: 'transfer_subtitle',
    key: 'transfer_subtitle',
    labelKey: 'admin_text_item_service_transfer',
    descKey: 'admin_text_desc_service_transfer',
  },
  {
    id: 'wallet_transfer_subtitle',
    key: 'wallet_transfer_subtitle',
    labelKey: 'admin_text_item_wallet_transfer',
    descKey: 'admin_text_desc_wallet_transfer',
  },
];

// ── Categories Definition (100% Coverage of All Keys) ─────────────────────────

export type TextCategory = {
  id: string;
  labelKey: string;
  descriptionKey: string;
  matches: (key: string) => boolean;
};

export const TEXT_CATEGORIES: readonly TextCategory[] = [
  {
    id: 'user_home',
    labelKey: 'admin_text_cat_user_home',
    descriptionKey: 'admin_text_cat_desc_user_home',
    matches: (k) =>
      k.startsWith('onboarding_') ||
      k.startsWith('home_') ||
      k.startsWith('welcome') ||
      k.startsWith('main_menu') ||
      k.startsWith('ui_status_') ||
      [
        'service_unit',
        'days_unit',
        'hours_unit',
        'remaining',
        'expiry',
        'renewing',
        'traffic_unit_gb',
        'cached_data_label',
        'currency_toman',
      ].includes(k),
  },
  {
    id: 'user_shop',
    labelKey: 'admin_text_cat_user_shop',
    descriptionKey: 'admin_text_cat_desc_user_shop',
    matches: (k) =>
      k.startsWith('shop') ||
      k.startsWith('purchase_') ||
      k.startsWith('buy_') ||
      k.startsWith('package_') ||
      k.startsWith('custom_') ||
      k.startsWith('checkout_') ||
      k.startsWith('insufficient_balance') ||
      k.startsWith('no_subscriptions') ||
      k.startsWith('unlimited'),
  },
  {
    id: 'user_renewals',
    labelKey: 'admin_text_cat_user_renewals',
    descriptionKey: 'admin_text_cat_desc_user_renewals',
    matches: (k) =>
      k.startsWith('renewal_') ||
      k.startsWith('renew_') ||
      k.startsWith('auto_renew_') ||
      k.startsWith('claim_') ||
      k.startsWith('claimed_'),
  },
  {
    id: 'user_wallet',
    labelKey: 'admin_text_cat_user_wallet',
    descriptionKey: 'admin_text_cat_desc_user_wallet',
    matches: (k) =>
      (k.startsWith('wallet_') && !k.startsWith('wallet_transfer_')) ||
      k.startsWith('topup_') ||
      k.startsWith('payment_method_') ||
      k.startsWith('direct_topup_button') ||
      k.startsWith('balance') ||
      k.startsWith('invalid_amount') ||
      k.startsWith('receipt_'),
  },
  {
    id: 'user_trial_promo',
    labelKey: 'admin_text_cat_user_trial_promo',
    descriptionKey: 'admin_text_cat_desc_user_trial_promo',
    matches: (k) =>
      k.startsWith('trial_') ||
      (k.startsWith('promo_') && !k.startsWith('admin_promo_')) ||
      k.startsWith('referral_') ||
      k.startsWith('wheel_') ||
      k.startsWith('lucky_wheel_'),
  },
  {
    id: 'user_services',
    labelKey: 'admin_text_cat_user_services',
    descriptionKey: 'admin_text_cat_desc_user_services',
    matches: (k) =>
      k.startsWith('subscription_') ||
      (k.startsWith('config_') && !k.startsWith('admin_config_')) ||
      k === 'subscriptions_loading' ||
      k === 'traffic_unavailable',
  },
  {
    id: 'user_transfers',
    labelKey: 'admin_text_cat_user_transfers',
    descriptionKey: 'admin_text_cat_desc_user_transfers',
    matches: (k) =>
      k.startsWith('transfer_') ||
      k.startsWith('wallet_transfer_') ||
      k.startsWith('refund_reason_'),
  },
  {
    id: 'user_support_system',
    labelKey: 'admin_text_cat_user_support_system',
    descriptionKey: 'admin_text_cat_desc_user_support_system',
    matches: (k) =>
      k.startsWith('support_') ||
      k.startsWith('bot_maintenance_') ||
      k.startsWith('access_denied') ||
      k.startsWith('rate_limited') ||
      k === 'private_chat_only' ||
      k.startsWith('panel_origin_down_user_notice') ||
      k.startsWith('button_') ||
      k.startsWith('navigation_') ||
      k === 'unexpected_text_hint' ||
      k.startsWith('pagination_') ||
      k.startsWith('user_not_found') ||
      k.startsWith('menu_') ||
      k.startsWith('language_') ||
      k.startsWith('operation_') ||
      k.startsWith('text_input_') ||
      k.startsWith('photo_input_'),
  },
  {
    id: 'admin_settings_panels',
    labelKey: 'admin_text_cat_admin_settings_panels',
    descriptionKey: 'admin_text_cat_desc_admin_settings_panels',
    matches: (k) =>
      k.startsWith('admin_menu_') ||
      k.startsWith('admin_setting_') ||
      k.startsWith('admin_panel_') ||
      k.startsWith('admin_backup_') ||
      k.startsWith('admin_pricing_') ||
      k.startsWith('admin_category_') ||
      k === 'admin_bootstrap_env' ||
      k === 'admin_menu_title' ||
      k.startsWith('admin_text_'),
  },
  {
    id: 'admin_users_messages',
    labelKey: 'admin_text_cat_admin_users_messages',
    descriptionKey: 'admin_text_cat_desc_admin_users_messages',
    matches: (k) =>
      k.startsWith('admin_user_') ||
      k.startsWith('admin_search_') ||
      k.startsWith('admin_username_') ||
      k.startsWith('admin_name_') ||
      k.startsWith('admin_referrer_') ||
      k.startsWith('admin_yes') ||
      k.startsWith('admin_no') ||
      k.startsWith('admin_banned') ||
      k.startsWith('admin_active') ||
      k.startsWith('admin_profile_') ||
      k.startsWith('admin_target_') ||
      k.startsWith('admin_invalid_telegram_id') ||
      k.startsWith('admin_broadcast_') ||
      k.startsWith('admin_direct_') ||
      k.startsWith('admin_receipt_') ||
      k.startsWith('admin_pending_receipt') ||
      k.startsWith('admin_no_pending_receipts') ||
      k.startsWith('admin_admin_') ||
      k.startsWith('admin_registry_'),
  },
  {
    id: 'admin_finance_sales',
    labelKey: 'admin_text_cat_admin_finance_sales',
    descriptionKey: 'admin_text_cat_desc_admin_finance_sales',
    matches: (k) =>
      k.startsWith('admin_balance_') ||
      k.startsWith('admin_new_balance') ||
      k.startsWith('admin_invalid_balance') ||
      k.startsWith('admin_promo_') ||
      k.startsWith('admin_invalid_promo_') ||
      k.startsWith('admin_stat_') ||
      k.startsWith('admin_order_') ||
      k.startsWith('admin_sales_') ||
      k.startsWith('admin_revenue_') ||
      k.startsWith('admin_daily_'),
  },
  {
    id: 'admin_other_ops',
    labelKey: 'admin_text_cat_admin_other_ops',
    descriptionKey: 'admin_text_cat_desc_admin_other_ops',
    matches: (k) => k.startsWith('admin_'),
  },
  {
    id: 'all_keys',
    labelKey: 'admin_text_cat_all_keys',
    descriptionKey: 'admin_text_cat_desc_all_keys',
    matches: () => true,
  },
];

export function buildCategoryKeyboard(ctx: ConversationContext): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  let count = 0;
  for (const cat of TEXT_CATEGORIES) {
    keyboard.text(t(ctx, cat.labelKey), `text-cat:${cat.id}`);
    count++;
    if (count % 2 === 0) keyboard.row();
  }
  if (count % 2 !== 0) keyboard.row();
  keyboard.text(t(ctx, 'admin_text_back_to_menu'), 'text-nav:mode_select');
  return keyboard;
}

// ── Placeholders Mock Dictionary for Live Previews ─────────────────────────────

const SAMPLE_PLACEHOLDER_VALUES: Record<string, string> = {
  username: 'rebecca_user',
  name: 'کاربر نمونه',
  balance: '۱۵۰,۰۰۰',
  amount: '۵۰,۰۰۰',
  price: '۱۲۰,۰۰۰',
  days: '۳۰',
  days_unit: 'روز',
  gb: '۵۰',
  traffic: '۵۰ GB',
  sub_url: 'https://example.com/sub/token123',
  code: 'OFF30',
  discount: '۳۰٪',
  order_id: 'ORD-1024',
  receipt_id: 'RCP-8841',
  prefix: 'reb',
  telegram_id: '123456789',
  counter: '1',
  key: 'fa.welcome',
  active: 'فعال',
  count: '12',
  category: 'فروشگاه',
  description: 'بخش خرید سرویس',
  search: 'تست',
  audience: 'کاربران فعال',
  recipient_count: '150',
  current: 'مقدار فعلی',
  lang: 'فارسی',
  placeholders: '{username}, {balance}',
};

const PLACEHOLDER_DESCRIPTIONS: Record<string, { fa: string; en: string }> = {
  username: { fa: 'نام کاربری سرویس', en: 'Service username' },
  name: { fa: 'نام کاربر یا بسته', en: 'User or package name' },
  balance: { fa: 'موجودی کیف پول (تومان)', en: 'Wallet balance (Tomans)' },
  amount: { fa: 'مبلغ تراکنش یا شارژ', en: 'Transaction/top-up amount' },
  price: { fa: 'قیمت بسته', en: 'Package price' },
  days: { fa: 'تعداد روزهای اعتبار', en: 'Duration/remaining days' },
  days_unit: { fa: 'واحد زمان (روز/ساعت)', en: 'Time unit (days/hours)' },
  gb: { fa: 'میزان حجم (گیگابایت)', en: 'Traffic quota (GB)' },
  sub_url: { fa: 'لینک اتصال اشتراک', en: 'Subscription connection URL' },
  code: { fa: 'کد تخفیف یا شناسه', en: 'Promo code or token' },
  discount: { fa: 'درصد یا مبلغ تخفیف', en: 'Discount rate/amount' },
  order_id: { fa: 'شناسه سفارش', en: 'Order ID' },
  receipt_id: { fa: 'شناسه رسید', en: 'Receipt ID' },
  telegram_id: { fa: 'شناسه عددی تلگرام', en: 'Telegram user ID' },
  counter: { fa: 'شمارنده عددی کانفیگ', en: 'Config counter number' },
  prefix: { fa: 'پیشوند نام‌گذاری', en: 'Naming prefix' },
};

// ── State-Driven Main Conversation ───────────────────────────────────────────

const KEYS_PER_PAGE = 8;
const MAX_TRANSLATION_PREVIEW_CHARACTERS = 800;

export type ReturnNavState =
  | { screen: 'essential_list'; page: number }
  | { screen: 'key_list'; categoryId: string; page: number; search: string }
  | { screen: 'customized_list'; page: number }
  | { screen: 'search_results'; query: string; page: number };

export type KeyListState = {
  screen: 'key_list';
  categoryId: string;
  page: number;
  search: string;
};

export type IncatSearchPromptState = {
  screen: 'incat_search_prompt';
  categoryId: string;
  page: number;
  search: string;
};

export type SearchResultsState = {
  screen: 'search_results';
  query: string;
  page: number;
};

export type KeyDetailState = {
  screen: 'key_detail';
  key: string;
  returnState: ReturnNavState;
};

export type KeyEditPromptState = {
  screen: 'key_edit_prompt';
  key: string;
  returnState: ReturnNavState;
};

export type KeyPreviewState = {
  screen: 'key_preview';
  key: string;
  returnState: ReturnNavState;
};

export type KeyResetConfirmState = {
  screen: 'key_reset_confirm';
  key: string;
  returnState: ReturnNavState;
};

export type EditorState =
  | { screen: 'mode_select' }
  | { screen: 'global_search_prompt' }
  | { screen: 'essential_list'; page: number }
  | { screen: 'categories' }
  | KeyListState
  | IncatSearchPromptState
  | { screen: 'customized_list'; page: number }
  | SearchResultsState
  | KeyDetailState
  | KeyEditPromptState
  | KeyPreviewState
  | KeyResetConfirmState;

export async function adminEditTextsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;
  const ownerId = await conversationOwnerId(conversation);

  let currentLocale: SupportedLocale =
    ctx.services.translationService.resolveLocale(ctx.from?.language_code) ?? 'fa';
  let state: EditorState = { screen: 'mode_select' };
  let activeCtx = ctx;

  for (;;) {
    const translationService = ctx.services.translationService;

    // ── 1. Mode Selection Screen (Main Hub) ──────────────────────────────────
    if (state.screen === 'mode_select') {
      const customizedCount = translationService.getCustomizedKeys(currentLocale).length;
      const langLabel = currentLocale === 'fa' ? '🦁 فارسی' : '🇬🇧 English';
      const switchLangLabel = currentLocale === 'fa' ? '🇬🇧 English' : '🦁 فارسی';

      const keyboard = new InlineKeyboard()
        .text(t(activeCtx, 'admin_text_mode_essential'), 'text-mode:essential')
        .row()
        .text(t(activeCtx, 'admin_text_mode_advanced'), 'text-mode:advanced')
        .row()
        .text(
          t(activeCtx, 'admin_text_mode_customized', {
            count: localizedNumber(customizedCount, activeCtx),
          }),
          'text-mode:customized'
        )
        .row()
        .text(t(activeCtx, 'admin_text_mode_search'), 'text-mode:search')
        .row()
        .text(t(activeCtx, 'admin_text_switch_lang', { lang: switchLangLabel }), 'text-lang:toggle')
        .row()
        .text(t(activeCtx, 'admin_menu_back_to_admin'), 'nav:admin');

      await promptInConversation(
        conversation,
        activeCtx,
        buildPromptScreen(
          '📝',
          t(activeCtx, 'admin_text_mode_title'),
          t(activeCtx, 'admin_text_mode_subtitle'),
          escapeTelegramMarkdown(t(activeCtx, 'admin_text_current_lang', { lang: langLabel }))
        ),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);
      const data = input.callbackQuery?.data;
      if (!data) continue;
      await input.answerCallbackQuery?.();

      if (data === 'text-lang:toggle') {
        currentLocale = currentLocale === 'fa' ? 'en' : 'fa';
        continue;
      }
      if (data === 'text-mode:essential') {
        state = { screen: 'essential_list', page: 0 };
        continue;
      }
      if (data === 'text-mode:advanced') {
        state = { screen: 'categories' };
        continue;
      }
      if (data === 'text-mode:customized') {
        state = { screen: 'customized_list', page: 0 };
        continue;
      }
      if (data === 'text-mode:search') {
        state = { screen: 'global_search_prompt' };
        continue;
      }
      continue;
    }

    // ── 1.1 Global Search Prompt ─────────────────────────────────────────────
    if (state.screen === 'global_search_prompt') {
      await promptInConversation(
        conversation,
        activeCtx,
        buildPromptScreen(
          '🔍',
          t(activeCtx, 'admin_text_search_title'),
          t(activeCtx, 'admin_text_search_prompt'),
          escapeTelegramMarkdown(t(activeCtx, 'admin_text_search_subtitle'))
        ),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(
            t(activeCtx, 'admin_text_back_to_menu'),
            'text-nav:mode_select'
          ),
        }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);
      if (input.callbackQuery?.data === 'text-nav:mode_select') {
        await input.answerCallbackQuery?.();
        state = { screen: 'mode_select' };
        continue;
      }
      if (input.message && 'text' in input.message && typeof input.message.text === 'string') {
        await deleteConsumedInputMessage(input);
        const query = input.message.text.trim();
        if (query) {
          state = { screen: 'search_results', query, page: 0 };
        }
      }
      continue;
    }

    // ── 2. Simple Mode: Essential User Texts List ────────────────────────────
    if (state.screen === 'essential_list') {
      const items = ESSENTIAL_USER_TEXTS;
      const pageCount = Math.ceil(items.length / KEYS_PER_PAGE);
      const safePage = Math.min(state.page, Math.max(0, pageCount - 1));
      const pageItems = items.slice(safePage * KEYS_PER_PAGE, (safePage + 1) * KEYS_PER_PAGE);

      const keyboard = new InlineKeyboard();
      for (const item of pageItems) {
        keyboard.text(t(activeCtx, item.labelKey), `text-pk:${item.key}`).row();
      }
      if (safePage > 0) {
        keyboard.text(t(activeCtx, 'admin_text_prev_page'), 'text-p:prev');
      }
      if (safePage < pageCount - 1) {
        keyboard.text(t(activeCtx, 'admin_text_next_page'), 'text-p:next');
      }
      if (safePage > 0 || safePage < pageCount - 1) keyboard.row();
      keyboard.text(t(activeCtx, 'admin_text_back_to_menu'), 'text-nav:mode_select');

      await promptInConversation(
        conversation,
        activeCtx,
        buildScreen({
          emoji: '🌟',
          title: t(activeCtx, 'admin_text_essential_title'),
          subtitle: escapeTelegramMarkdown(t(activeCtx, 'admin_text_essential_subtitle')),
          primary: {
            emoji: '📚',
            label: t(activeCtx, 'admin_text_key_label'),
            value: localizedNumber(items.length, activeCtx),
          },
        }),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);
      const data = input.callbackQuery?.data;
      if (!data) continue;
      await input.answerCallbackQuery?.();

      if (data === 'text-nav:mode_select') {
        state = { screen: 'mode_select' };
        continue;
      }
      if (data === 'text-p:prev') {
        state = { screen: 'essential_list', page: Math.max(0, safePage - 1) };
        continue;
      }
      if (data === 'text-p:next') {
        state = { screen: 'essential_list', page: Math.min(pageCount - 1, safePage + 1) };
        continue;
      }
      if (data.startsWith('text-pk:')) {
        const key = data.slice('text-pk:'.length);
        state = {
          screen: 'key_detail',
          key,
          returnState: { screen: 'essential_list', page: safePage },
        };
        continue;
      }
      continue;
    }

    // ── 3. Advanced Mode: Categories Selection ───────────────────────────────
    if (state.screen === 'categories') {
      const keyboard = buildCategoryKeyboard(activeCtx);
      await promptInConversation(
        conversation,
        activeCtx,
        buildPromptScreen(
          '📂',
          t(activeCtx, 'admin_text_editor_title'),
          t(activeCtx, 'admin_text_category_prompt'),
          escapeTelegramMarkdown(t(activeCtx, 'admin_text_editor_subtitle'))
        ),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);
      const data = input.callbackQuery?.data;
      if (!data) continue;
      await input.answerCallbackQuery?.();

      if (data === 'text-nav:mode_select') {
        state = { screen: 'mode_select' };
        continue;
      }
      if (data.startsWith('text-cat:')) {
        const categoryId = data.slice('text-cat:'.length);
        state = { screen: 'key_list', categoryId, page: 0, search: '' };
        continue;
      }
      continue;
    }

    // ── 4. Advanced Mode: Key List in Category ───────────────────────────────
    if (state.screen === 'key_list') {
      const current: KeyListState = state;
      const category = TEXT_CATEGORIES.find((c) => c.id === current.categoryId);
      if (!category) {
        state = { screen: 'categories' };
        continue;
      }

      const allKeys = translationService
        .getTranslationKeys()
        .filter((k) => category.matches(k))
        .filter((k) =>
          current.search ? k.toLowerCase().includes(current.search.toLowerCase()) : true
        )
        .sort();

      const pageCount = Math.ceil(allKeys.length / KEYS_PER_PAGE);
      const safePage = Math.min(current.page, Math.max(0, pageCount - 1));
      const pageKeys = allKeys.slice(safePage * KEYS_PER_PAGE, (safePage + 1) * KEYS_PER_PAGE);

      const keyboard = new InlineKeyboard();
      for (const k of pageKeys) {
        keyboard.text(k, `text-pk:${k}`).row();
      }

      if (current.search) {
        keyboard.text(t(activeCtx, 'admin_text_search_clear'), 'text-incat-clear').row();
      }
      keyboard.text(t(activeCtx, 'admin_text_search_button'), 'text-incat-search').row();

      if (safePage > 0) {
        keyboard.text(t(activeCtx, 'admin_text_prev_page'), 'text-p:prev');
      }
      if (safePage < pageCount - 1) {
        keyboard.text(t(activeCtx, 'admin_text_next_page'), 'text-p:next');
      }
      if (safePage > 0 || safePage < pageCount - 1) keyboard.row();

      keyboard.text(t(activeCtx, 'admin_text_back_categories'), 'text-nav:categories');

      const promptKey = current.search ? 'admin_text_key_prompt_search' : 'admin_text_key_prompt';
      const footerMsg = t(activeCtx, promptKey, {
        category: t(activeCtx, category.labelKey),
        description: t(activeCtx, category.descriptionKey),
        count: allKeys.length,
        ...(current.search ? { search: escapeTelegramMarkdown(current.search) } : {}),
      });

      await promptInConversation(
        conversation,
        activeCtx,
        buildScreen({
          emoji: '📝',
          title: t(activeCtx, 'admin_text_editor_title'),
          subtitle: escapeTelegramMarkdown(t(activeCtx, category.labelKey)),
          primary: {
            emoji: '🔑',
            label: t(activeCtx, 'admin_text_key_label'),
            value: localizedNumber(allKeys.length, activeCtx),
          },
          footer: footerMsg,
        }),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);
      const data = input.callbackQuery?.data;
      if (!data) continue;
      await input.answerCallbackQuery?.();

      if (data === 'text-nav:categories') {
        state = { screen: 'categories' };
        continue;
      }
      if (data === 'text-p:prev') {
        state = {
          screen: 'key_list',
          categoryId: current.categoryId,
          page: Math.max(0, safePage - 1),
          search: current.search,
        };
        continue;
      }
      if (data === 'text-p:next') {
        state = {
          screen: 'key_list',
          categoryId: current.categoryId,
          page: Math.min(pageCount - 1, safePage + 1),
          search: current.search,
        };
        continue;
      }
      if (data === 'text-incat-clear') {
        state = {
          screen: 'key_list',
          categoryId: current.categoryId,
          page: 0,
          search: '',
        };
        continue;
      }
      if (data === 'text-incat-search') {
        state = {
          screen: 'incat_search_prompt',
          categoryId: current.categoryId,
          page: safePage,
          search: current.search,
        };
        continue;
      }
      if (data.startsWith('text-pk:')) {
        const key = data.slice('text-pk:'.length);
        state = {
          screen: 'key_detail',
          key,
          returnState: {
            screen: 'key_list',
            categoryId: current.categoryId,
            page: safePage,
            search: current.search,
          },
        };
        continue;
      }
      continue;
    }

    // ── 4.1 In-Category Search Prompt ─────────────────────────────────────────
    if (state.screen === 'incat_search_prompt') {
      const current: IncatSearchPromptState = state;
      const category = TEXT_CATEGORIES.find((c) => c.id === current.categoryId);

      await promptInConversation(
        conversation,
        activeCtx,
        buildPromptScreen(
          '🔎',
          t(activeCtx, 'admin_text_search_title'),
          t(activeCtx, 'admin_text_search_prompt'),
          escapeTelegramMarkdown(category ? t(activeCtx, category.labelKey) : '')
        ),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(
            t(activeCtx, 'admin_text_back_to_list'),
            'text-nav:incat_back'
          ),
        }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);
      if (input.callbackQuery?.data === 'text-nav:incat_back') {
        await input.answerCallbackQuery?.();
        state = {
          screen: 'key_list',
          categoryId: current.categoryId,
          page: current.page,
          search: current.search,
        };
        continue;
      }
      if (input.message && 'text' in input.message && typeof input.message.text === 'string') {
        await deleteConsumedInputMessage(input);
        state = {
          screen: 'key_list',
          categoryId: current.categoryId,
          page: 0,
          search: input.message.text.trim(),
        };
      }
      continue;
    }

    // ── 5. Customized Texts List ─────────────────────────────────────────────
    if (state.screen === 'customized_list') {
      const keys = translationService.getCustomizedKeys(currentLocale);
      if (keys.length === 0) {
        await promptInConversation(
          conversation,
          activeCtx,
          buildScreen({
            emoji: '✏️',
            title: t(activeCtx, 'admin_text_customized_title'),
            subtitle: escapeTelegramMarkdown(t(activeCtx, 'admin_text_customized_subtitle')),
            primary: {
              emoji: '📚',
              label: t(activeCtx, 'admin_text_key_label'),
              value: localizedNumber(0, activeCtx),
            },
            footer: t(activeCtx, 'admin_text_customized_empty'),
          }),
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard().text(
              t(activeCtx, 'admin_text_back_to_menu'),
              'text-nav:mode_select'
            ),
          }
        );

        const input = await conversation.wait();
        activeCtx = input;
        if (!(await acceptConversationOwner(input, ownerId))) continue;
        if (await handleAdminConversationCancel(conversation, input)) return;
        await forwardConversationNavigation(conversation, input);
        if (input.callbackQuery?.data === 'text-nav:mode_select') {
          await input.answerCallbackQuery?.();
          state = { screen: 'mode_select' };
        }
        continue;
      }

      const pageCount = Math.ceil(keys.length / KEYS_PER_PAGE);
      const safePage = Math.min(state.page, Math.max(0, pageCount - 1));
      const pageKeys = keys.slice(safePage * KEYS_PER_PAGE, (safePage + 1) * KEYS_PER_PAGE);

      const keyboard = new InlineKeyboard();
      for (const k of pageKeys) {
        keyboard.text(k, `text-pk:${k}`).row();
      }
      if (safePage > 0) {
        keyboard.text(t(activeCtx, 'admin_text_prev_page'), 'text-p:prev');
      }
      if (safePage < pageCount - 1) {
        keyboard.text(t(activeCtx, 'admin_text_next_page'), 'text-p:next');
      }
      if (safePage > 0 || safePage < pageCount - 1) keyboard.row();
      keyboard.text(t(activeCtx, 'admin_text_back_to_menu'), 'text-nav:mode_select');

      await promptInConversation(
        conversation,
        activeCtx,
        buildScreen({
          emoji: '✏️',
          title: t(activeCtx, 'admin_text_customized_title'),
          subtitle: escapeTelegramMarkdown(t(activeCtx, 'admin_text_customized_subtitle')),
          primary: {
            emoji: '📚',
            label: t(activeCtx, 'admin_text_key_label'),
            value: localizedNumber(keys.length, activeCtx),
          },
        }),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);
      const data = input.callbackQuery?.data;
      if (!data) continue;
      await input.answerCallbackQuery?.();

      if (data === 'text-nav:mode_select') {
        state = { screen: 'mode_select' };
        continue;
      }
      if (data === 'text-p:prev') {
        state = { screen: 'customized_list', page: Math.max(0, safePage - 1) };
        continue;
      }
      if (data === 'text-p:next') {
        state = { screen: 'customized_list', page: Math.min(pageCount - 1, safePage + 1) };
        continue;
      }
      if (data.startsWith('text-pk:')) {
        const key = data.slice('text-pk:'.length);
        state = {
          screen: 'key_detail',
          key,
          returnState: { screen: 'customized_list', page: safePage },
        };
        continue;
      }
      continue;
    }

    // ── 6. Global Search Results ─────────────────────────────────────────────
    if (state.screen === 'search_results') {
      const current: SearchResultsState = state;
      const results = translationService.searchTranslations(current.query, currentLocale);

      if (results.length === 0) {
        await promptInConversation(
          conversation,
          activeCtx,
          buildEmptyState(
            '📭',
            t(activeCtx, 'admin_text_search_results_title'),
            t(activeCtx, 'admin_text_no_keys_found')
          ),
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard()
              .text(t(activeCtx, 'admin_text_mode_search'), 'text-search-again')
              .row()
              .text(t(activeCtx, 'admin_text_back_to_menu'), 'text-nav:mode_select'),
          }
        );

        const input = await conversation.wait();
        activeCtx = input;
        if (!(await acceptConversationOwner(input, ownerId))) continue;
        if (await handleAdminConversationCancel(conversation, input)) return;
        await forwardConversationNavigation(conversation, input);
        const data = input.callbackQuery?.data;
        if (!data) continue;
        await input.answerCallbackQuery?.();

        if (data === 'text-nav:mode_select') {
          state = { screen: 'mode_select' };
        } else if (data === 'text-search-again') {
          state = { screen: 'global_search_prompt' };
        }
        continue;
      }

      const pageCount = Math.ceil(results.length / KEYS_PER_PAGE);
      const safePage = Math.min(current.page, Math.max(0, pageCount - 1));
      const pageKeys = results.slice(safePage * KEYS_PER_PAGE, (safePage + 1) * KEYS_PER_PAGE);

      const keyboard = new InlineKeyboard();
      for (const k of pageKeys) {
        keyboard.text(k, `text-pk:${k}`).row();
      }
      if (safePage > 0) {
        keyboard.text(t(activeCtx, 'admin_text_prev_page'), 'text-p:prev');
      }
      if (safePage < pageCount - 1) {
        keyboard.text(t(activeCtx, 'admin_text_next_page'), 'text-p:next');
      }
      if (safePage > 0 || safePage < pageCount - 1) keyboard.row();
      keyboard.text(t(activeCtx, 'admin_text_back_to_menu'), 'text-nav:mode_select');

      await promptInConversation(
        conversation,
        activeCtx,
        buildScreen({
          emoji: '🔍',
          title: t(activeCtx, 'admin_text_search_results_title'),
          subtitle: escapeTelegramMarkdown(
            t(activeCtx, 'admin_text_search_results_prompt', {
              count: localizedNumber(results.length, activeCtx),
              search: escapeTelegramMarkdown(current.query),
            })
          ),
          primary: {
            emoji: '📚',
            label: t(activeCtx, 'admin_text_key_label'),
            value: localizedNumber(results.length, activeCtx),
          },
        }),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);
      const data = input.callbackQuery?.data;
      if (!data) continue;
      await input.answerCallbackQuery?.();

      if (data === 'text-nav:mode_select') {
        state = { screen: 'mode_select' };
        continue;
      }
      if (data === 'text-p:prev') {
        state = { screen: 'search_results', query: current.query, page: Math.max(0, safePage - 1) };
        continue;
      }
      if (data === 'text-p:next') {
        state = {
          screen: 'search_results',
          query: current.query,
          page: Math.min(pageCount - 1, safePage + 1),
        };
        continue;
      }
      if (data.startsWith('text-pk:')) {
        const selectedKey = data.slice('text-pk:'.length);
        state = {
          screen: 'key_detail',
          key: selectedKey,
          returnState: { screen: 'search_results', query: current.query, page: safePage },
        };
        continue;
      }
      continue;
    }

    // ── 7. Key Detail View & Action Menu ─────────────────────────────────────
    if (state.screen === 'key_detail') {
      const current: KeyDetailState = state;
      const qualifiedKey = `${currentLocale}.${current.key}`;
      const currentValue = translationService.get(qualifiedKey);
      const defaultValue = DEFAULT_SETTINGS[qualifiedKey] ?? currentValue;
      const isCustomized = translationService.getStoredSetting(qualifiedKey) !== undefined;

      const placeholders = templatePlaceholders(defaultValue);
      const placeholderInfoText = formatPlaceholdersInfo(placeholders, currentLocale, activeCtx);

      const keyboard = new InlineKeyboard()
        .text(t(activeCtx, 'admin_text_edit_button'), 'text-act:edit')
        .text(t(activeCtx, 'admin_text_preview_button'), 'text-act:preview');
      if (isCustomized) {
        keyboard.row().text(t(activeCtx, 'admin_text_reset_button'), 'text-act:reset');
      }
      keyboard.row().text(t(activeCtx, 'admin_text_back_to_list'), 'text-nav:back');

      const currentPreview = markdownSafePreview(currentValue);
      const defaultPreview = markdownSafePreview(defaultValue);

      await promptInConversation(
        conversation,
        activeCtx,
        buildScreen({
          emoji: '📝',
          title: t(activeCtx, 'admin_text_editor_title'),
          subtitle: escapeTelegramMarkdown(
            `${current.key} · ${currentLocale === 'fa' ? 'فارسی' : 'English'}`
          ),
          primary: {
            emoji: '🔑',
            label: t(activeCtx, 'admin_text_status_label'),
            value: isCustomized
              ? t(activeCtx, 'admin_text_status_customized')
              : t(activeCtx, 'admin_text_status_default'),
          },
          sections: [
            {
              emoji: '✏️',
              title: t(activeCtx, 'admin_text_current_value_label'),
              fields: [{ label: '—', value: currentPreview.text }],
            },
            {
              emoji: '📚',
              title: t(activeCtx, 'admin_text_default_value_label'),
              fields: [{ label: '—', value: defaultPreview.text }],
            },
            {
              emoji: '💡',
              title: t(activeCtx, 'admin_text_placeholders_label'),
              fields: [{ label: '—', value: placeholderInfoText }],
            },
          ],
          footer:
            currentPreview.truncated || defaultPreview.truncated
              ? t(activeCtx, 'admin_text_preview_truncated')
              : undefined,
        }),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);
      const data = input.callbackQuery?.data;

      // Handle Direct Text Input as an instant edit attempt
      if (input.message && 'text' in input.message && typeof input.message.text === 'string') {
        await deleteConsumedInputMessage(input);
        const newText = input.message.text.trim();
        const validation = validateTranslationOverrideDetailed(newText, defaultValue);
        if (!validation.valid) {
          await replyInAdminConversation(
            conversation,
            activeCtx,
            buildEmptyState(
              '⚠️',
              t(activeCtx, 'admin_text_editor_title'),
              formatValidationError(validation, activeCtx)
            ),
            { parse_mode: 'Markdown' }
          );
          continue;
        }
        const mdVal = validateTelegramMarkdown(newText);
        if (!mdVal.valid) {
          await replyInAdminConversation(
            conversation,
            activeCtx,
            buildEmptyState(
              '⚠️',
              t(activeCtx, 'admin_text_editor_title'),
              `${t(activeCtx, 'admin_text_invalid_markdown')}: ${mdVal.error ?? ''}`
            ),
            { parse_mode: 'Markdown' }
          );
          continue;
        }
        await translationService.updateSetting(qualifiedKey, newText);
        await replyInAdminConversation(
          conversation,
          activeCtx,
          buildScreen({
            emoji: '✅',
            title: t(activeCtx, 'admin_text_saved_title'),
            primary: {
              emoji: '📝',
              label: t(activeCtx, 'admin_text_key_label'),
              value: escapeTelegramMarkdown(qualifiedKey),
            },
            footer: t(activeCtx, 'admin_text_saved', { key: escapeTelegramMarkdown(qualifiedKey) }),
          }),
          { parse_mode: 'Markdown' }
        );
        continue;
      }

      if (!data) continue;
      await input.answerCallbackQuery?.();

      if (data === 'text-nav:back') {
        state = current.returnState;
        continue;
      }
      if (data === 'text-act:preview') {
        state = { screen: 'key_preview', key: current.key, returnState: current.returnState };
        continue;
      }
      if (data === 'text-act:reset') {
        state = { screen: 'key_reset_confirm', key: current.key, returnState: current.returnState };
        continue;
      }
      if (data === 'text-act:edit') {
        state = { screen: 'key_edit_prompt', key: current.key, returnState: current.returnState };
        continue;
      }
      continue;
    }

    // ── 7.1 Key Edit Text Prompt ─────────────────────────────────────────────
    if (state.screen === 'key_edit_prompt') {
      const current: KeyEditPromptState = state;
      const qualifiedKey = `${currentLocale}.${current.key}`;
      const currentValue = translationService.get(qualifiedKey);
      const defaultValue = DEFAULT_SETTINGS[qualifiedKey] ?? currentValue;

      await promptInConversation(
        conversation,
        activeCtx,
        buildPromptScreen(
          '✍️',
          t(activeCtx, 'admin_text_editor_title'),
          t(activeCtx, 'admin_text_edit_prompt'),
          escapeTelegramMarkdown(qualifiedKey)
        ),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(
            t(activeCtx, 'admin_text_back_to_list'),
            'text-nav:edit_cancel'
          ),
        }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);

      if (input.callbackQuery?.data === 'text-nav:edit_cancel') {
        await input.answerCallbackQuery?.();
        state = { screen: 'key_detail', key: current.key, returnState: current.returnState };
        continue;
      }

      if (input.message && 'text' in input.message && typeof input.message.text === 'string') {
        await deleteConsumedInputMessage(input);
        const newText = input.message.text.trim();
        const validation = validateTranslationOverrideDetailed(newText, defaultValue);
        if (!validation.valid) {
          await replyInAdminConversation(
            conversation,
            activeCtx,
            buildEmptyState(
              '⚠️',
              t(activeCtx, 'admin_text_editor_title'),
              formatValidationError(validation, activeCtx)
            ),
            { parse_mode: 'Markdown' }
          );
          continue;
        }
        const mdVal = validateTelegramMarkdown(newText);
        if (!mdVal.valid) {
          await replyInAdminConversation(
            conversation,
            activeCtx,
            buildEmptyState(
              '⚠️',
              t(activeCtx, 'admin_text_editor_title'),
              `${t(activeCtx, 'admin_text_invalid_markdown')}: ${mdVal.error ?? ''}`
            ),
            { parse_mode: 'Markdown' }
          );
          continue;
        }
        await translationService.updateSetting(qualifiedKey, newText);
        await replyInAdminConversation(
          conversation,
          activeCtx,
          buildScreen({
            emoji: '✅',
            title: t(activeCtx, 'admin_text_saved_title'),
            primary: {
              emoji: '📝',
              label: t(activeCtx, 'admin_text_key_label'),
              value: escapeTelegramMarkdown(qualifiedKey),
            },
            footer: t(activeCtx, 'admin_text_saved', { key: escapeTelegramMarkdown(qualifiedKey) }),
          }),
          { parse_mode: 'Markdown' }
        );
        state = { screen: 'key_detail', key: current.key, returnState: current.returnState };
        continue;
      }
      continue;
    }

    // ── 8. Live Preview Screen ───────────────────────────────────────────────
    if (state.screen === 'key_preview') {
      const current: KeyPreviewState = state;
      const qualifiedKey = `${currentLocale}.${current.key}`;
      const renderedSample = translationService.get(
        qualifiedKey,
        currentLocale,
        SAMPLE_PLACEHOLDER_VALUES
      );

      await promptInConversation(
        conversation,
        activeCtx,
        buildScreen({
          emoji: '👁️',
          title: t(activeCtx, 'admin_text_preview_title'),
          subtitle: escapeTelegramMarkdown(t(activeCtx, 'admin_text_preview_subtitle')),
          primary: {
            emoji: '🔑',
            label: t(activeCtx, 'admin_text_key_label'),
            value: escapeTelegramMarkdown(qualifiedKey),
          },
          sections: [
            {
              emoji: '💬',
              title: t(activeCtx, 'admin_text_preview_title'),
              fields: [{ label: '—', value: escapeTelegramMarkdown(renderedSample) }],
            },
          ],
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(
            t(activeCtx, 'admin_text_preview_close'),
            'text-nav:detail'
          ),
        }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);
      if (input.callbackQuery?.data === 'text-nav:detail') {
        await input.answerCallbackQuery?.();
        state = { screen: 'key_detail', key: current.key, returnState: current.returnState };
      }
      continue;
    }

    // ── 9. Reset Confirmation Screen ─────────────────────────────────────────
    if (state.screen === 'key_reset_confirm') {
      const current: KeyResetConfirmState = state;
      const qualifiedKey = `${currentLocale}.${current.key}`;

      await promptInConversation(
        conversation,
        activeCtx,
        buildScreen({
          emoji: '⚠️',
          title: t(activeCtx, 'admin_text_reset_title'),
          subtitle: escapeTelegramMarkdown(t(activeCtx, 'admin_text_reset_subtitle')),
          primary: {
            emoji: '📝',
            label: t(activeCtx, 'admin_text_key_label'),
            value: escapeTelegramMarkdown(qualifiedKey),
          },
          footer: t(activeCtx, 'admin_text_reset_consequence'),
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(t(activeCtx, 'admin_confirm_button'), 'text-act:reset_confirm')
            .row()
            .text(t(activeCtx, 'menu_cancel'), 'text-nav:detail'),
        }
      );

      const input = await conversation.wait();
      activeCtx = input;
      if (!(await acceptConversationOwner(input, ownerId))) continue;
      if (await handleAdminConversationCancel(conversation, input)) return;
      await forwardConversationNavigation(conversation, input);
      const data = input.callbackQuery?.data;
      if (!data) continue;
      await input.answerCallbackQuery?.();

      if (data === 'text-nav:detail') {
        state = { screen: 'key_detail', key: current.key, returnState: current.returnState };
        continue;
      }
      if (data === 'text-act:reset_confirm') {
        try {
          await translationService.deleteSetting(qualifiedKey);
          await replyInAdminConversation(
            conversation,
            activeCtx,
            buildScreen({
              emoji: '✅',
              title: t(activeCtx, 'admin_text_reset_title'),
              primary: {
                emoji: '📝',
                label: t(activeCtx, 'admin_text_key_label'),
                value: escapeTelegramMarkdown(qualifiedKey),
              },
              footer: t(activeCtx, 'admin_text_reset_success', {
                key: escapeTelegramMarkdown(qualifiedKey),
              }),
            }),
            { parse_mode: 'Markdown' }
          );
        } catch (err) {
          logger.error({ err, key: qualifiedKey }, 'Failed to reset text setting override');
          await replyInAdminConversation(
            conversation,
            activeCtx,
            buildEmptyState(
              '⚠️',
              t(activeCtx, 'admin_text_editor_title'),
              t(activeCtx, 'operation_failed')
            ),
            { parse_mode: 'Markdown' }
          );
        }
        state = { screen: 'key_detail', key: current.key, returnState: current.returnState };
        continue;
      }
      continue;
    }
  }
}

// ── Formatting and Preview Helpers ────────────────────────────────────────────

function formatPlaceholdersInfo(
  placeholders: string[],
  locale: SupportedLocale,
  ctx: ConversationContext
): string {
  if (placeholders.length === 0) {
    return t(ctx, 'admin_text_placeholders_none');
  }

  return placeholders
    .map((p) => {
      const desc = PLACEHOLDER_DESCRIPTIONS[p]?.[locale] ?? PLACEHOLDER_DESCRIPTIONS[p]?.fa ?? '—';
      return `• {${escapeTelegramMarkdown(p)}}: ${escapeTelegramMarkdown(desc)}`;
    })
    .join('\n');
}

function formatValidationError(
  validation: ReturnType<typeof validateTranslationOverrideDetailed>,
  ctx: ConversationContext
): string {
  if (validation.errorReason === 'MISSING_PLACEHOLDERS') {
    return t(ctx, 'admin_text_error_missing_placeholders', {
      placeholders: validation.missingPlaceholders
        .map((p) => `{${escapeTelegramMarkdown(p)}}`)
        .join(' , '),
    });
  }
  if (validation.errorReason === 'EXTRA_PLACEHOLDERS') {
    return t(ctx, 'admin_text_error_extra_placeholders', {
      placeholders: validation.extraPlaceholders
        .map((p) => `{${escapeTelegramMarkdown(p)}}`)
        .join(' , '),
    });
  }
  return t(ctx, 'admin_text_value_invalid');
}

function markdownSafePreview(value: string): { text: string; truncated: boolean } {
  const chars = [...value];
  const truncated = chars.length > MAX_TRANSLATION_PREVIEW_CHARACTERS;
  const visible = truncated
    ? `${chars.slice(0, MAX_TRANSLATION_PREVIEW_CHARACTERS).join('')}…`
    : value;
  return { text: escapeTelegramMarkdown(visible), truncated };
}

// ── Admin: create promo code ──────────────────────────────────────────────────
