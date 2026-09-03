import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t } from '../../../locale.js';
import { buildScreen, isMessageNotModifiedError, promptInConversation } from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import { waitForSettingsInput } from './navigation.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';
import { renderSalesMenu } from '../../../keyboards/adminMenu.js';

export async function adminTrialSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeCtx = ctx;

  for (;;) {
    const ts = ctx.services.translationService;
    const isEnabled = ts.getSettingBool('trial_enabled', true);
    const trialGb = ts.getSettingNum('trial_gb', 1);
    const trialDays = ts.getSettingNum('trial_days', 3);

    const onBadge = t(ctx, 'admin_overview_active');
    const offBadge = t(ctx, 'admin_overview_inactive');

    const screenText = buildScreen({
      emoji: '🎁',
      title: t(ctx, 'admin_sales_trial_title'),
      subtitle: t(ctx, 'admin_sales_trial_subtitle'),
      primary: {
        emoji: isEnabled ? '🟢' : '⚪️',
        label: t(ctx, 'admin_setting_trial_enabled'),
        value: isEnabled ? onBadge : offBadge,
      },
      sections: [
        {
          emoji: '⚙️',
          title: t(ctx, 'admin_sales_trial_specs_section'),
          fields: [
            {
              label: t(ctx, 'admin_setting_trial_gb'),
              value: `${localizedNumber(trialGb, ctx)} ${t(ctx, 'traffic_unit_gb')}`,
            },
            {
              label: t(ctx, 'admin_setting_trial_days'),
              value: `${localizedNumber(trialDays, ctx)} ${t(ctx, 'days_unit')}`,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(ctx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(
        `${t(ctx, 'admin_setting_trial_enabled')}: ${isEnabled ? onBadge : offBadge}`,
        'trial:toggle'
      )
      .row()
      .text(t(ctx, 'admin_setting_trial_gb'), 'trial:edit:trial_gb')
      .row()
      .text(t(ctx, 'admin_setting_trial_days'), 'trial:edit:trial_days')
      .row()
      .text(t(ctx, 'admin_menu_back_to_sales'), 'trial:back');

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
      callbackPrefixes: ['trial:toggle', 'trial:edit:'],
      backCallbacks: ['trial:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel' || input.type === 'back') break;
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === 'trial:toggle') {
      const nextVal = (!isEnabled).toString();
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting('trial_enabled', nextVal);
      });
      continue;
    }

    if (input.data.startsWith('trial:edit:')) {
      const key = input.data.slice('trial:edit:'.length);
      const definition = getSettingDefinition(key);
      if (definition) {
        await editSetting(conversation, activeCtx, definition);
      }
    }
  }

  await conversation.external(async (outsideCtx) => {
    await renderSalesMenu(outsideCtx);
  });
}
