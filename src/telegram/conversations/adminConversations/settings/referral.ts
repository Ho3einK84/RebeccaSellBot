import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t } from '../../../locale.js';
import { buildScreen, promptInConversation } from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import { waitForSettingsInput } from './navigation.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';

export async function adminReferralSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

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
      .text(t(ctx, 'admin_menu_back'), 'conversation:cancel');

    await promptInConversation(conversation, ctx, screenText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['ref:edit:'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel' || input.type === 'back') return;
    if (input.type !== 'callback') continue;

    if (input.data.startsWith('ref:edit:')) {
      const key = input.data.slice('ref:edit:'.length);
      const definition = getSettingDefinition(key);
      if (definition) {
        await editSetting(conversation, ctx, definition);
      }
    }
  }
}
