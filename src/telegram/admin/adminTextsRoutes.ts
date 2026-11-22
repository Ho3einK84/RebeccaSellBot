import { InlineKeyboard } from 'grammy';
import {
  DEFAULT_SETTINGS,
  templatePlaceholders,
  validateTranslationOverrideDetailed,
  type SupportedLocale,
} from '../../domain/services/TranslationService.js';
import { localizedNumber, resolveContextLocale, stripLeadingEmoji, t } from '../locale.js';
import {
  escapeTelegramMarkdown,
  isEntityParseError,
  sanitizeTelegramInlineCode,
} from '../rendering.js';
import {
  buildAdminEmptyState,
  buildAdminPromptScreen,
  buildAdminScreen,
  buildBreadcrumb,
  renderScreen,
  type AdminScreenNotice,
} from '../ui.js';
import type { AdminTextsNavState, MenuContext } from '../types.js';
import {
  alternateLocale,
  ESSENTIAL_USER_TEXTS,
  getEssentialTextItem,
  getTextCategory,
  localeDisplayLabel,
  TEXT_CATEGORIES,
  getSamplePlaceholderValues,
} from '../conversations/adminConversations/texts/catalog.js';
import {
  formatKeyListButtonLabels,
  formatPlaceholderLines,
  KEYS_PER_PAGE,
  type KeyListEntry,
} from '../conversations/adminConversations/texts/presentation.js';
import {
  composeLivePreviewPayload,
  formatValidationError,
  validateTemplateMarkdown,
} from '../conversations/adminConversations/texts/actions.js';
import {
  appendAdminFooterNav,
  appendAdminPagination,
  buildAdminConfirmKeyboard,
  markAdminContext,
} from './adminNav.js';
import { registerAdminRoute } from './adminRouter.js';
import { registerAdminInputHandler, startAdminInput } from './adminInput.js';

function getTextsState(ctx: MenuContext): AdminTextsNavState {
  if (ctx.session?.adminTextsView) {
    return ctx.session.adminTextsView;
  }
  const initial: AdminTextsNavState = {
    locale: resolveContextLocale(ctx),
    mode: 'hub',
    page: 1,
  };
  if (ctx.session) ctx.session.adminTextsView = initial;
  return initial;
}

function setTextsState(ctx: MenuContext, next: AdminTextsNavState): AdminTextsNavState {
  if (ctx.session) ctx.session.adminTextsView = next;
  return next;
}

function resolveListKeys(ctx: MenuContext, state: AdminTextsNavState): string[] {
  const ts = ctx.services?.translationService;
  if (!ts) return [];
  const allKeys = ts.getTranslationKeys();
  if (state.mode === 'essential') {
    return ESSENTIAL_USER_TEXTS.map((i) => i.key).filter((k) =>
      Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, `${state.locale}.${k}`)
    );
  }
  if (state.mode === 'customized') {
    return ts.getCustomizedKeys(state.locale);
  }
  if (state.mode === 'category' && state.categoryId) {
    const cat = getTextCategory(state.categoryId);
    if (!cat) return [];
    const base = allKeys.filter((k) => cat.matches(k));
    if (state.query?.trim()) {
      return ts.searchTranslations(state.query.trim(), state.locale, { filter: cat.matches });
    }
    return base;
  }
  if (state.mode === 'search' && state.query?.trim()) {
    return ts.searchTranslations(state.query.trim(), state.locale, {
      extraText: (key) => {
        const ess = getEssentialTextItem(key);
        if (!ess) return undefined;
        return [
          DEFAULT_SETTINGS[`fa.${ess.labelKey}`] ?? '',
          DEFAULT_SETTINGS[`fa.${ess.descKey}`] ?? '',
          DEFAULT_SETTINGS[`en.${ess.labelKey}`] ?? '',
          DEFAULT_SETTINGS[`en.${ess.descKey}`] ?? '',
        ];
      },
    });
  }
  return allKeys;
}

function listBackRoute(state: AdminTextsNavState): string {
  if (state.mode === 'category' && state.categoryId) {
    return `adm:txt:cat:${state.categoryId}:${state.page}`;
  }
  if (state.mode === 'essential' || state.mode === 'customized' || state.mode === 'search') {
    return `adm:txt:list:${state.mode}:${state.page}`;
  }
  return 'adm:txt:hub';
}

