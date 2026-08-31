import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t } from '../../../locale.js';
import { buildScreen, isMessageNotModifiedError, promptInConversation } from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import { waitForSettingsInput } from './navigation.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';
import { renderSalesMenu } from '../../../keyboards/adminMenu.js';

export async function adminCustomVolumeConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeCtx = ctx;

  for (;;) {
    const ts = ctx.services.translationService;
    const isEnabled = ts.getSettingBool('custom_volume_enabled', true);
    const pricePerGb = ts.getSettingNum('price_per_gb', 5000);
    const defaultDays = ts.getSettingNum('custom_default_days', 30);

    const onBadge = t(ctx, 'admin_overview_active');
    const offBadge = t(ctx, 'admin_overview_inactive');

    const screenText = buildScreen({
      emoji: '📦',
      title: t(ctx, 'admin_sales_custom_volume_title'),
      subtitle: t(ctx, 'admin_sales_custom_volume_subtitle'),
      primary: {
        emoji: isEnabled ? '🟢' : '⚪️',
        label: t(ctx, 'admin_setting_custom_volume_enabled'),
        value: isEnabled ? onBadge : offBadge,
      },
      sections: [
        {
          emoji: '💰',
          title: t(ctx, 'admin_setting_group_pricing'),
          fields: [
            {
              label: t(ctx, 'admin_setting_price_per_gb'),
              value: `${localizedNumber(pricePerGb, ctx)} ${t(ctx, 'currency_toman')}`,
            },
            {
              label: t(ctx, 'admin_setting_custom_default_days'),
              value: `${localizedNumber(defaultDays, ctx)} ${t(ctx, 'days_unit')}`,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(ctx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(
        `${t(ctx, 'admin_setting_custom_volume_enabled')}: ${isEnabled ? onBadge : offBadge}`,
        'cv:toggle'
      )
      .row()
      .text(t(ctx, 'admin_setting_price_per_gb'), 'cv:edit:price_per_gb')
      .row()
      .text(t(ctx, 'admin_setting_custom_default_days'), 'cv:edit:custom_default_days')
      .row()
      .text(t(ctx, 'admin_menu_back_to_sales'), 'cv:back');

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
      callbackPrefixes: ['cv:toggle', 'cv:edit:'],
      backCallbacks: ['cv:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel' || input.type === 'back') break;
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === 'cv:toggle') {
      const nextVal = (!isEnabled).toString();
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting(
          'custom_volume_enabled',
          nextVal
        );
      });
      continue;
    }

    if (input.data.startsWith('cv:edit:')) {
      const key = input.data.slice('cv:edit:'.length);
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
