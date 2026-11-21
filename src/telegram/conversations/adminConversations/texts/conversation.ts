/**
 * Streamlined state-driven controller for the Admin Bot Texts editor.
 */
import type { ConversationContext, MyConversation } from '../../../types.js';
import {
  DEFAULT_SETTINGS,
  templatePlaceholders,
  type SupportedLocale,
} from '../../../../domain/services/TranslationService.js';
import { localizedNumber, resolveContextLocale, t } from '../../../locale.js';
import { escapeTelegramMarkdown } from '../../../rendering.js';
import {
  acceptConversationOwner,
  conversationOwnerId,
  deleteConsumedInputMessage,
  forwardConversationNavigation,
  handleAdminConversationCancel,
  promptInConversation,
} from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import {
  alternateLocale,
  ESSENTIAL_USER_TEXTS,
  getTextCategory,
  type TextCategoryId,
} from './catalog.js';
import {
  buildCategoriesScreen,
  buildCategoryKeyboard,
  buildHubKeyboard,
  buildHubScreen,
  buildKeyDetailKeyboard,
  buildKeyDetailScreen,
  buildKeyEditPromptKeyboard,
  buildKeyEditPromptScreen,
  buildKeyListKeyboard,
  buildKeyListScreen,
  buildResetConfirmKeyboard,
  buildResetConfirmScreen,
  buildSearchPromptKeyboard,
  buildSearchPromptScreen,
  decodeTextKeyCallback,
  KEYS_PER_PAGE,
  type KeyListEntry,
  type KeyListScreenSpec,
  type ScreenNotice,
} from './presentation.js';
import {
  renderLivePreview,
  resetTextOverride,
  saveTextOverride,
  searchKeysUnified,
} from './actions.js';

export type ListState =
  | { screen: 'list'; kind: 'essential'; page: number }
  | { screen: 'list'; kind: 'category'; categoryId: TextCategoryId; page: number; query: string }
  | { screen: 'list'; kind: 'customized'; page: number }
  | { screen: 'list'; kind: 'search'; query: string; page: number };

export type SearchPromptState = {
  screen: 'search_prompt';
  categoryId?: TextCategoryId;
  returnState: { screen: 'hub' } | ListState;
};

export type KeyDetailState = {
  screen: 'key_detail';
  key: string;
  returnState: ListState;
  notice?: ScreenNotice;
};

export type KeyEditState = {
  screen: 'key_edit';
  key: string;
  returnState: ListState;
  notice?: ScreenNotice;
};

export type KeyPreviewState = {
  screen: 'key_preview';
  key: string;
  returnState: ListState;
};

export type KeyResetConfirmState = {
  screen: 'key_reset_confirm';
  key: string;
  returnState: ListState;
};

export type EditorState =
  | { screen: 'hub' }
  | { screen: 'categories' }
  | ListState
  | SearchPromptState
  | KeyDetailState
  | KeyEditState
  | KeyPreviewState
  | KeyResetConfirmState;

type TextsInputEvent =
  | { kind: 'cancelled' }
  | { kind: 'callback'; data: string; ctx: ConversationContext }
  | { kind: 'text'; text: string; ctx: ConversationContext };

function withListPage(list: ListState, page: number): ListState {
  switch (list.kind) {
    case 'essential':
      return { screen: 'list', kind: 'essential', page };
    case 'category':
      return {
        screen: 'list',
        kind: 'category',
        categoryId: list.categoryId,
        page,
        query: list.query,
      };
    case 'customized':
      return { screen: 'list', kind: 'customized', page };
    case 'search':
      return { screen: 'list', kind: 'search', query: list.query, page };
  }
}

async function waitForTextsInput(
  conversation: MyConversation,
  ownerId: number | undefined,
  options: { allowText?: boolean; validCallback?: (data: string) => boolean } = {}
): Promise<TextsInputEvent> {
  for (;;) {
    const input = await conversation.wait();
    if (!(await acceptConversationOwner(input, ownerId))) continue;
    if (await handleAdminConversationCancel(conversation, input)) return { kind: 'cancelled' };
    await forwardConversationNavigation(conversation, input);

    const data = input.callbackQuery?.data;
    if (data !== undefined) {
      if (!options.validCallback || options.validCallback(data)) {
        await input.answerCallbackQuery?.();
        return { kind: 'callback', data, ctx: input };
      }
      await input.answerCallbackQuery?.({
        text: t(input, 'button_action_failed'),
        show_alert: false,
      });
      continue;
    }

    if (
      options.allowText &&
      input.message &&
      'text' in input.message &&
      typeof input.message.text === 'string'
    ) {
      await deleteConsumedInputMessage(input);
      return { kind: 'text', text: input.message.text, ctx: input };
    }

    if (input.message) {
      await deleteConsumedInputMessage(input);
    }
  }
}