export async function renderTextsHubScreen(
  ctx: MenuContext,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const state = setTextsState(ctx, {
    ...getTextsState(ctx),
    mode: 'hub',
    page: 1,
    query: undefined,
  });
  const ts = ctx.services.translationService;
  const customizedCount = ts.getCustomizedKeys(state.locale).length;
  const targetLang = localeDisplayLabel(alternateLocale(state.locale));

  const text = buildAdminScreen({
    emoji: '📝',
    title: t(ctx, 'admin_text_mode_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_home_title'),
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_text_mode_title')
    ),
    subtitle: t(ctx, 'admin_text_current_lang', { lang: localeDisplayLabel(state.locale) }),
    notice,
    footer: t(ctx, 'admin_text_mode_subtitle'),
  });

  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_text_mode_essential'), 'adm:txt:list:essential:1')
    .row()
    .text(t(ctx, 'admin_text_mode_categories'), 'adm:txt:cats')
    .text(
      t(ctx, 'admin_text_mode_customized', { count: localizedNumber(customizedCount, ctx) }),
      'adm:txt:list:customized:1'
    )
    .row()
    .text(t(ctx, 'admin_text_mode_search'), 'adm:txt:search')
    .row()
    .text(t(ctx, 'admin_text_switch_lang', { lang: targetLang }), 'adm:txt:lang')
    .row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg',
    backLabel: t(ctx, 'admin_cfg_back_settings'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderTextsCategoriesScreen(ctx: MenuContext): Promise<void> {
  markAdminContext(ctx);
  const state = setTextsState(ctx, { ...getTextsState(ctx), mode: 'categories', page: 1 });
  const text = buildAdminScreen({
    emoji: '📂',
    title: t(ctx, 'admin_text_categories_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_text_mode_title'),
      t(ctx, 'admin_text_categories_title')
    ),
    subtitle: t(ctx, 'admin_text_current_lang', { lang: localeDisplayLabel(state.locale) }),
    footer: t(ctx, 'admin_text_categories_subtitle'),
  });

  const kb = new InlineKeyboard();
  TEXT_CATEGORIES.forEach((cat, idx) => {
    kb.text(t(ctx, cat.labelKey), `adm:txt:cat:${cat.id}:1`);
    if (idx % 2 === 1) kb.row();
  });
  if (TEXT_CATEGORIES.length % 2 === 1) kb.row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:txt:hub',
    backLabel: t(ctx, 'admin_text_back_to_menu'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderTextsListScreen(
  ctx: MenuContext,
  nextState: AdminTextsNavState,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const ts = ctx.services.translationService;
  const allKeys = resolveListKeys(ctx, nextState);
  const totalPages = Math.max(1, Math.ceil(allKeys.length / KEYS_PER_PAGE));
  const page = Math.min(Math.max(1, nextState.page), totalPages);
  const state = setTextsState(ctx, { ...nextState, page });

  const start = (page - 1) * KEYS_PER_PAGE;
  const pageKeys = allKeys.slice(start, start + KEYS_PER_PAGE);
  const cat = state.categoryId ? getTextCategory(state.categoryId) : undefined;
  const title =
    state.mode === 'essential'
      ? stripLeadingEmoji(t(ctx, 'admin_text_mode_essential'))
      : state.mode === 'customized'
        ? stripLeadingEmoji(
            t(ctx, 'admin_text_mode_customized', { count: localizedNumber(allKeys.length, ctx) })
          )
        : state.mode === 'search'
          ? t(ctx, 'admin_text_search_title')
          : cat
            ? stripLeadingEmoji(t(ctx, cat.labelKey))
            : t(ctx, 'admin_text_mode_title');

  const customizedSet = new Set(ts.getCustomizedKeys(state.locale));
  const entries: KeyListEntry[] = pageKeys.map((key) => {
    const ess = getEssentialTextItem(key);
    return {
      key,
      activeText: ts.get(`${state.locale}.${key}`, state.locale),
      isCustomized: customizedSet.has(key),
      essentialLabel: ess ? t(ctx, ess.labelKey) : undefined,
    };
  });

  const kb = new InlineKeyboard();
  const labels = formatKeyListButtonLabels(entries, state.locale);
  pageKeys.forEach((_key, idx) => {
    kb.text(labels[idx]!, `adm:txt:v:${start + idx}`).row();
  });

  appendAdminPagination(kb, ctx, {
    page,
    totalPages,
    pageCallback: (p) =>
      state.mode === 'category' && state.categoryId
        ? `adm:txt:cat:${state.categoryId}:${p}`
        : `adm:txt:list:${state.mode}:${p}`,
  });

  if (state.mode === 'search' || state.query) {
    kb.text(t(ctx, 'admin_text_search_button'), 'adm:txt:search')
      .text(t(ctx, 'admin_text_search_clear'), 'adm:txt:clear')
      .row();
  } else if (state.mode === 'category') {
    kb.text(t(ctx, 'admin_text_search_button'), 'adm:txt:search').row();
  }

  appendAdminFooterNav(kb, ctx, {
    backCallback: state.mode === 'category' ? 'adm:txt:cats' : 'adm:txt:hub',
    backLabel:
      state.mode === 'category'
        ? t(ctx, 'admin_text_back_to_categories')
        : t(ctx, 'admin_text_back_to_menu'),
    showHome: true,
  });

  const text = buildAdminScreen({
    emoji: state.mode === 'search' ? '🔍' : '📝',
    title,
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_text_mode_title'),
      title
    ),
    subtitle: `${localeDisplayLabel(state.locale)} · ${localizedNumber(allKeys.length, ctx)}`,
    notice,
    footer: entries.length === 0 ? t(ctx, 'admin_text_no_keys_found') : undefined,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function renderTextDetailScreen(
  ctx: MenuContext,
  index: number,
  notice?: AdminScreenNotice
): Promise<void> {
  if (!ctx.services) return;
  markAdminContext(ctx);
  const state = getTextsState(ctx);
  const allKeys = resolveListKeys(ctx, state);
  const key = allKeys[index];
  if (!key) {
    await renderTextsHubScreen(ctx);
    return;
  }

  const ts = ctx.services.translationService;
  const qualifiedKey = `${state.locale}.${key}`;
  const defaultValue = DEFAULT_SETTINGS[qualifiedKey] ?? '';
  const currentValue = ts.get(qualifiedKey, state.locale);
  const isCustomized = new Set(ts.getCustomizedKeys(state.locale)).has(key);
  const placeholders = templatePlaceholders(defaultValue);
  const uiLocale: SupportedLocale = resolveContextLocale(ctx);
  const ess = getEssentialTextItem(key);
  const title = ess ? stripLeadingEmoji(t(ctx, ess.labelKey)) : t(ctx, 'admin_text_detail_title');

  const sections = [
    {
      emoji: '💬',
      title: t(ctx, 'admin_text_current_value_label'),
      bullet: '',
      fields: [{ value: escapeTelegramMarkdown(currentValue.slice(0, 1_400)) }],
    },
    ...(isCustomized
      ? [
          {
            emoji: '📌',
            title: t(ctx, 'admin_text_default_value_label'),
            bullet: '',
            fields: [{ value: escapeTelegramMarkdown(defaultValue.slice(0, 700)) }],
          },
        ]
      : []),
    ...(placeholders.length > 0
      ? [
          {
            emoji: '🧩',
            title: t(ctx, 'admin_text_placeholders_label'),
            bullet: '',
            fields: [{ value: formatPlaceholderLines(placeholders, uiLocale) }],
          },
        ]
      : []),
  ];

  const text = buildAdminScreen({
    emoji: '📝',
    title,
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_text_mode_title'), key),
    subtitle: `\`${sanitizeTelegramInlineCode(key)}\` · ${localeDisplayLabel(state.locale)} · ${
      isCustomized
        ? `✏️ ${t(ctx, 'admin_text_status_customized')}`
        : t(ctx, 'admin_text_status_default')
    }`,
    notice,
    sections,
    footer: t(ctx, 'admin_text_hint_use_buttons'),
  });

  const otherLang = localeDisplayLabel(alternateLocale(state.locale));
  const kb = new InlineKeyboard()
    .text(t(ctx, 'admin_text_edit_button'), `adm:txt:edit:${index}`)
    .text(t(ctx, 'admin_text_preview_button'), `adm:txt:prev:${index}`)
    .row()
    .text(t(ctx, 'admin_text_detail_switch_lang', { lang: otherLang }), `adm:txt:vlang:${index}`);
  if (isCustomized) {
    kb.text(t(ctx, 'admin_text_reset_button'), `adm:txt:rst:${index}`);
  }
  kb.row();
  appendAdminFooterNav(kb, ctx, {
    backCallback: listBackRoute(state),
    backLabel: t(ctx, 'admin_text_back_to_list'),
    showHome: true,
  });

  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
}

export function registerAdminTextsRoutes(): void {
  registerAdminRoute('adm:txt:hub', async (ctx, _m, notice) => renderTextsHubScreen(ctx, notice));

  registerAdminRoute('adm:txt:lang', async (ctx) => {
    const cur = getTextsState(ctx);
    setTextsState(ctx, { ...cur, locale: alternateLocale(cur.locale) });
    await renderTextsHubScreen(ctx);
  });

  registerAdminRoute('adm:txt:cats', async (ctx) => renderTextsCategoriesScreen(ctx));

  registerAdminRoute(
    /^adm:txt:list:(essential|customized|search):(\d+)$/u,
    async (ctx, match, notice) => {
      const cur = getTextsState(ctx);
      const mode = match![1] as 'essential' | 'customized' | 'search';
      await renderTextsListScreen(
        ctx,
        { ...cur, mode, categoryId: undefined, page: Number(match![2]) || 1 },
        notice
      );
    }
  );

  registerAdminRoute(/^adm:txt:cat:([a-z0-9_]+):(\d+)$/u, async (ctx, match, notice) => {
    const cur = getTextsState(ctx);
    await renderTextsListScreen(
      ctx,
      { ...cur, mode: 'category', categoryId: match![1]!, page: Number(match![2]) || 1 },
      notice
    );
  });

  registerAdminRoute('adm:txt:clear', async (ctx) => {
    const cur = getTextsState(ctx);
    if (cur.mode === 'category' && cur.categoryId) {
      await renderTextsListScreen(ctx, { ...cur, query: undefined, page: 1 });
      return;
    }
    await renderTextsHubScreen(ctx);
  });

  registerAdminRoute('adm:txt:search', async (ctx) => {
    const cur = getTextsState(ctx);
    await startAdminInput(ctx, {
      kind: 'txt:search',
      returnRoute: listBackRoute(cur),
      promptText: buildAdminPromptScreen({
        emoji: '🔍',
        title: t(ctx, 'admin_text_search_title'),
        subtitle: localeDisplayLabel(cur.locale),
        body: t(ctx, 'admin_text_search_prompt'),
      }),
    });
  });

  registerAdminInputHandler('txt:search', async (ctx, rawText) => {
    const query = rawText.trim();
    const cur = getTextsState(ctx);
    if (cur.mode === 'category' && cur.categoryId) {
      await renderTextsListScreen(ctx, { ...cur, query, page: 1 });
    } else {
      await renderTextsListScreen(ctx, {
        ...cur,
        mode: 'search',
        categoryId: undefined,
        query,
        page: 1,
      });
    }
    return { status: 'handled' };
  });

  registerAdminRoute(/^adm:txt:v:(\d+)$/u, async (ctx, match, notice) => {
    await renderTextDetailScreen(ctx, Number(match![1]), notice);
  });

  registerAdminRoute(/^adm:txt:vlang:(\d+)$/u, async (ctx, match) => {
    const idx = Number(match![1]);
    const cur = getTextsState(ctx);
    const oldKeys = resolveListKeys(ctx, cur);
    const key = oldKeys[idx];
    const nextLocale = alternateLocale(cur.locale);
    const nextState = setTextsState(ctx, { ...cur, locale: nextLocale });
    const newKeys = resolveListKeys(ctx, nextState);
    const nextIdx = key ? Math.max(0, newKeys.indexOf(key)) : 0;
    await renderTextDetailScreen(ctx, nextIdx);
  });

  registerAdminRoute(/^adm:txt:prev:(\d+)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const idx = Number(match![1]);
    const state = getTextsState(ctx);
    const key = resolveListKeys(ctx, state)[idx];
    if (!key) {
      await renderTextsHubScreen(ctx);
      return;
    }
    const sampleValues = getSamplePlaceholderValues(state.locale);
    const renderedSample = ctx.services.translationService.get(
      `${state.locale}.${key}`,
      state.locale,
      sampleValues
    );
    const payload = composeLivePreviewPayload(ctx, key, state.locale, renderedSample);
    const kb = new InlineKeyboard()
      .text(t(ctx, 'admin_text_preview_close'), `adm:txt:v:${idx}`)
      .text(t(ctx, 'admin_nav_root_short'), 'adm:home');
    try {
      await renderScreen(ctx, payload.text, {
        parse_mode: payload.parseMode,
        reply_markup: kb,
      });
    } catch (err) {
      if (!isEntityParseError(err)) throw err;
      await renderScreen(ctx, payload.plainFallbackText, { reply_markup: kb });
    }
  });

  registerAdminRoute(/^adm:txt:rst:(\d+)$/u, async (ctx, match) => {
    const idx = Number(match![1]);
    const state = getTextsState(ctx);
    const key = resolveListKeys(ctx, state)[idx];
    if (!key) {
      await renderTextsHubScreen(ctx);
      return;
    }
    await renderScreen(
      ctx,
      buildAdminScreen({
        emoji: '⚠️',
        title: t(ctx, 'admin_text_reset_title'),
        subtitle: `\`${sanitizeTelegramInlineCode(key)}\` · ${localeDisplayLabel(state.locale)}`,
        footer: t(ctx, 'admin_text_reset_consequence'),
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: buildAdminConfirmKeyboard(ctx, {
          confirmCallback: `adm:txt:rst_ok:${idx}`,
          cancelCallback: `adm:txt:v:${idx}`,
        }),
      }
    );
  });

  registerAdminRoute(/^adm:txt:rst_ok:(\d+)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const idx = Number(match![1]);
    const state = getTextsState(ctx);
    const key = resolveListKeys(ctx, state)[idx];
    if (!key) {
      await renderTextsHubScreen(ctx);
      return;
    }
    await ctx.services.translationService.deleteSetting(`${state.locale}.${key}`);
    await renderTextDetailScreen(ctx, idx, {
      tone: 'success',
      text: t(ctx, 'admin_text_reset_success'),
    });
  });

  registerAdminRoute(/^adm:txt:edit:(\d+)$/u, async (ctx, match) => {
    if (!ctx.services) return;
    const idx = Number(match![1]);
    const state = getTextsState(ctx);
    const key = resolveListKeys(ctx, state)[idx];
    if (!key) {
      await renderTextsHubScreen(ctx);
      return;
    }
    const qualifiedKey = `${state.locale}.${key}`;
    const defaultValue = DEFAULT_SETTINGS[qualifiedKey] ?? '';
    const currentValue = ctx.services.translationService.get(qualifiedKey, state.locale);
    const placeholders = templatePlaceholders(defaultValue);
    const uiLocale = resolveContextLocale(ctx);

    const bodyParts = [
      `*${t(ctx, 'admin_text_current_label')}:*\n${escapeTelegramMarkdown(currentValue.slice(0, 1_200))}`,
      ...(placeholders.length > 0
        ? [
            `*${t(ctx, 'admin_text_placeholders_label')}:*\n${formatPlaceholderLines(placeholders, uiLocale)}`,
          ]
        : []),
      t(ctx, 'admin_text_edit_prompt'),
    ];

    await startAdminInput(ctx, {
      kind: 'txt:edit',
      payload: { idx, key, locale: state.locale },
      returnRoute: `adm:txt:v:${idx}`,
      promptText: buildAdminPromptScreen({
        emoji: '✍️',
        title: t(ctx, 'admin_text_edit_title'),
        subtitle: `\`${sanitizeTelegramInlineCode(key)}\` · ${localeDisplayLabel(state.locale)}`,
        body: bodyParts.join('\n\n'),
      }),
    });
  });

  registerAdminInputHandler('txt:edit', async (ctx, rawText, state) => {
    if (!ctx.services) return { status: 'done' };
    const idx = Number(state.payload?.idx ?? 0);
    const key = String(state.payload?.key ?? '');
    const editLocale = (state.payload?.locale === 'en' ? 'en' : 'fa') as SupportedLocale;
    const qualifiedKey = `${editLocale}.${key}`;
    const defaultValue = DEFAULT_SETTINGS[qualifiedKey] ?? '';
    const newText = rawText.trim();

    const validation = validateTranslationOverrideDetailed(newText, defaultValue);
    if (!validation.valid) {
      return {
        status: 'retry',
        promptText: buildAdminPromptScreen({
          emoji: '✍️',
          title: t(ctx, 'admin_text_edit_title'),
          subtitle: `\`${sanitizeTelegramInlineCode(key)}\` · ${localeDisplayLabel(editLocale)}`,
          body: t(ctx, 'admin_text_edit_prompt'),
          error: formatValidationError(validation, ctx),
        }),
      };
    }

    if (validateTemplateMarkdown(defaultValue).valid) {
      const md = validateTemplateMarkdown(newText);
      if (!md.valid) {
        return {
          status: 'retry',
          promptText: buildAdminPromptScreen({
            emoji: '✍️',
            title: t(ctx, 'admin_text_edit_title'),
            subtitle: `\`${sanitizeTelegramInlineCode(key)}\` · ${localeDisplayLabel(editLocale)}`,
            body: t(ctx, 'admin_text_edit_prompt'),
            error: t(ctx, 'admin_text_invalid_markdown', {
              error: escapeTelegramMarkdown(md.error ?? ''),
            }),
          }),
        };
      }
    }

    await ctx.services.translationService.updateSetting(qualifiedKey, newText);
    return {
      status: 'done',
      redirectRoute: `adm:txt:v:${idx}`,
      notice: { tone: 'success', text: t(ctx, 'admin_text_saved') },
    };
  });

  void buildAdminEmptyState;
}
