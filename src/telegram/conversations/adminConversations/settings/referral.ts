import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t } from '../../../locale.js';
import { buildScreen } from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import { renderSettingsScreen, waitForSettingsInput } from './navigation.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';
import { renderSalesMenu } from '../../../keyboards/adminMenu.js';

export async function adminReferralSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeCtx = ctx;

  for (;;) {
    const state = await conversation.external((outsideCtx) => {
      const ts = (outsideCtx?.services ?? activeCtx.services)?.translationService;
      if (!ts) return undefined;
      return {
        refBonus: ts.getSettingNum('referral_bonus_toman', 10000),
        cashback: ts.getSettingNum('cashback_percent', 5),
      };
    });
    if (!state) return;
    const { refBonus, cashback } = state;

    const screenText = buildScreen({
      emoji: '👥',
      title: t(activeCtx, 'admin_sales_referral_title'),
      subtitle: t(activeCtx, 'admin_sales_referral_subtitle'),
      sections: [
        {
          emoji: '🎁',
          title: t(activeCtx, 'admin_setting_group_referral'),
          fields: [
            {
              label: t(activeCtx, 'admin_setting_referral_bonus_toman'),
              value: `${localizedNumber(refBonus, activeCtx)} ${t(activeCtx, 'currency_toman')}`,
            },
            {
              label: t(activeCtx, 'admin_setting_cashback_percent'),
              value: `${localizedNumber(cashback, activeCtx)}%`,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(t(activeCtx, 'admin_setting_referral_bonus_toman'), 'ref:edit:referral_bonus_toman')
      .row()
      .text(t(activeCtx, 'admin_setting_cashback_percent'), 'ref:edit:cashback_percent')
      .row()
      .text(t(activeCtx, 'admin_menu_back_to_sales'), 'ref:back');

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['ref:edit:'],
      backCallbacks: ['ref:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return;
    if (input.type === 'back') break;
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data.startsWith('ref:edit:')) {
      const key = input.data.slice('ref:edit:'.length);
      const definition = getSettingDefinition(key);
      if (definition) {
        const outcome = await editSetting(conversation, activeCtx, definition);
        if (outcome === 'cancel') return;
      }
    }
  }

  await conversation.external(async (outsideCtx) => {
    await renderSalesMenu(outsideCtx);
  });
}
