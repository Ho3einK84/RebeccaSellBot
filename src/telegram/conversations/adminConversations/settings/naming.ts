import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { t, tm } from '../../../locale.js';
import {
  buildEmptyState,
  buildPromptScreen,
  isMessageNotModifiedError,
  promptInConversation,
} from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import { waitForSettingsInput } from './navigation.js';
import {
  buildCustomNamingTemplatePrompt,
  buildNamingDashboardScreen,
  truncateButtonLabel,
} from './presentation.js';
import { getSettingDefinition } from './catalog.js';
import { saveSetting } from './conversation.js';
import { isValidNamingTemplate, validateAdminSetting } from './validation.js';

type FlowOutcome = 'continue' | 'back' | 'cancel';

const NAMING_PRESETS = [
  {
    id: 'p1',
    template: '{prefix}_{telegram_id}_{counter}',
    labelKey: 'admin_naming_preset_prefix_id_counter',
  },
  {
    id: 'p2',
    template: '{prefix}_{counter}_{random4}',
    labelKey: 'admin_naming_preset_prefix_counter_rnd4',
  },
  {
    id: 'p3',
    template: '{prefix}_{date}_{counter}',
    labelKey: 'admin_naming_preset_prefix_date_counter',
  },
  { id: 'p4', template: '{telegram_id}_{random6}', labelKey: 'admin_naming_preset_id_rnd6' },
  { id: 'p5', template: '{prefix}_{random8}', labelKey: 'admin_naming_preset_prefix_rnd8' },
] as const;

