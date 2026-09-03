import { InlineKeyboard } from 'grammy';
import { logger } from '../../../../infra/logger.js';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { t, tm } from '../../../locale.js';
import { callbackData } from '../../../callbackData.js';
import { buildEmptyState, promptInConversation } from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import {
  SETTING_LABELS,
  getSettingDefinition,
  getSettingGroup,
  isNamingSetting,
  type SettingDefinition,
  type SettingGroup,
  type SettingGroupId,
} from './catalog.js';
import {
  buildBooleanSettingKeyboard,
  buildCustomNamingTemplatePrompt,
  buildEditorNavigationKeyboard,
  buildLocaleSettingKeyboard,
  buildSettingSavedScreen,
  buildSettingsGroupKeyboard,
  buildSettingsGroupPrompt,
  buildSettingsInGroupKeyboard,
  buildSettingsOverviewScreen,
  buildSettingsPrompt,
  displayAdminSettingValue,
  editableSettingValue,
  readSettingBool,
} from './presentation.js';
import { managePackages } from './packageManager.js';
import { manageNamingSettings } from './naming.js';
import { waitForSettingsInput } from './navigation.js';
import { settingValidationMessage, validateAdminSetting } from './validation.js';

type FlowOutcome = 'continue' | 'back' | 'cancel';
type GroupChoice =
  { type: 'group'; group: SettingGroup; ctx?: ConversationContext } | { type: 'cancel' };
type SettingChoice =
  | { type: 'setting'; definition: SettingDefinition; ctx?: ConversationContext }
  | { type: 'back'; ctx?: ConversationContext }
  | { type: 'cancel' };

export async function adminEditSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext,
  entryPoint?: string
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeGroup =
    entryPoint === 'packages' ? getSettingGroup('pricing') : getSettingGroup(entryPoint ?? '');
  let openPackages = entryPoint === 'packages';
  let activeCtx: ConversationContext = ctx;

  for (;;) {
    if (!activeGroup) {
      const choice = await chooseSettingsGroup(conversation, activeCtx);
      if (choice.type === 'cancel') return;
      activeGroup = choice.group;
      if (choice.ctx) activeCtx = choice.ctx;
    }

    if (openPackages) {
      openPackages = false;
      const outcome = await managePackages(conversation, activeCtx);
      if (outcome === 'cancel') return;
    }

    if (activeGroup.id === 'naming') {
      const outcome = await manageNamingSettings(conversation, activeCtx);
      if (outcome === 'cancel') return;
      activeGroup = undefined;
      continue;
    }

    const choice = await chooseSettingInGroup(conversation, activeCtx, activeGroup);
    if (choice.type === 'cancel') return;
    if (choice.type === 'back') {
      activeGroup = undefined;
      if (choice.ctx) activeCtx = choice.ctx;
      continue;
    }
    if (choice.ctx) activeCtx = choice.ctx;

    if (choice.definition.editor.type === 'packages') {
      const outcome = await managePackages(conversation, activeCtx);
      if (outcome === 'cancel') return;
      continue;
    }

    if (choice.definition.editor.type === 'boolean') {
      const current = readSettingBool(activeCtx, choice.definition.key);
      const nextVal = (!current).toString();
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting(choice.definition.key, nextVal);
      });
      continue;
    }

    const outcome = await editSetting(conversation, activeCtx, choice.definition);
    if (outcome === 'cancel') return;
    // Both save and Back return to the category that owns the setting.
  }
}

