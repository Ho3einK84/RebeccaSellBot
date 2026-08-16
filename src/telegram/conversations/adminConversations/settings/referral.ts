import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t } from '../../../locale.js';
import {
  buildScreen,
  isMessageNotModifiedError,
  promptInConversation,
  renderUiScreen,
} from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import { waitForSettingsInput } from './navigation.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';
import { adminSalesMenu, renderAdminSalesMenuScreen } from '../../../keyboards/adminMenu.js';

export async function adminReferralSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeCtx = ctx;

  for (;;) {
    const ts = ctx.services.translationService;
    const refBonus = ts.getSettingNum('referral_bonus_toman', 10000);
    const cashback = ts.getSettingNum('cashback_percent', 5);

    const screenText = buildScreen({
      emoji: '👥',
      title: t(ctx, 'admin_sales_referral_title'),
      subtitle: t(ctx, 'admin_sales_referral_subtitle'),
      sections: [
        {
          emoji: '🎁',
          title: t(ctx, 'admin_setting_group_referral'),
          fields: [
            {
              label: t(ctx, 'admin_setting_referral_bonus_toman'),
              value: `${localizedNumber(refBonus, ctx)} ${t(ctx, 'currency_toman')}`,
            },
            {
              label: t(ctx, 'admin_setting_cashback_percent'),
              value: `${localizedNumber(cashback, ctx)}%`,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(ctx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(t(ctx, 'admin_setting_referral_bonus_toman'), 'ref:edit:referral_bonus_toman')
      .row()
      .text(t(ctx, 'admin_setting_cashback_percent'), 'ref:edit:cashback_percent')
      .row()
      .text(t(ctx, 'admin_menu_back'), 'ref:back');

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
      callbackPrefixes: ['ref:edit:'],
      backCallbacks: ['ref:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel' || input.type === 'back') break;
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data.startsWith('ref:edit:')) {
      const key = input.data.slice('ref:edit:'.length);
      const definition = getSettingDefinition(key);
      if (definition) {
        await editSetting(conversation, ctx, definition);
      }
    }
  }

  await conversation.external(async (outsideCtx) => {
    await renderUiScreen(outsideCtx, renderAdminSalesMenuScreen(outsideCtx), {
      parse_mode: 'Markdown',
      reply_markup: adminSalesMenu,
    });
  });
}
