import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { t, tm } from '../../../locale.js';
import { buildEmptyState, buildPromptScreen, promptInConversation } from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import { renderSettingsScreen, waitForSettingsInput } from './navigation.js';
import {
  buildCustomNamingTemplatePrompt,
  buildNamingDashboardScreen,
  truncateButtonLabel,
} from './presentation.js';
import { customServiceNameEnabled } from '../../../../domain/services/FeatureSettings.js';
import { getSettingDefinition } from './catalog.js';
import { saveSetting } from './conversation.js';
import { isValidNamingTemplate, validateAdminSetting } from './validation.js';

type FlowOutcome = 'continue' | 'back' | 'cancel';

export async function manageNamingSettings(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<FlowOutcome> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return 'cancel';

  let activeCtx = ctx;
  let sampleId = 6698253699;
  let sampleCounter = 1;

  for (;;) {
    const state = await conversation.external((outsideCtx) => {
      const ts = (outsideCtx?.services ?? activeCtx.services)?.translationService;
      if (!ts) return undefined;
      return {
        prefix: ts.getSetting('naming_prefix', 'rebecca'),
        customServiceName: customServiceNameEnabled(ts),
      };
    });
    if (!state) return 'cancel';

    const screenText = buildNamingDashboardScreen(activeCtx, sampleId, sampleCounter);
    const customNameBadge = state.customServiceName
      ? t(activeCtx, 'admin_overview_active')
      : t(activeCtx, 'admin_overview_inactive');

    const keyboard = new InlineKeyboard()
      .text(t(activeCtx, 'admin_naming_btn_change_mode'), 'naming:mode')
      .row()
      .text(
        truncateButtonLabel(`${t(activeCtx, 'admin_naming_btn_edit_prefix')}: ${state.prefix}`, 32),
        'naming:prefix'
      )
      .text(t(activeCtx, 'admin_naming_btn_edit_template'), 'naming:template')
      .row()
      .text(
        truncateButtonLabel(
          `${t(activeCtx, 'admin_setting_custom_service_name_enabled')}: ${customNameBadge}`,
          48
        ),
        'naming:toggle_custom_name'
      )
      .row()
      .text(t(activeCtx, 'admin_naming_btn_refresh_preview'), 'naming:refresh')
      .row()
      .text(t(activeCtx, 'admin_settings_back_groups'), 'naming:back');

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: [
        'naming:mode',
        'set-edit:naming_mode',
        'naming:prefix',
        'set-edit:naming_prefix',
        'naming:template',
        'set-edit:custom_naming_template',
        'naming:toggle_custom_name',
        'set-edit:custom_service_name_enabled',
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
      sampleId = Math.floor(1000000000 + (await conversation.random()) * 8999999999);
      continue;
    }

    if (
      input.data === 'naming:toggle_custom_name' ||
      input.data === 'set-edit:custom_service_name_enabled'
    ) {
      const nextVal = (!state.customServiceName).toString();
      await conversation.external(async (outsideCtx) => {
        const ts = (outsideCtx?.services ?? activeCtx.services)?.translationService;
        if (!ts) return;
        await ts.updateSetting('custom_service_name_enabled', nextVal);
      });
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
  const current = await conversation.external((outsideCtx) =>
    (outsideCtx?.services ?? ctx.services)?.translationService.getSetting('naming_mode', 'custom')
  );

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
      current: current
        ? t(ctx, `admin_setting_naming_mode_val_${current}`)
        : t(ctx, 'admin_setting_naming_mode_val_custom'),
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
  const current = await conversation.external(
    (outsideCtx) =>
      (outsideCtx?.services ?? ctx.services)?.translationService.getSetting(
        'naming_prefix',
        'rebecca'
      ) ?? 'rebecca'
  );
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
  const keyboard = new InlineKeyboard().text(t(ctx, 'admin_naming_back_to_naming'), 'tmpl:back');

  const body = buildCustomNamingTemplatePrompt(ctx);

  await promptInConversation(
    conversation,
    ctx,
    buildPromptScreen('🎨', t(ctx, 'admin_setting_custom_naming_template'), body),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  for (;;) {
    const input = await waitForSettingsInput(conversation, {
      allowText: true,
      backCallbacks: ['tmpl:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return 'cancel';
    if (input.type === 'back') return 'back';

    if (input.type === 'text' && isValidNamingTemplate(input.value)) {
      const selectedTemplate = input.value.trim();
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