export async function manageNamingSettings(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<FlowOutcome> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return 'cancel';

  let activeCtx = ctx;
  let sampleId = 6698253699;
  let sampleCounter = 1;

  for (;;) {
    const ts = activeCtx.services?.translationService;
    if (!ts) return 'cancel';

    const prefix = ts.getSetting('naming_prefix', 'rebecca');
    const screenText = buildNamingDashboardScreen(activeCtx, sampleId, sampleCounter);

    const keyboard = new InlineKeyboard()
      .text(t(activeCtx, 'admin_naming_btn_change_mode'), 'naming:mode')
      .row()
      .text(
        truncateButtonLabel(`${t(activeCtx, 'admin_naming_btn_edit_prefix')}: ${prefix}`, 32),
        'naming:prefix'
      )
      .text(t(activeCtx, 'admin_naming_btn_edit_template'), 'naming:template')
      .row()
      .text(t(activeCtx, 'admin_naming_btn_refresh_preview'), 'naming:refresh')
      .row()
      .text(t(activeCtx, 'admin_settings_back_groups'), 'naming:back');

    let renderedInPlace = false;
    const messageId = activeCtx.callbackQuery?.message?.message_id;
    const chatId = activeCtx.chat?.id;
    if (messageId !== undefined && chatId !== undefined && activeCtx.api) {
      try {
        await activeCtx.api.editMessageText(chatId, messageId, screenText, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        renderedInPlace = true;
      } catch (error) {
        if (isMessageNotModifiedError(error)) {
          renderedInPlace = true;
        }
      }
    }

    if (!renderedInPlace) {
      await promptInConversation(conversation, activeCtx, screenText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: [
        'naming:mode',
        'set-edit:naming_mode',
        'naming:prefix',
        'set-edit:naming_prefix',
        'naming:template',
        'set-edit:custom_naming_template',
        'naming:refresh',
      ],
      backCallbacks: ['naming:back', 'set-groups', 'set-return:naming'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return 'cancel';
    if (input.type === 'back') return 'back';
    if (input.type !== 'callback') continue;
    if (input.ctx) activeCtx = input.ctx;

    if (input.data === 'naming:refresh') {
      sampleCounter += 1;
      sampleId = Math.floor(1000000000 + Math.random() * 8999999999);
      continue;
    }

    if (input.data === 'naming:mode' || input.data === 'set-edit:naming_mode') {
      const modeOutcome = await chooseNamingMode(conversation, activeCtx);
      if (modeOutcome === 'cancel') return 'cancel';
      continue;
    }

    if (input.data === 'naming:prefix' || input.data === 'set-edit:naming_prefix') {
      const prefixOutcome = await editNamingPrefix(conversation, activeCtx);
      if (prefixOutcome === 'cancel') return 'cancel';
      continue;
    }

    if (input.data === 'naming:template' || input.data === 'set-edit:custom_naming_template') {
      const templateOutcome = await editNamingTemplate(conversation, activeCtx);
      if (templateOutcome === 'cancel') return 'cancel';
      continue;
    }
  }
}

async function chooseNamingMode(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<FlowOutcome> {
  const current = ctx.services?.translationService.getSetting('naming_mode', 'custom');

  const modes: Array<{ id: string; labelKey: string }> = [
    { id: 'prefix_number', labelKey: 'admin_setting_naming_mode_prefix_number' },
    { id: 'telegramid_number', labelKey: 'admin_setting_naming_mode_telegramid_number' },
    {
      id: 'prefix_telegramid_number',
      labelKey: 'admin_setting_naming_mode_prefix_telegramid_number',
    },
    { id: 'prefix_random', labelKey: 'admin_setting_naming_mode_prefix_random' },
    { id: 'random_alphanumeric', labelKey: 'admin_setting_naming_mode_random_alphanumeric' },
    { id: 'prefix_date_counter', labelKey: 'admin_setting_naming_mode_prefix_date_counter' },
    { id: 'custom', labelKey: 'admin_setting_naming_mode_custom' },
  ];

  const keyboard = new InlineKeyboard();
  for (const item of modes) {
    const isSelected = current === item.id;
    const label = `${isSelected ? '✅ ' : ''}${t(ctx, item.labelKey)}`;
    keyboard.text(label, `nm-set:${item.id}`).row();
  }
  keyboard.text(t(ctx, 'admin_naming_back_to_naming'), 'nm-set:back');

  const promptText = buildPromptScreen(
    '🏷️',
    t(ctx, 'admin_setting_naming_mode'),
    tm(ctx, 'admin_setting_naming_mode_prompt', {
      current: t(
        ctx,
        `admin_setting_naming_mode_val_${current}` in (ctx.services?.translationService || {})
          ? `admin_setting_naming_mode_val_${current}`
          : (current ?? 'custom')
      ),
    }),
    t(ctx, 'admin_naming_dashboard_subtitle')
  );

  await promptInConversation(conversation, ctx, promptText, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  const input = await waitForSettingsInput(conversation, {
    callbackPrefixes: ['nm-set:', 'set-nm:'],
    backCallbacks: ['nm-set:back', 'set-nm:back', 'set-return:naming'],
    retryKeyboard: keyboard,
  });

  if (input.type === 'cancel') return 'cancel';
  if (
    input.type !== 'callback' ||
    input.data === 'nm-set:back' ||
    input.data === 'set-nm:back' ||
    input.data === 'set-return:naming'
  ) {
    return 'back';
  }

  const chosenMode = input.data.startsWith('set-nm:')
    ? input.data.slice('set-nm:'.length)
    : input.data.slice('nm-set:'.length);
  const validated = validateAdminSetting('naming_mode', chosenMode);
  if (!validated) return 'back';

  const definition = getSettingDefinition('naming_mode');
  if (!definition) return 'back';
  return saveSetting(conversation, input.ctx ?? ctx, definition, validated);
}

async function editNamingPrefix(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<FlowOutcome> {
  const current =
    ctx.services?.translationService.getSetting('naming_prefix', 'rebecca') ?? 'rebecca';
  const keyboard = new InlineKeyboard().text(t(ctx, 'admin_naming_back_to_naming'), 'pfx:back');

  const promptText = buildPromptScreen(
    '✏️',
    t(ctx, 'admin_setting_naming_prefix'),
    tm(ctx, 'admin_setting_naming_prefix_prompt', { current }),
    t(ctx, 'admin_naming_dashboard_subtitle')
  );

  await promptInConversation(conversation, ctx, promptText, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  for (;;) {
    const input = await waitForSettingsInput(conversation, {
      allowText: true,
      backCallbacks: ['pfx:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return 'cancel';
    if (input.type !== 'text') return 'back';

    const validated = validateAdminSetting('naming_prefix', input.value);
    if (validated !== undefined) {
      const definition = getSettingDefinition('naming_prefix');
      if (!definition) return 'back';
      return saveSetting(conversation, input.ctx ?? ctx, definition, validated);
    }

    await promptInConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_setting_naming_prefix'),
        t(ctx, 'admin_setting_naming_prefix_invalid')
      ),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }
}

async function editNamingTemplate(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<FlowOutcome> {
  const keyboard = new InlineKeyboard();
  for (const preset of NAMING_PRESETS) {
    keyboard.text(t(ctx, preset.labelKey), `tmpl-preset:${preset.id}`).row();
  }
  keyboard.text(t(ctx, 'admin_naming_back_to_naming'), 'tmpl:back');

  const body = `${buildCustomNamingTemplatePrompt(ctx)}\n\n*${t(ctx, 'admin_naming_presets_title')}*`;

  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen('🎨', t(ctx, 'admin_setting_custom_naming_template'), body),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  for (;;) {
    const input = await waitForSettingsInput(conversation, {
      allowText: true,
      callbackPrefixes: ['tmpl-preset:'],
      backCallbacks: ['tmpl:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return 'cancel';
    if (input.type === 'back') return 'back';

    let selectedTemplate: string | undefined;

    if (input.type === 'callback' && input.data.startsWith('tmpl-preset:')) {
      const presetId = input.data.slice('tmpl-preset:'.length);
      const preset = NAMING_PRESETS.find((p) => p.id === presetId);
      if (preset) {
        selectedTemplate = preset.template;
      }
    } else if (input.type === 'text') {
      if (isValidNamingTemplate(input.value)) {
        selectedTemplate = input.value.trim();
      }
    }

    if (selectedTemplate !== undefined) {
      const def = getSettingDefinition('custom_naming_template');
      if (def) {
        await saveSetting(conversation, input.ctx ?? ctx, def, selectedTemplate);
      }
      const modeDef = getSettingDefinition('naming_mode');
      if (modeDef) {
        await saveSetting(conversation, input.ctx ?? ctx, modeDef, 'custom');
      }
      return 'continue';
    }

    await promptInConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, 'admin_setting_custom_naming_template'),
        t(ctx, 'admin_setting_naming_template_invalid')
      ),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }
}

export async function adminNamingSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  await manageNamingSettings(conversation, ctx);
}