async function chooseSettingsGroup(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<GroupChoice> {
  const keyboard = buildSettingsGroupKeyboard(ctx);
  const overview = buildSettingsOverviewScreen(ctx);
  await promptInConversation(
    conversation,
    ctx,
    overview || buildSettingsPrompt(ctx, t(ctx, 'admin_settings_groups_prompt'), { emoji: '⚙️' }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  const input = await waitForSettingsInput(conversation, {
    callbackPrefixes: ['set-group:'],
    retryKeyboard: keyboard,
  });
  if (input.type !== 'callback') return { type: 'cancel' };
  const group = getSettingGroup(input.data.slice('set-group:'.length));
  return group ? { type: 'group', group, ctx: input.ctx } : { type: 'cancel' };
}

async function chooseSettingInGroup(
  conversation: MyConversation,
  ctx: ConversationContext,
  group: SettingGroup
): Promise<SettingChoice> {
  const keyboard = buildSettingsInGroupKeyboard(ctx, group);
  await promptInConversation(
    conversation,
    ctx,
    buildSettingsPrompt(ctx, buildSettingsGroupPrompt(ctx, group.id), {
      emoji: '📂',
      title: t(ctx, group.labelKey),
    }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  const input = await waitForSettingsInput(conversation, {
    callbackPrefixes: ['set-edit:'],
    backCallbacks: ['set-groups'],
    retryKeyboard: keyboard,
  });
  if (input.type === 'cancel') return { type: 'cancel' };
  if (input.type !== 'callback') return { type: 'back', ctx: input.ctx };
  const definition = getSettingDefinition(input.data.slice('set-edit:'.length));
  return definition && definition.group === group.id
    ? { type: 'setting', definition, ctx: input.ctx }
    : { type: 'back', ctx: input.ctx };
}

export async function editSetting(
  conversation: MyConversation,
  ctx: ConversationContext,
  definition: SettingDefinition
): Promise<FlowOutcome> {
  switch (definition.editor.type) {
    case 'boolean':
      return editBooleanSetting(conversation, ctx, definition);
    case 'locale':
      return editLocaleSetting(conversation, ctx, definition);
    case 'naming_mode':
      return editNamingMode(conversation, ctx, definition);
    case 'support':
      return editSupportSetting(conversation, ctx, definition);
    default:
      return editTextSetting(conversation, ctx, definition);
  }
}

async function editLocaleSetting(
  conversation: MyConversation,
  ctx: ConversationContext,
  definition: SettingDefinition
): Promise<FlowOutcome> {
  const current = ctx.services?.translationService.getSetting(definition.key, 'fa') ?? 'fa';
  const callbackPrefix = 'set-loc:';
  const keyboard = buildLocaleSettingKeyboard(ctx, current, callbackPrefix);
  await promptInConversation(
    conversation,
    ctx,
    buildSettingsPrompt(ctx, t(ctx, 'admin_setting_locale_prompt'), {
      emoji: '🌐',
      title: t(ctx, definition.labelKey),
    }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  const input = await waitForSettingsInput(conversation, {
    callbackPrefixes: [callbackPrefix],
    backCallbacks: [`${callbackPrefix}back`],
    retryKeyboard: keyboard,
  });
  if (input.type === 'cancel') return 'cancel';
  if (input.type !== 'callback') return 'back';
  const chosen = input.data.slice(callbackPrefix.length);
  const validLocale = chosen === 'en' ? 'en' : 'fa';
  return saveSetting(conversation, input.ctx ?? ctx, definition, validLocale);
}

async function editBooleanSetting(
  conversation: MyConversation,
  ctx: ConversationContext,
  definition: SettingDefinition
): Promise<FlowOutcome> {
  const callbackPrefix = `set-bool-${definition.key}:`;
  const keyboard = buildBooleanSettingKeyboard(ctx, definition.key, callbackPrefix);
  await promptInConversation(
    conversation,
    ctx,
    buildSettingsPrompt(
      ctx,
      tm(
        ctx,
        definition.key === 'trial_enabled'
          ? 'admin_setting_trial_enabled_prompt'
          : 'admin_setting_custom_volume_enabled_prompt',
        { current: displayAdminSettingValue(ctx, definition.key) }
      ),
      { emoji: '⚙️', title: t(ctx, definition.labelKey) }
    ),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  const input = await waitForSettingsInput(conversation, {
    callbackPrefixes: [callbackPrefix],
    backCallbacks: [`${callbackPrefix}back`],
    retryKeyboard: keyboard,
  });
  if (input.type === 'cancel') return 'cancel';
  if (input.type !== 'callback') return 'back';
  const value = validateAdminSetting(definition.key, input.data.slice(callbackPrefix.length));
  if (value === undefined) return 'back';
  return saveSetting(conversation, input.ctx ?? ctx, definition, value);
}

async function editNamingMode(
  conversation: MyConversation,
  ctx: ConversationContext,
  definition: SettingDefinition
): Promise<FlowOutcome> {
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_setting_naming_mode_prefix_number'), 'set-nm:prefix_number')
    .row()
    .text(t(ctx, 'admin_setting_naming_mode_telegramid_number'), 'set-nm:telegramid_number')
    .row()
    .text(
      t(ctx, 'admin_setting_naming_mode_prefix_telegramid_number'),
      'set-nm:prefix_telegramid_number'
    )
    .row()
    .text(t(ctx, 'admin_setting_naming_mode_prefix_random'), 'set-nm:prefix_random')
    .row()
    .text(t(ctx, 'admin_setting_naming_mode_random_alphanumeric'), 'set-nm:random_alphanumeric')
    .row()
    .text(t(ctx, 'admin_setting_naming_mode_prefix_date_counter'), 'set-nm:prefix_date_counter')
    .row()
    .text(t(ctx, 'admin_setting_naming_mode_custom'), 'set-nm:custom')
    .row()
    .text(t(ctx, 'admin_settings_back_category'), 'set-nm:back');
  await promptInConversation(
    conversation,
    ctx,
    buildSettingsPrompt(
      ctx,
      tm(ctx, 'admin_setting_naming_mode_prompt', {
        current: displayAdminSettingValue(ctx, definition.key),
      }),
      { emoji: '🏷️', title: t(ctx, definition.labelKey) }
    ),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  const input = await waitForSettingsInput(conversation, {
    callbackPrefixes: ['set-nm:'],
    backCallbacks: ['set-nm:back'],
    retryKeyboard: keyboard,
  });
  if (input.type === 'cancel') return 'cancel';
  if (input.type !== 'callback') return 'back';
  const value = validateAdminSetting('naming_mode', input.data.slice('set-nm:'.length));
  return value === undefined
    ? 'back'
    : saveSetting(conversation, input.ctx ?? ctx, definition, value);
}

async function editSupportSetting(
  conversation: MyConversation,
  ctx: ConversationContext,
  definition: SettingDefinition
): Promise<FlowOutcome> {
  const keyboard = new InlineKeyboard()
    .text(t(ctx, 'admin_support_change'), 'set-support:edit')
    .text(t(ctx, 'admin_support_remove'), 'set-support:remove')
    .row()
    .text(t(ctx, 'admin_settings_back_category'), 'set-support:back');
  await promptInConversation(
    conversation,
    ctx,
    buildSettingsPrompt(
      ctx,
      tm(ctx, 'admin_setting_support_current', {
        current: displayAdminSettingValue(ctx, definition.key),
      }),
      { emoji: '🛟', title: t(ctx, definition.labelKey) }
    ),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
  const choice = await waitForSettingsInput(conversation, {
    callbackPrefixes: ['set-support:'],
    backCallbacks: ['set-support:back'],
    retryKeyboard: keyboard,
  });
  if (choice.type === 'cancel') return 'cancel';
  if (choice.type !== 'callback') return 'back';
  if (choice.data === 'set-support:remove') {
    return saveSetting(conversation, choice.ctx ?? ctx, definition, '');
  }
  if (choice.data !== 'set-support:edit') return 'back';
  return editTextSetting(conversation, choice.ctx ?? ctx, definition);
}

async function editTextSetting(
  conversation: MyConversation,
  ctx: ConversationContext,
  definition: SettingDefinition
): Promise<FlowOutcome> {
  const keyboard = buildEditorNavigationKeyboard(ctx, definition.group);
  const current = editableSettingValue(ctx, definition.key);
  const body =
    definition.key === 'custom_naming_template'
      ? buildCustomNamingTemplatePrompt(ctx)
      : definition.key === 'naming_prefix'
        ? tm(ctx, 'admin_setting_naming_prefix_prompt', { current })
        : definition.key === 'support_destination'
          ? t(ctx, 'admin_setting_support_destination_prompt')
          : definition.key === 'backup_target_chat_id'
            ? t(ctx, 'admin_backup_target_chat_prompt')
            : tm(ctx, 'admin_setting_value_prompt', {
                setting: t(ctx, definition.labelKey),
                current_value: current,
              });
  await promptInConversation(
    conversation,
    ctx,
    buildSettingsPrompt(ctx, body, { emoji: '✍️', title: t(ctx, definition.labelKey) }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  for (;;) {
    const input = await waitForSettingsInput(conversation, {
      allowText: true,
      backCallbacks: [callbackData('set-edit-back', definition.group)],
      retryKeyboard: keyboard,
    });
    if (input.type === 'cancel') return 'cancel';
    if (input.type !== 'text') return 'back';
    const value = validateAdminSetting(definition.key, input.value);
    if (value !== undefined) return saveSetting(conversation, input.ctx ?? ctx, definition, value);

    await promptInConversation(
      conversation,
      ctx,
      buildEmptyState(
        '⚠️',
        t(ctx, definition.labelKey),
        settingValidationMessage(ctx, definition.key)
      ),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  }
}

export async function saveSetting(
  conversation: MyConversation,
  ctx: ConversationContext,
  definition: SettingDefinition,
  value: string
): Promise<FlowOutcome> {
  const oldValue = ctx.services?.translationService.getSetting(definition.key, '') ?? '';
  let failure: 'save' | 'apply' | 'rollback' | undefined;
  try {
    await conversation.external(async (outsideCtx) => {
      if (!outsideCtx.services) throw new Error('SETTINGS_SERVICES_UNAVAILABLE');
      await outsideCtx.services.translationService.updateSetting(definition.key, value);
      if (!isNamingSetting(definition.key)) return;
      try {
        await outsideCtx.services.configService.syncCounters();
      } catch (error) {
        try {
          await outsideCtx.services.translationService.updateSetting(definition.key, oldValue);
        } catch (rollbackError) {
          throw new Error('SETTING_ROLLBACK_FAILED', { cause: rollbackError });
        }
        throw new Error('SETTING_APPLY_FAILED', { cause: error });
      }
    });
  } catch (error) {
    failure =
      error instanceof Error && error.message === 'SETTING_ROLLBACK_FAILED'
        ? 'rollback'
        : error instanceof Error && error.message === 'SETTING_APPLY_FAILED'
          ? 'apply'
          : 'save';
    logger.error(
      {
        settingKey: definition.key,
        failure,
        errorName: error instanceof Error ? error.name : typeof error,
      },
      'Admin setting update failed'
    );
  }

  const text = failure
    ? buildEmptyState(
        '⚠️',
        t(ctx, definition.labelKey),
        t(
          ctx,
          failure === 'apply'
            ? 'admin_setting_apply_failed'
            : failure === 'rollback'
              ? 'admin_setting_rollback_failed'
              : 'admin_setting_save_failed'
        )
      )
    : buildSettingSavedScreen(
        ctx,
        t(ctx, SETTING_LABELS[definition.key]),
        displayAdminSettingValue(ctx, definition.key)
      );
  return showSettingResult(conversation, ctx, definition.group, text);
}

async function showSettingResult(
  conversation: MyConversation,
  ctx: ConversationContext,
  groupId: SettingGroupId,
  text: string
): Promise<FlowOutcome> {
  const returnCallback = callbackData('set-return', groupId);
  const keyboard = new InlineKeyboard().text(
    t(ctx, 'admin_settings_return_category'),
    returnCallback
  );
  await promptInConversation(conversation, ctx, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
  const input = await waitForSettingsInput(conversation, {
    backCallbacks: [returnCallback],
    retryKeyboard: keyboard,
  });
  return input.type === 'cancel' ? 'cancel' : 'continue';
}