function readRawTemplate(
  ts: NonNullable<ConversationContext['services']>['translationService'],
  qualifiedKey: string,
  editLocale: SupportedLocale
): string {
  if (typeof ts.getRawTemplate === 'function') {
    return ts.getRawTemplate(qualifiedKey, editLocale);
  }
  return ts.get(qualifiedKey, editLocale);
}

async function hydrateKeyEntries(
  conversation: MyConversation,
  activeCtx: ConversationContext,
  keys: readonly string[],
  editLocale: SupportedLocale,
  useEssentialLabels = false
): Promise<KeyListEntry[]> {
  const essentialByKey = useEssentialLabels
    ? new Map(ESSENTIAL_USER_TEXTS.map((item) => [item.key, t(activeCtx, item.labelKey)]))
    : undefined;

  return conversation.external((outsideCtx) => {
    const ts = (outsideCtx?.services ?? activeCtx.services)!.translationService;
    return keys.map((key) => {
      const qualified = `${editLocale}.${key}`;
      return {
        key,
        activeText: readRawTemplate(ts, qualified, editLocale),
        isCustomized: ts.getStoredSetting(qualified) !== undefined,
        essentialLabel: essentialByKey?.get(key),
      };
    });
  });
}

export async function adminEditTextsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;
  const ownerId = await conversationOwnerId(conversation);

  let editLocale: SupportedLocale = resolveContextLocale(ctx);
  let state: EditorState = { screen: 'hub' };
  let activeCtx = ctx;

  for (;;) {
    // ── 1. Hub ───────────────────────────────────────────────────────────────
    if (state.screen === 'hub') {
      const customizedCount = await conversation.external(
        (outsideCtx) =>
          (outsideCtx?.services ?? activeCtx.services)!.translationService.getCustomizedKeys(
            editLocale
          ).length
      );

      await promptInConversation(conversation, activeCtx, buildHubScreen(activeCtx, editLocale), {
        parse_mode: 'Markdown',
        reply_markup: buildHubKeyboard(activeCtx, editLocale, customizedCount),
      });

      const event = await waitForTextsInput(conversation, ownerId, {
        validCallback: (data) =>
          data === 'text-lang:toggle' ||
          data === 'text-mode:essential' ||
          data === 'text-mode:categories' ||
          data === 'text-mode:customized' ||
          data === 'text-mode:search',
      });
      if (event.kind === 'cancelled') return;
      if (event.kind !== 'callback') continue;
      activeCtx = event.ctx;

      if (event.data === 'text-lang:toggle') {
        editLocale = alternateLocale(editLocale);
      } else if (event.data === 'text-mode:essential') {
        state = { screen: 'list', kind: 'essential', page: 0 };
      } else if (event.data === 'text-mode:categories') {
        state = { screen: 'categories' };
      } else if (event.data === 'text-mode:customized') {
        state = { screen: 'list', kind: 'customized', page: 0 };
      } else if (event.data === 'text-mode:search') {
        state = { screen: 'search_prompt', returnState: { screen: 'hub' } };
      }
      continue;
    }

    // ── 2. Categories ────────────────────────────────────────────────────────
    if (state.screen === 'categories') {
      await promptInConversation(
        conversation,
        activeCtx,
        buildCategoriesScreen(activeCtx, editLocale),
        {
          parse_mode: 'Markdown',
          reply_markup: buildCategoryKeyboard(activeCtx),
        }
      );

      const event = await waitForTextsInput(conversation, ownerId, {
        validCallback: (data) =>
          data === 'text-nav:mode_select' ||
          (data.startsWith('text-cat:') &&
            Boolean(getTextCategory(data.slice('text-cat:'.length)))),
      });
      if (event.kind === 'cancelled') return;
      if (event.kind !== 'callback') continue;
      activeCtx = event.ctx;

      if (event.data === 'text-nav:mode_select') {
        state = { screen: 'hub' };
      } else if (event.data.startsWith('text-cat:')) {
        const category = getTextCategory(event.data.slice('text-cat:'.length));
        if (category) {
          state = { screen: 'list', kind: 'category', categoryId: category.id, page: 0, query: '' };
        }
      }
      continue;
    }

    // ── 3. Unified List (Essential / Category / Customized / Search) ─────────
    if (state.screen === 'list') {
      const current: ListState = state;
      let matchingKeys: string[];
      let specBase: Omit<KeyListScreenSpec, 'entries' | 'editLocale' | 'page' | 'pageCount'>;
      let useEssentialLabels = false;

      if (current.kind === 'essential') {
        matchingKeys = ESSENTIAL_USER_TEXTS.map((item) => item.key);
        useEssentialLabels = true;
        specBase = {
          emoji: '🌟',
          title: t(activeCtx, 'admin_text_essential_title'),
          footer: t(activeCtx, 'admin_text_essential_subtitle'),
          backCallback: 'text-nav:mode_select',
          backLabelKey: 'admin_text_back_to_menu',
        };
      } else if (current.kind === 'category') {
        const category = getTextCategory(current.categoryId);
        if (!category) {
          state = { screen: 'categories' };
          continue;
        }
        matchingKeys = current.query
          ? await searchKeysUnified(conversation, activeCtx, current.query, editLocale, category)
          : await conversation.external((outsideCtx) =>
              (outsideCtx?.services ?? activeCtx.services)!.translationService
                .getTranslationKeys()
                .filter((k) => category.matches(k))
                .sort()
            );
        specBase = {
          emoji: '📂',
          title: t(activeCtx, category.labelKey),
          subtitle: current.query
            ? t(activeCtx, 'admin_text_search_results_summary', {
                search: escapeTelegramMarkdown(current.query),
                count: localizedNumber(matchingKeys.length, activeCtx),
              })
            : t(activeCtx, 'admin_text_category_count', {
                count: localizedNumber(matchingKeys.length, activeCtx),
              }),
          footer: current.query ? undefined : t(activeCtx, category.descriptionKey),
          backCallback: 'text-nav:categories',
          backLabelKey: 'admin_text_back_categories',
          showSearchButton: true,
          showClearSearchButton: Boolean(current.query),
        };
      } else if (current.kind === 'customized') {
        matchingKeys = await conversation.external((outsideCtx) =>
          (outsideCtx?.services ?? activeCtx.services)!.translationService.getCustomizedKeys(
            editLocale
          )
        );
        specBase = {
          emoji: '✏️',
          title: t(activeCtx, 'admin_text_customized_title'),
          subtitle: t(activeCtx, 'admin_text_category_count', {
            count: localizedNumber(matchingKeys.length, activeCtx),
          }),
          emptyBody: t(activeCtx, 'admin_text_customized_empty'),
          backCallback: 'text-nav:mode_select',
          backLabelKey: 'admin_text_back_to_menu',
        };
      } else {
        matchingKeys = await searchKeysUnified(conversation, activeCtx, current.query, editLocale);
        specBase = {
          emoji: '🔍',
          title: t(activeCtx, 'admin_text_search_results_title'),
          subtitle: t(activeCtx, 'admin_text_search_results_summary', {
            search: escapeTelegramMarkdown(current.query),
            count: localizedNumber(matchingKeys.length, activeCtx),
          }),
          backCallback: 'text-nav:mode_select',
          backLabelKey: 'admin_text_back_to_menu',
          showSearchButton: true,
          emptyActionCallback: 'text-list:search',
          emptyActionLabelKey: 'admin_text_search_again_button',
        };
      }

      const pageCount = Math.ceil(matchingKeys.length / KEYS_PER_PAGE);
      const safePage = Math.min(current.page, Math.max(0, pageCount - 1));
      const pageKeys = matchingKeys.slice(safePage * KEYS_PER_PAGE, (safePage + 1) * KEYS_PER_PAGE);
      const entries = await hydrateKeyEntries(
        conversation,
        activeCtx,
        pageKeys,
        editLocale,
        useEssentialLabels
      );

      const spec: KeyListScreenSpec = {
        ...specBase,
        entries,
        editLocale,
        page: safePage,
        pageCount,
      };

      await promptInConversation(conversation, activeCtx, buildKeyListScreen(activeCtx, spec), {
        parse_mode: 'Markdown',
        reply_markup: buildKeyListKeyboard(activeCtx, spec),
      });

      const event = await waitForTextsInput(conversation, ownerId, {
        validCallback: (data) =>
          data === spec.backCallback ||
          (data === 'text-p:prev' && safePage > 0) ||
          (data === 'text-p:next' && safePage < pageCount - 1) ||
          (data === 'text-list:search' &&
            Boolean(spec.showSearchButton || spec.emptyActionCallback === 'text-list:search')) ||
          (data === 'text-list:clear' && Boolean(spec.showClearSearchButton)) ||
          Boolean(decodeTextKeyCallback(data, pageKeys)),
      });
      if (event.kind === 'cancelled') return;
      if (event.kind !== 'callback') continue;
      activeCtx = event.ctx;

      if (event.data === 'text-nav:mode_select') {
        state = { screen: 'hub' };
        continue;
      }
      if (event.data === 'text-nav:categories') {
        state = { screen: 'categories' };
        continue;
      }
      if (event.data === 'text-p:prev' || event.data === 'text-p:next') {
        const nextPage =
          event.data === 'text-p:prev'
            ? Math.max(0, safePage - 1)
            : Math.min(pageCount - 1, safePage + 1);
        state = withListPage(current, nextPage);
        continue;
      }
      if (event.data === 'text-list:clear' && current.kind === 'category') {
        state = {
          screen: 'list',
          kind: 'category',
          categoryId: current.categoryId,
          page: 0,
          query: '',
        };
        continue;
      }
      if (event.data === 'text-list:search') {
        state = {
          screen: 'search_prompt',
          categoryId: current.kind === 'category' ? current.categoryId : undefined,
          returnState: withListPage(current, safePage),
        };
        continue;
      }
      const selectedKey = decodeTextKeyCallback(event.data, pageKeys);
      if (selectedKey) {
        state = {
          screen: 'key_detail',
          key: selectedKey,
          returnState: withListPage(current, safePage),
        };
      }
      continue;
    }

    // ── 4. Unified Search Prompt (Global & In-Category) ──────────────────────
    if (state.screen === 'search_prompt') {
      const current: SearchPromptState = state;
      const category = current.categoryId ? getTextCategory(current.categoryId) : undefined;
      const backLabelKey =
        current.returnState.screen === 'hub'
          ? 'admin_text_back_to_menu'
          : 'admin_text_back_to_list';

      await promptInConversation(
        conversation,
        activeCtx,
        buildSearchPromptScreen(activeCtx, editLocale, category),
        {
          parse_mode: 'Markdown',
          reply_markup: buildSearchPromptKeyboard(activeCtx, 'text-nav:search_back', backLabelKey),
        }
      );

      const event = await waitForTextsInput(conversation, ownerId, {
        allowText: true,
        validCallback: (data) => data === 'text-nav:search_back',
      });
      if (event.kind === 'cancelled') return;
      activeCtx = event.ctx;

      if (event.kind === 'callback') {
        state = current.returnState;
        continue;
      }
      const query = event.text.trim();
      if (!query) continue;

      if (current.categoryId) {
        state = {
          screen: 'list',
          kind: 'category',
          categoryId: current.categoryId,
          page: 0,
          query,
        };
      } else {
        state = { screen: 'list', kind: 'search', query, page: 0 };
      }
      continue;
    }

    // ── 5. Single-Point Key Detail & Instant Editor ──────────────────────────
    if (state.screen === 'key_detail') {
      const current: KeyDetailState = state;
      const qualifiedKey = `${editLocale}.${current.key}`;
      const { currentValue, isCustomized } = await conversation.external((outsideCtx) => {
        const ts = (outsideCtx?.services ?? activeCtx.services)!.translationService;
        return {
          currentValue: readRawTemplate(ts, qualifiedKey, editLocale),
          isCustomized: ts.getStoredSetting(qualifiedKey) !== undefined,
        };
      });
      const defaultValue = DEFAULT_SETTINGS[qualifiedKey] ?? currentValue;
      const placeholders = templatePlaceholders(defaultValue);
      const uiLocale = resolveContextLocale(activeCtx);

      await promptInConversation(
        conversation,
        activeCtx,
        buildKeyDetailScreen(activeCtx, {
          key: current.key,
          editLocale,
          uiLocale,
          currentValue,
          defaultValue,
          isCustomized,
          placeholders,
          notice: current.notice,
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: buildKeyDetailKeyboard(activeCtx, editLocale, isCustomized),
        }
      );

      const event = await waitForTextsInput(conversation, ownerId, {
        allowText: true,
        validCallback: (data) =>
          data === 'text-nav:back' ||
          data === 'text-act:edit' ||
          data === 'text-act:preview' ||
          data === 'text-act:lang' ||
          (data === 'text-act:reset' && isCustomized),
      });
      if (event.kind === 'cancelled') return;
      activeCtx = event.ctx;

      if (event.kind === 'text') {
        const result = await saveTextOverride(
          conversation,
          activeCtx,
          qualifiedKey,
          event.text,
          defaultValue
        );
        state = { ...current, notice: result.notice };
        continue;
      }

      if (event.data === 'text-nav:back') {
        state = current.returnState;
      } else if (event.data === 'text-act:lang') {
        editLocale = alternateLocale(editLocale);
        state = { screen: 'key_detail', key: current.key, returnState: current.returnState };
      } else if (event.data === 'text-act:edit') {
        state = { screen: 'key_edit', key: current.key, returnState: current.returnState };
      } else if (event.data === 'text-act:preview') {
        state = { screen: 'key_preview', key: current.key, returnState: current.returnState };
      } else if (event.data === 'text-act:reset' && isCustomized) {
        state = { screen: 'key_reset_confirm', key: current.key, returnState: current.returnState };
      }
      continue;
    }

    // ── 6. Focused Edit Prompt ───────────────────────────────────────────────
    if (state.screen === 'key_edit') {
      const current: KeyEditState = state;
      const qualifiedKey = `${editLocale}.${current.key}`;
      const currentValue = await conversation.external((outsideCtx) =>
        readRawTemplate(
          (outsideCtx?.services ?? activeCtx.services)!.translationService,
          qualifiedKey,
          editLocale
        )
      );
      const defaultValue = DEFAULT_SETTINGS[qualifiedKey] ?? currentValue;
      const placeholders = templatePlaceholders(defaultValue);
      const uiLocale = resolveContextLocale(activeCtx);

      await promptInConversation(
        conversation,
        activeCtx,
        buildKeyEditPromptScreen(activeCtx, {
          key: current.key,
          editLocale,
          uiLocale,
          placeholders,
          notice: current.notice,
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: buildKeyEditPromptKeyboard(activeCtx),
        }
      );

      const event = await waitForTextsInput(conversation, ownerId, {
        allowText: true,
        validCallback: (data) => data === 'text-nav:detail',
      });
      if (event.kind === 'cancelled') return;
      activeCtx = event.ctx;

      if (event.kind === 'callback') {
        state = { screen: 'key_detail', key: current.key, returnState: current.returnState };
        continue;
      }

      const result = await saveTextOverride(
        conversation,
        activeCtx,
        qualifiedKey,
        event.text,
        defaultValue
      );
      if (result.ok) {
        state = {
          screen: 'key_detail',
          key: current.key,
          returnState: current.returnState,
          notice: result.notice,
        };
      } else {
        state = { ...current, notice: result.notice };
      }
      continue;
    }

    // ── 7. Real Live Preview ─────────────────────────────────────────────────
    if (state.screen === 'key_preview') {
      const current: KeyPreviewState = state;
      await renderLivePreview(conversation, activeCtx, current.key, editLocale);

      const event = await waitForTextsInput(conversation, ownerId, {
        validCallback: (data) => data === 'text-nav:detail' || data === 'text-act:lang',
      });
      if (event.kind === 'cancelled') return;
      if (event.kind !== 'callback') continue;
      activeCtx = event.ctx;

      if (event.data === 'text-act:lang') {
        editLocale = alternateLocale(editLocale);
      } else {
        state = { screen: 'key_detail', key: current.key, returnState: current.returnState };
      }
      continue;
    }

    // ── 8. Reset Confirmation ────────────────────────────────────────────────
    if (state.screen === 'key_reset_confirm') {
      const current: KeyResetConfirmState = state;
      const qualifiedKey = `${editLocale}.${current.key}`;

      await promptInConversation(
        conversation,
        activeCtx,
        buildResetConfirmScreen(activeCtx, current.key, editLocale),
        {
          parse_mode: 'Markdown',
          reply_markup: buildResetConfirmKeyboard(activeCtx),
        }
      );

      const event = await waitForTextsInput(conversation, ownerId, {
        validCallback: (data) => data === 'text-nav:detail' || data === 'text-act:reset_confirm',
      });
      if (event.kind === 'cancelled') return;
      if (event.kind !== 'callback') continue;
      activeCtx = event.ctx;

      if (event.data === 'text-act:reset_confirm') {
        const result = await resetTextOverride(conversation, activeCtx, qualifiedKey);
        state = {
          screen: 'key_detail',
          key: current.key,
          returnState: current.returnState,
          notice: result.notice,
        };
      } else {
        state = { screen: 'key_detail', key: current.key, returnState: current.returnState };
      }
      continue;
    }
  }
}
