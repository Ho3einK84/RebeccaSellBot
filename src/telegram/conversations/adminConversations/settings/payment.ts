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
    const receiptNotifyEnabled = ts.getSettingBool('receipt_notify_enabled', true);
    const receiptNotifyMode = ts.getSetting('receipt_notify_mode', 'full') as 'full' | 'simple';
    const receiptNotifyAdminsRaw = ts.getSetting('receipt_notify_admins', '').trim();

    const onBadge = t(ctx, 'admin_overview_active');
    const offBadge = t(ctx, 'admin_overview_inactive');
    const isAllAdmins = !receiptNotifyAdminsRaw || receiptNotifyAdminsRaw === 'all';

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
        {
          emoji: '🔔',
          title: t(ctx, 'admin_setting_receipt_notify_enabled'),
          fields: [
            {
              label: t(ctx, 'admin_setting_receipt_notify_enabled'),
              value: receiptNotifyEnabled ? onBadge : offBadge,
            },
            {
              label: t(ctx, 'admin_setting_receipt_notify_mode'),
              value:
                receiptNotifyMode === 'simple'
                  ? t(ctx, 'admin_receipt_notify_mode_simple')
                  : t(ctx, 'admin_receipt_notify_mode_full'),
            },
            {
              label: t(ctx, 'admin_setting_receipt_notify_admins'),
              value: isAllAdmins
                ? t(ctx, 'admin_receipt_notify_admins_all')
                : receiptNotifyAdminsRaw
                    .split(',')
                    .map((id) => `\`${id.trim()}\``)
                    .join(', '),
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
      .text(
        `${t(ctx, 'admin_setting_receipt_notify_enabled')}: ${receiptNotifyEnabled ? onBadge : offBadge}`,
        'pay:toggle:receipt_notify'
      )
      .row()
      .text(
        `${t(ctx, 'admin_setting_receipt_notify_mode')}: ${
          receiptNotifyMode === 'simple'
            ? t(ctx, 'admin_receipt_notify_mode_simple')
            : t(ctx, 'admin_receipt_notify_mode_full')
        }`,
        'pay:toggle:receipt_mode'
      )
      .row()
      .text(
        `${t(ctx, 'admin_setting_receipt_notify_admins')}: ${
          isAllAdmins
            ? t(ctx, 'admin_receipt_notify_admins_all')
            : `${localizedNumber(receiptNotifyAdminsRaw.split(',').filter(Boolean).length, ctx)} ${t(ctx, 'admin_receipt_notify_admins_select')}`
        }`,
        'pay:admins:receipt'
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
      callbackPrefixes: ['pay:edit:', 'pay:toggle:', 'pay:admins:'],
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

    if (input.data === 'pay:toggle:receipt_notify') {
      const nextVal = (!receiptNotifyEnabled).toString();
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting(
          'receipt_notify_enabled',
          nextVal
        );
      });
      continue;
    }

    if (input.data === 'pay:toggle:receipt_mode') {
      const nextMode = receiptNotifyMode === 'simple' ? 'full' : 'simple';
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting('receipt_notify_mode', nextMode);
      });
      continue;
    }

    if (input.data === 'pay:admins:receipt') {
      activeCtx = await manageReceiptAdmins(conversation, activeCtx);
      continue;
    }

    if (input.data.startsWith('pay:edit:')) {
      const key = input.data.slice('pay:edit:'.length);
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

async function manageReceiptAdmins(
  conversation: MyConversation,
  initialCtx: ConversationContext
): Promise<ConversationContext> {
  let activeCtx = initialCtx;
  const adminIds = activeCtx.services?.adminIds ?? [];

  for (;;) {
    const ts = activeCtx.services?.translationService;
    if (!ts) break;

    const currentAdminsRaw = ts.getSetting('receipt_notify_admins', '').trim();
    const isAll = !currentAdminsRaw || currentAdminsRaw === 'all';
    const selectedIds = new Set(
      isAll
        ? []
        : currentAdminsRaw
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isSafeInteger(n) && n > 0)
    );

    const keyboard = new InlineKeyboard()
      .text(
        `${isAll ? '✅ ' : '⬜ '}${t(activeCtx, 'admin_receipt_notify_admins_all')}`,
        'pay:rec_adm:all'
      )
      .row();

    for (const adminId of adminIds) {
      const isSelected = !isAll && selectedIds.has(adminId);
      keyboard
        .text(`${isSelected ? '✅ ' : '⬜ '} ${adminId}`, `pay:rec_adm:toggle:${adminId}`)
        .row();
    }

    keyboard.text(t(activeCtx, 'menu_back'), 'pay:rec_adm:done');

    const screenText = buildScreen({
      emoji: '👥',
      title: t(activeCtx, 'admin_receipt_notify_admins_title'),
      subtitle: t(activeCtx, 'admin_receipt_notify_admins_subtitle'),
      sections: [
        {
          emoji: '📋',
          title: t(activeCtx, 'admin_setting_receipt_notify_admins'),
          fields: [
            {
              label: t(activeCtx, 'admin_setting_receipt_notify_admins'),
              value: isAll
                ? t(activeCtx, 'admin_receipt_notify_admins_all')
                : `${localizedNumber(selectedIds.size, activeCtx)} ${t(activeCtx, 'admin_receipt_notify_admins_select')}`,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
    });

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
      callbackPrefixes: ['pay:rec_adm:'],
      backCallbacks: ['pay:rec_adm:done'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel' || input.type === 'back') {
      if (input.type === 'back' && input.ctx) activeCtx = input.ctx;
      break;
    }
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === 'pay:rec_adm:done') break;

    if (input.data === 'pay:rec_adm:all') {
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting('receipt_notify_admins', '');
      });
      continue;
    }

    if (input.data.startsWith('pay:rec_adm:toggle:')) {
      const targetId = Number(input.data.slice('pay:rec_adm:toggle:'.length));
      if (Number.isSafeInteger(targetId)) {
        let newIds: number[];
        if (isAll) {
          newIds = [targetId];
        } else {
          if (selectedIds.has(targetId)) {
            selectedIds.delete(targetId);
          } else {
            selectedIds.add(targetId);
          }
          newIds = Array.from(selectedIds);
        }
        const nextVal = newIds.length === 0 ? '' : newIds.join(',');
        await conversation.external(async (outsideCtx) => {
          if (!outsideCtx.services) return;
          await outsideCtx.services.translationService.updateSetting(
            'receipt_notify_admins',
            nextVal
          );
        });
      }
    }
  }

  return activeCtx;
}
