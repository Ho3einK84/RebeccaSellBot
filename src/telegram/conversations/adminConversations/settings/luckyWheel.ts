import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t } from '../../../locale.js';
import { buildScreen, isMessageNotModifiedError, promptInConversation } from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import { waitForSettingsInput } from './navigation.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';
import { renderSalesMenu } from '../../../keyboards/adminMenu.js';

export async function adminLuckyWheelSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeCtx = ctx;

  for (;;) {
    const ts = ctx.services.translationService;
    const enabled = ts.getSetting('lucky_wheel_enabled', 'true') === 'true';
    const minAmount = ts.getSettingNum('lucky_wheel_min_amount', 1_000);
    const maxAmount = ts.getSettingNum('lucky_wheel_max_amount', 50_000);
    const baseLuck = ts.getSettingNum('lucky_wheel_base_luck_percent', 50);
    const decayPercent = ts.getSettingNum('lucky_wheel_decay_percent', 10);
    const cooldownHours = ts.getSettingNum('lucky_wheel_cooldown_hours', 24);
    const maxSpins = ts.getSettingNum('lucky_wheel_max_spins', 5);

    const screenText = buildScreen({
      emoji: '🎡',
      title: t(ctx, 'admin_sales_lucky_wheel_title'),
      subtitle: t(ctx, 'admin_sales_lucky_wheel_subtitle'),
      sections: [
        {
          emoji: '⚙️',
          title: t(ctx, 'admin_setting_group_lucky_wheel'),
          fields: [
            {
              label: t(ctx, 'admin_setting_lucky_wheel_enabled'),
              value: enabled ? t(ctx, 'ui_status_active') : t(ctx, 'ui_status_inactive'),
            },
            {
              label: t(ctx, 'admin_setting_lucky_wheel_min_amount'),
              value: `${localizedNumber(minAmount, ctx)} ${t(ctx, 'currency_toman')}`,
            },
            {
              label: t(ctx, 'admin_setting_lucky_wheel_max_amount'),
              value: `${localizedNumber(maxAmount, ctx)} ${t(ctx, 'currency_toman')}`,
            },
            {
              label: t(ctx, 'admin_setting_lucky_wheel_base_luck_percent'),
              value: `${localizedNumber(baseLuck, ctx)}%`,
            },
            {
              label: t(ctx, 'admin_setting_lucky_wheel_decay_percent'),
              value: `${localizedNumber(decayPercent, ctx)}%`,
            },
            {
              label: t(ctx, 'admin_setting_lucky_wheel_cooldown_hours'),
              value: `${localizedNumber(cooldownHours, ctx)} ${t(ctx, 'hours_unit')}`,
            },
            {
              label: t(ctx, 'admin_setting_lucky_wheel_max_spins'),
              value: `${localizedNumber(maxSpins, ctx)} ${t(ctx, 'service_unit')}`,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(ctx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(t(ctx, 'admin_setting_lucky_wheel_enabled'), 'wheel_cfg:edit:lucky_wheel_enabled')
      .row()
      .text(t(ctx, 'admin_setting_lucky_wheel_min_amount'), 'wheel_cfg:edit:lucky_wheel_min_amount')
      .text(t(ctx, 'admin_setting_lucky_wheel_max_amount'), 'wheel_cfg:edit:lucky_wheel_max_amount')
      .row()
      .text(
        t(ctx, 'admin_setting_lucky_wheel_base_luck_percent'),
        'wheel_cfg:edit:lucky_wheel_base_luck_percent'
      )
      .text(
        t(ctx, 'admin_setting_lucky_wheel_decay_percent'),
        'wheel_cfg:edit:lucky_wheel_decay_percent'
      )
      .row()
      .text(
        t(ctx, 'admin_setting_lucky_wheel_cooldown_hours'),
        'wheel_cfg:edit:lucky_wheel_cooldown_hours'
      )
      .text(t(ctx, 'admin_setting_lucky_wheel_max_spins'), 'wheel_cfg:edit:lucky_wheel_max_spins')
      .row()
      .text(t(ctx, 'admin_menu_back_to_sales'), 'wheel_cfg:back');

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
      callbackPrefixes: ['wheel_cfg:edit:'],
      backCallbacks: ['wheel_cfg:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel' || input.type === 'back') break;
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data.startsWith('wheel_cfg:edit:')) {
      const key = input.data.slice('wheel_cfg:edit:'.length);
      const definition = getSettingDefinition(key);
      if (definition) {
        await editSetting(conversation, ctx, definition);
      }
    }
  }

  await conversation.external(async (outsideCtx) => {
    await renderSalesMenu(outsideCtx);
  });
}
