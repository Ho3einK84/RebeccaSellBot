import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../types.js';
import { logger } from '../../../infra/logger.js';
import { localizedNumber, t } from '../../locale.js';
import { DEFAULT_SETTINGS } from '../../../domain/services/TranslationService.js';
import {
  buildEmptyState,
  buildPromptScreen,
  buildScreen,
  handleAdminConversationCancel,
  promptInConversation,
  replyInAdminConversation,
  waitForAdminCallbackInput,
  waitForAdminTextInput,
} from '../../ui.js';
import { buildSelectionKeyboard } from './settings.js';
import { requireAdmin } from './shared.js';
import { escapeTelegramMarkdown } from '../../rendering.js';

export async function adminEditTextsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
) {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  // Step 1: choose the language. A cancel affordance is included because the
  // explicit keyboard replaces the default Cancel row shown by the prompt above.
  const languageKeyboard = new InlineKeyboard()
    .text('🦁 فارسی', 'text-lang:fa')
    .text('🇬🇧 English', 'text-lang:en')
    .row()
    .text(t(ctx, 'admin_menu_back'), 'nav:admin')
    .row()
    .text(t(ctx, 'menu_cancel'), 'conversation:cancel');
  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '📝',
      t(ctx, 'admin_text_editor_title'),
      t(ctx, 'admin_text_language_prompt'),
      t(ctx, 'admin_text_editor_subtitle')
    ),
    { parse_mode: 'Markdown', reply_markup: languageKeyboard }
  );
  const languageData = await waitForAdminCallbackInput(conversation, ['text-lang:', 'nav:admin']);
  if (languageData === undefined || languageData === 'nav:admin') return;
  const locale = languageData.slice('text-lang:'.length) as 'fa' | 'en';

  // Step 2: choose a category.
  const categoryKeyboard = buildCategoryKeyboard(ctx);
  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen(
      '📂',
      t(ctx, 'admin_text_editor_title'),
      t(ctx, 'admin_text_category_prompt'),
      t(ctx, 'admin_text_editor_subtitle')
    ),
    { parse_mode: 'Markdown', reply_markup: categoryKeyboard }
  );
  const categoryData = await waitForAdminCallbackInput(conversation, ['text-cat:']);
  if (categoryData === undefined) return;
  const categoryId = categoryData.slice('text-cat:'.length);

  // Step 3: choose a key from the category (with search + pagination).
  const selectedKey = await pickTextKey(conversation, ctx, categoryId);
  if (selectedKey === undefined) return;

  const qualifiedKey = `${locale}.${selectedKey}`;
  const currentValue = ctx.services.translationService.get(qualifiedKey);
  const defaultValue = DEFAULT_SETTINGS[qualifiedKey] ?? currentValue;
  const isCustomized = ctx.services.translationService.getSetting(qualifiedKey) !== '';

  const actionKeyboard = new InlineKeyboard().text(
    t(ctx, 'admin_text_edit_button'),
    'text-act:edit'
  );
  if (isCustomized) {
    actionKeyboard.text(t(ctx, 'admin_text_reset_button'), 'text-act:reset');
  }
  actionKeyboard.row().text(t(ctx, 'menu_cancel'), 'conversation:cancel');

  await promptInConversation(
    conversation,
    ctx,
    buildTextValueScreen(ctx, qualifiedKey, currentValue, defaultValue),
    { parse_mode: 'Markdown', reply_markup: actionKeyboard }
  );

  for (;;) {
    const input = await conversation.wait();
    if (await handleAdminConversationCancel(conversation, input)) return;

    if (input.callbackQuery?.data === 'text-act:reset') {
      await input.answerCallbackQuery();
      await promptInConversation(
        conversation,
        ctx,
        buildScreen({
          emoji: '⚠️',
          title: t(ctx, 'admin_text_reset_title'),
          subtitle: t(ctx, 'admin_text_reset_subtitle'),
          primary: {
            emoji: '📝',
            label: t(ctx, 'admin_text_key_label'),
            value: escapeTelegramMarkdown(qualifiedKey),
          },
          footer: t(ctx, 'admin_text_reset_consequence'),
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(t(ctx, 'admin_confirm_button'), 'text-act:reset-confirm')
            .row()
            .text(t(ctx, 'menu_cancel'), 'text-act:reset-cancel'),
        }
      );
      continue;
    }

    if (input.callbackQuery?.data === 'text-act:reset-cancel') {
      await input.answerCallbackQuery();
      await promptInConversation(
        conversation,
        ctx,
        buildTextValueScreen(ctx, qualifiedKey, currentValue, defaultValue),
        { parse_mode: 'Markdown', reply_markup: actionKeyboard }
      );
      continue;
    }

    if (input.callbackQuery?.data === 'text-act:reset-confirm') {
      await input.answerCallbackQuery();
      try {
        await ctx.services.translationService.deleteSetting(qualifiedKey);
        await replyInAdminConversation(
          conversation,
          ctx,
          buildScreen({
            emoji: '✅',
            title: t(ctx, 'admin_text_reset_title'),
            primary: {
              emoji: '📝',
              label: t(ctx, 'admin_text_key_label'),
              value: escapeTelegramMarkdown(qualifiedKey),
            },
            footer: t(ctx, 'admin_text_reset_success', {
              key: escapeTelegramMarkdown(qualifiedKey),
            }),
          }),
          { parse_mode: 'Markdown' }
        );
        const refreshedValue = ctx.services.translationService.get(qualifiedKey);
        const updatedKeyboard = new InlineKeyboard()
          .text(t(ctx, 'admin_text_edit_button'), 'text-act:edit')
          .row()
          .text(t(ctx, 'menu_cancel'), 'conversation:cancel');

        await promptInConversation(
          conversation,
          ctx,
          buildTextValueScreen(ctx, qualifiedKey, refreshedValue, defaultValue),
          { parse_mode: 'Markdown', reply_markup: updatedKeyboard }
        );
      } catch (resetErr) {
        logger.error(
          { err: resetErr, key: qualifiedKey },
          'Failed to reset text setting to default'
        );
        await replyInAdminConversation(
          conversation,
          ctx,
          buildEmptyState('⚠️', t(ctx, 'admin_text_editor_title'), t(ctx, 'operation_failed')),
          { parse_mode: 'Markdown' }
        );
        return;
      }
      continue;
    }

    if (input.callbackQuery?.data === 'text-act:edit') {
      await input.answerCallbackQuery();
      await promptInConversation(
        conversation,
        ctx,
        buildPromptScreen(
          '✍️',
          t(ctx, 'admin_text_editor_title'),
          t(ctx, 'admin_text_edit_prompt'),
          escapeTelegramMarkdown(qualifiedKey)
        ),
        { parse_mode: 'Markdown' }
      );
      const valueInput = await waitForAdminTextInput(conversation);
      if (valueInput === undefined) return;
      const value = valueInput.trim();
      if (!value || value.length > 3_500) {
        await replyInAdminConversation(
          conversation,
          ctx,
          buildEmptyState(
            '⚠️',
            t(ctx, 'admin_text_editor_title'),
            t(ctx, 'admin_text_value_invalid')
          ),
          { parse_mode: 'Markdown' }
        );
        return;
      }
      await ctx.services.translationService.updateSetting(qualifiedKey, value);
      await replyInAdminConversation(
        conversation,
        ctx,
        buildScreen({
          emoji: '✅',
          title: t(ctx, 'admin_text_saved_title'),
          primary: {
            emoji: '📝',
            label: t(ctx, 'admin_text_key_label'),
            value: escapeTelegramMarkdown(qualifiedKey),
          },
          footer: t(ctx, 'admin_text_saved', { key: escapeTelegramMarkdown(qualifiedKey) }),
        }),
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (input.message && 'text' in input.message && typeof input.message.text === 'string') {
      const value = input.message.text.trim();
      if (!value || value.length > 3_500) {
        await replyInAdminConversation(
          conversation,
          ctx,
          buildEmptyState(
            '⚠️',
            t(ctx, 'admin_text_editor_title'),
            t(ctx, 'admin_text_value_invalid')
          ),
          { parse_mode: 'Markdown' }
        );
        return;
      }
      await ctx.services.translationService.updateSetting(qualifiedKey, value);
      await replyInAdminConversation(
        conversation,
        ctx,
        buildScreen({
          emoji: '✅',
          title: t(ctx, 'admin_text_saved_title'),
          primary: {
            emoji: '📝',
            label: t(ctx, 'admin_text_key_label'),
            value: escapeTelegramMarkdown(qualifiedKey),
          },
          footer: t(ctx, 'admin_text_saved', { key: escapeTelegramMarkdown(qualifiedKey) }),
        }),
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await promptInConversation(
      conversation,
      input,
      buildPromptScreen('✍️', t(input, 'admin_text_editor_title'), t(input, 'text_input_required')),
      { parse_mode: 'Markdown' }
    );
  }
}

const MAX_TRANSLATION_PREVIEW_CHARACTERS = 1_000;

function buildTextValueScreen(
  ctx: ConversationContext,
  qualifiedKey: string,
  currentValue: string,
  defaultValue: string
): string {
  const current = markdownSafeValuePreview(currentValue);
  const fallback = markdownSafeValuePreview(defaultValue);
  return buildScreen({
    emoji: '📝',
    title: t(ctx, 'admin_text_editor_title'),
    subtitle: t(ctx, 'admin_text_editor_subtitle'),
    primary: {
      emoji: '🔑',
      label: t(ctx, 'admin_text_key_label'),
      value: escapeTelegramMarkdown(qualifiedKey),
    },
    sections: [
      {
        emoji: '✏️',
        title: t(ctx, 'admin_text_current_value_label'),
        fields: [{ label: '—', value: current.text }],
      },
      {
        emoji: '📚',
        title: t(ctx, 'admin_text_default_value_label'),
        fields: [{ label: '—', value: fallback.text }],
      },
    ],
    footer:
      current.truncated || fallback.truncated ? t(ctx, 'admin_text_preview_truncated') : undefined,
  });
}

function markdownSafeValuePreview(value: string): { text: string; truncated: boolean } {
  const characters = [...value];
  const truncated = characters.length > MAX_TRANSLATION_PREVIEW_CHARACTERS;
  const visible = truncated
    ? `${characters.slice(0, MAX_TRANSLATION_PREVIEW_CHARACTERS).join('')}…`
    : value;
  return { text: escapeTelegramMarkdown(visible), truncated };
}

const TEXT_KEYS_PER_PAGE = 8;

async function pickTextKey(
  conversation: MyConversation,
  ctx: ConversationContext,
  categoryId: string
): Promise<string | undefined> {
  if (!ctx.services) return undefined;
  const category = TEXT_CATEGORIES.find((c) => c.id === categoryId);
  if (!category) {
    await replyInAdminConversation(
      conversation,
      ctx,
      buildEmptyState('⚠️', t(ctx, 'admin_text_editor_title'), t(ctx, 'admin_text_key_invalid')),
      { parse_mode: 'Markdown' }
    );
    return undefined;
  }

  let search = '';
  let page = 0;

  for (;;) {
    const keys = ctx.services.translationService
      .getTranslationKeys()
      .filter((key) => category.matches(key))
      .filter((key) => (search ? key.includes(search.toLowerCase()) : true))
      .sort();

    if (keys.length === 0) {
      await replyInAdminConversation(
        conversation,
        ctx,
        buildEmptyState(
          '📭',
          t(ctx, 'admin_text_editor_title'),
          t(ctx, 'admin_text_no_keys_found')
        ),
        { parse_mode: 'Markdown' }
      );
      return undefined;
    }

    const pageCount = Math.ceil(keys.length / TEXT_KEYS_PER_PAGE);
    const safePage = Math.min(page, pageCount - 1);
    const pageKeys = keys.slice(safePage * TEXT_KEYS_PER_PAGE, (safePage + 1) * TEXT_KEYS_PER_PAGE);

    const promptKey = search ? 'admin_text_key_prompt_search' : 'admin_text_key_prompt';
    const promptText = t(ctx, promptKey, {
      category: t(ctx, category.labelKey),
      description: t(ctx, category.descriptionKey),
      count: keys.length,
      ...(search ? { search: escapeTelegramMarkdown(search) } : {}),
    });

    const keyboard = new InlineKeyboard();
    for (const key of pageKeys) {
      keyboard.text(key, `text-key:${key}`).row();
    }
    if (search) {
      keyboard.text(t(ctx, 'admin_text_search_clear'), 'text-search-clear').row();
    }
    keyboard.text(t(ctx, 'admin_text_search_button'), 'text-search').row();
    if (safePage > 0) {
      keyboard.text(t(ctx, 'admin_text_prev_page'), 'text-page:prev');
    }
    if (safePage < pageCount - 1) {
      keyboard.text(t(ctx, 'admin_text_next_page'), 'text-page:next');
    }
    keyboard.text(t(ctx, 'admin_text_back_categories'), 'text-back-categories');
    keyboard.text(t(ctx, 'menu_cancel'), 'conversation:cancel');

    await promptInConversation(
      conversation,
      ctx,
      buildScreen({
        emoji: '📝',
        title: t(ctx, 'admin_text_editor_title'),
        subtitle: t(ctx, 'admin_text_editor_subtitle'),
        primary: {
          emoji: '📚',
          label: t(ctx, 'admin_text_key_label'),
          value: localizedNumber(keys.length, ctx),
        },
        sections: [
          {
            emoji: '📂',
            title: t(ctx, category.labelKey),
            fields: [
              { label: t(ctx, category.labelKey), value: t(ctx, category.descriptionKey) },
              ...(search
                ? [
                    {
                      label: t(ctx, 'admin_text_search_button'),
                      value: escapeTelegramMarkdown(search),
                    },
                  ]
                : []),
            ],
          },
        ],
        footer: promptText,
      }),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    const data = await waitForAdminCallbackInput(conversation, [
      'text-key:',
      'text-search',
      'text-search-clear',
      'text-page:',
      'text-back-categories',
    ]);
    if (data === undefined) return undefined;

    if (data.startsWith('text-key:')) {
      const key = data.slice('text-key:'.length);
      if (ctx.services.translationService.hasTranslationKey(key)) return key;
      await replyInAdminConversation(
        conversation,
        ctx,
        buildEmptyState('⚠️', t(ctx, 'admin_text_editor_title'), t(ctx, 'admin_text_key_invalid')),
        { parse_mode: 'Markdown' }
      );
      return undefined;
    }
    if (data === 'text-search') {
      await promptInConversation(
        conversation,
        ctx,
        buildPromptScreen(
          '🔎',
          t(ctx, 'admin_text_editor_title'),
          t(ctx, 'admin_text_search_prompt'),
          t(ctx, category.labelKey)
        ),
        { parse_mode: 'Markdown' }
      );
      const searchInput = await waitForAdminTextInput(conversation);
      if (searchInput === undefined) return undefined;
      search = searchInput.trim();
      page = 0;
      continue;
    }
    if (data === 'text-search-clear') {
      search = '';
      page = 0;
      continue;
    }
    if (data === 'text-page:prev') {
      page = Math.max(0, safePage - 1);
      continue;
    }
    if (data === 'text-page:next') {
      page = Math.min(pageCount - 1, safePage + 1);
      continue;
    }
    if (data === 'text-back-categories') {
      return undefined;
    }
  }
}

type TextCategory = {
  id: string;
  labelKey: string;
  descriptionKey: string;
  matches: (key: string) => boolean;
};

export const TEXT_CATEGORIES: readonly TextCategory[] = [
  {
    id: 'admin_menu',
    labelKey: 'admin_text_category_admin_menu',
    descriptionKey: 'admin_text_cat_desc_admin_menu',
    matches: (key) => key.startsWith('admin_menu_') || key === 'admin_menu_title',
  },
  {
    id: 'admin_settings',
    labelKey: 'admin_text_category_admin_settings',
    descriptionKey: 'admin_text_cat_desc_admin_settings',
    matches: (key) => key.startsWith('admin_setting_') || key === 'admin_bootstrap_env',
  },
  {
    id: 'admin_balance',
    labelKey: 'admin_text_category_admin_balance',
    descriptionKey: 'admin_text_cat_desc_admin_balance',
    matches: (key) =>
      key.startsWith('admin_balance_') ||
      key.startsWith('admin_new_balance') ||
      key.startsWith('admin_invalid_balance'),
  },
  {
    id: 'admin_promo',
    labelKey: 'admin_text_category_admin_promo',
    descriptionKey: 'admin_text_cat_desc_admin_promo',
    matches: (key) => key.startsWith('admin_promo_') || key.startsWith('admin_invalid_promo_'),
  },
  {
    id: 'admin_receipts',
    labelKey: 'admin_text_category_admin_receipts',
    descriptionKey: 'admin_text_cat_desc_admin_receipts',
    matches: (key) =>
      key.startsWith('admin_receipt_') ||
      key.startsWith('admin_pending_receipt') ||
      key.startsWith('admin_no_pending_receipts'),
  },
  {
    id: 'admin_users',
    labelKey: 'admin_text_category_admin_users',
    descriptionKey: 'admin_text_cat_desc_admin_users',
    matches: (key) =>
      key.startsWith('admin_user_') ||
      key.startsWith('admin_search_') ||
      key.startsWith('admin_username_') ||
      key.startsWith('admin_name_') ||
      key.startsWith('admin_referrer_') ||
      key.startsWith('admin_yes') ||
      key.startsWith('admin_no') ||
      key.startsWith('admin_banned') ||
      key.startsWith('admin_active') ||
      key.startsWith('admin_profile_') ||
      key.startsWith('admin_target_') ||
      key.startsWith('admin_invalid_telegram_id'),
  },
  {
    id: 'admin_broadcast',
    labelKey: 'admin_text_category_admin_broadcast',
    descriptionKey: 'admin_text_cat_desc_admin_broadcast',
    matches: (key) => key.startsWith('admin_broadcast_'),
  },
  {
    id: 'admin_direct',
    labelKey: 'admin_text_category_admin_direct',
    descriptionKey: 'admin_text_cat_desc_admin_direct',
    matches: (key) => key.startsWith('admin_direct_'),
  },
  {
    id: 'admin_other',
    labelKey: 'admin_text_category_admin_other',
    descriptionKey: 'admin_text_cat_desc_admin_other',
    matches: (key) =>
      key.startsWith('admin_') &&
      !key.startsWith('admin_menu_') &&
      !key.startsWith('admin_setting_') &&
      !key.startsWith('admin_balance_') &&
      !key.startsWith('admin_new_balance') &&
      !key.startsWith('admin_invalid_balance') &&
      !key.startsWith('admin_promo_') &&
      !key.startsWith('admin_invalid_promo_') &&
      !key.startsWith('admin_receipt_') &&
      !key.startsWith('admin_pending_receipt') &&
      !key.startsWith('admin_no_pending_receipts') &&
      !key.startsWith('admin_user_') &&
      !key.startsWith('admin_search_') &&
      !key.startsWith('admin_username_') &&
      !key.startsWith('admin_name_') &&
      !key.startsWith('admin_referrer_') &&
      !key.startsWith('admin_yes') &&
      !key.startsWith('admin_no') &&
      !key.startsWith('admin_banned') &&
      !key.startsWith('admin_active') &&
      !key.startsWith('admin_profile_') &&
      !key.startsWith('admin_target_') &&
      !key.startsWith('admin_invalid_telegram_id') &&
      !key.startsWith('admin_broadcast_') &&
      !key.startsWith('admin_direct_') &&
      key !== 'admin_menu_title',
  },
  {
    id: 'menus',
    labelKey: 'admin_text_category_menus',
    descriptionKey: 'admin_text_cat_desc_menus',
    matches: (key) =>
      key.startsWith('menu_') ||
      key.startsWith('main_menu') ||
      key.startsWith('language_') ||
      key.startsWith('button_action_') ||
      key.startsWith('operation_') ||
      key.startsWith('text_input_') ||
      key.startsWith('photo_input_'),
  },
  {
    id: 'user_purchase',
    labelKey: 'admin_text_category_user_purchase',
    descriptionKey: 'admin_text_cat_desc_user_purchase',
    matches: (key) =>
      key.startsWith('purchase_') ||
      key.startsWith('config_') ||
      key.startsWith('subscription_') ||
      key.startsWith('renewal_') ||
      key.startsWith('renew_') ||
      key.startsWith('claim_') ||
      key.startsWith('trial_') ||
      key.startsWith('promo_') ||
      key.startsWith('package_') ||
      key.startsWith('custom_') ||
      key.startsWith('no_subscriptions') ||
      key.startsWith('unlimited') ||
      key.startsWith('insufficient_balance') ||
      key.startsWith('user_not_found'),
  },
  {
    id: 'user_wallet',
    labelKey: 'admin_text_category_user_wallet',
    descriptionKey: 'admin_text_cat_desc_user_wallet',
    matches: (key) =>
      key.startsWith('topup_') ||
      key.startsWith('invalid_amount') ||
      key.startsWith('balance') ||
      key.startsWith('shop'),
  },
  {
    id: 'user_general',
    labelKey: 'admin_text_category_user_general',
    descriptionKey: 'admin_text_cat_desc_user_general',
    matches: (key) =>
      key.startsWith('welcome') ||
      key.startsWith('access_denied') ||
      key.startsWith('rate_limited') ||
      key.startsWith('support_message') ||
      key.startsWith('referral_info') ||
      key.startsWith('receipt_'),
  },
];

export function buildCategoryKeyboard(ctx: ConversationContext): InlineKeyboard {
  return buildSelectionKeyboard(ctx, TEXT_CATEGORIES, 'text-cat');
}

// ── Admin: create promo code ──────────────────────────────────────────────────
