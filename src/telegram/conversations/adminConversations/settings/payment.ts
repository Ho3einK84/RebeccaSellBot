import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t } from '../../../locale.js';
import { buildScreen, isMessageNotModifiedError, promptInConversation } from '../../../ui.js';
import { escapeTelegramMarkdown } from '../../../rendering.js';
import { requireAdmin } from '../shared.js';
import { waitForSettingsInput } from './navigation.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';
import { renderSalesMenu } from '../../../keyboards/adminMenu.js';
import { formatCardNumberGrouped } from '../wallet.js';

export async function adminPaymentSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeCtx = ctx;

  for (;;) {
    const ts = ctx.services.translationService;
    const cardNumber = ts.getSetting('card_number', '—');
    const cardHolder = ts.getSetting('card_holder', '—');
    const transferEnabled = ts.getSettingBool('wallet_transfer_enabled', true);
    const transferMinAmount = ts.getSettingNum('wallet_transfer_min_amount', 5000);

    const onBadge = t(ctx, 'admin_overview_active');
    const offBadge = t(ctx, 'admin_overview_inactive');

    const screenText = buildScreen({
      emoji: '💳',
      title: t(ctx, 'admin_sales_payment_title'),
      subtitle: t(ctx, 'admin_sales_payment_subtitle'),
      sections: [
        {
          emoji: '💳',
          title: t(ctx, 'payment_method_card_to_card'),
          fields: [
            {
              label: t(ctx, 'admin_setting_card_number'),
              value: `\`${escapeTelegramMarkdown(formatCardNumberGrouped(cardNumber))}\``,
            },
            {
              label: t(ctx, 'admin_setting_card_holder'),
              value: escapeTelegramMarkdown(cardHolder),
            },
          ],
        },
        {
          emoji: '🔄',
          title: t(ctx, 'admin_setting_wallet_transfer_enabled'),
          fields: [
            {
              label: t(ctx, 'admin_setting_wallet_transfer_enabled'),
              value: transferEnabled ? onBadge : offBadge,
            },
            {
              label: t(ctx, 'admin_setting_wallet_transfer_min_amount'),
              value: `${localizedNumber(transferMinAmount, ctx)} ${t(ctx, 'currency_toman')}`,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(ctx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(t(ctx, 'admin_setting_card_number'), 'pay:edit:card_number')
      .row()
      .text(t(ctx, 'admin_setting_card_holder'), 'pay:edit:card_holder')
      .row()
      .text(
        `${t(ctx, 'admin_setting_wallet_transfer_enabled')}: ${transferEnabled ? onBadge : offBadge}`,
        'pay:toggle:transfer'
      )
      .row()
      .text(
        t(ctx, 'admin_setting_wallet_transfer_min_amount'),
        'pay:edit:wallet_transfer_min_amount'
      )
      .row()
      .text(t(ctx, 'admin_menu_back_to_sales'), 'pay:back');

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
      callbackPrefixes: ['pay:edit:', 'pay:toggle:'],
      backCallbacks: ['pay:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel' || input.type === 'back') break;
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === 'pay:toggle:transfer') {
      const nextVal = (!transferEnabled).toString();
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting(
          'wallet_transfer_enabled',
          nextVal
        );
      });
      continue;
    }

    if (input.data.startsWith('pay:edit:')) {
      const key = input.data.slice('pay:edit:'.length);
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
