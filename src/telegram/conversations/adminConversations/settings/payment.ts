import { InlineKeyboard } from 'grammy';
import {
  detectIranianBankName,
  normalizeCardNumber,
  parseBankCardsJson,
} from '../../../../domain/services/PaymentService.js';
import {
  paymentMessageAutoDeleteHours,
  uniqueTopupAmountEnabled,
} from '../../../../domain/services/FeatureSettings.js';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, resolveContextLocale, t } from '../../../locale.js';
import { buildScreen } from '../../../ui.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from '../../../rendering.js';
import { requireAdmin } from '../shared.js';
import { renderSettingsScreen, waitForSettingsInput } from './navigation.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';
import { displayAdminSettingValue } from './presentation.js';
import { renderSalesMenu } from '../../../keyboards/adminMenu.js';
import { formatCardNumberGrouped } from '../wallet.js';
import { manageBankCards } from './bankCards.js';

export async function adminPaymentSettingsConversation(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<void> {
  if (!(await requireAdmin(conversation, ctx)) || !ctx.services) return;

  let activeCtx = ctx;

  for (;;) {
    const state = await conversation.external((outsideCtx) => {
      const ts = (outsideCtx?.services ?? activeCtx.services)?.translationService;
      if (!ts) return undefined;
      const configuredCards = parseBankCardsJson(ts.getSetting('bank_cards_json', '[]'));
      const activeMultiCards = configuredCards.filter((card) => card.enabled);
      const rawCardNumber = ts.getSetting('card_number', '—');
      return {
        cardNumber: rawCardNumber,
        cardHolder: ts.getSetting('card_holder', '—'),
        configuredCardsCount: configuredCards.length,
        activeCardsCount: activeMultiCards.length,
        uniqueAmountEnabled: uniqueTopupAmountEnabled(ts),
        autoDeleteHours: paymentMessageAutoDeleteHours(ts, 0),
        transferEnabled: ts.getSettingBool('wallet_transfer_enabled', true),
        transferMinAmount: ts.getSettingNum('wallet_transfer_min_amount', 5000),
        receiptNotifyEnabled: ts.getSettingBool('receipt_notify_enabled', true),
        receiptNotifyMode: ts.getSetting('receipt_notify_mode', 'full') as 'full' | 'simple',
        receiptNotifyAdminsRaw: ts.getSetting('receipt_notify_admins', '').trim(),
        receiptDuplicatePolicy:
          ts.getSetting('receipt_duplicate_policy', 'warn').trim().toLowerCase() === 'block'
            ? ('block' as const)
            : ('warn' as const),
      };
    });
    if (!state) return;
    const {
      cardNumber,
      cardHolder,
      configuredCardsCount,
      activeCardsCount,
      uniqueAmountEnabled,
      autoDeleteHours,
      transferEnabled,
      transferMinAmount,
      receiptNotifyEnabled,
      receiptNotifyMode,
      receiptNotifyAdminsRaw,
      receiptDuplicatePolicy,
    } = state;

    const onBadge = t(activeCtx, 'admin_overview_active');
    const offBadge = t(activeCtx, 'admin_overview_inactive');
    const isAllAdmins = !receiptNotifyAdminsRaw || receiptNotifyAdminsRaw === 'all';
    const duplicatePolicyLabel =
      receiptDuplicatePolicy === 'block'
        ? t(activeCtx, 'admin_receipt_duplicate_policy_block')
        : t(activeCtx, 'admin_receipt_duplicate_policy_warn');
    const locale = resolveContextLocale(activeCtx);
    const detectedDefaultBank = detectIranianBankName(normalizeCardNumber(cardNumber), locale);

    const screenText = buildScreen({
      emoji: '💳',
      title: t(activeCtx, 'admin_sales_payment_title'),
      subtitle: t(activeCtx, 'admin_sales_payment_subtitle'),
      sections: [
        {
          emoji: '💳',
          title: t(activeCtx, 'payment_method_card_to_card'),
          fields: [
            {
              label: t(activeCtx, 'admin_setting_bank_cards_json'),
              value: escapeTelegramMarkdown(displayAdminSettingValue(activeCtx, 'bank_cards_json')),
            },
            {
              label: t(activeCtx, 'admin_setting_card_number'),
              value: `\`${sanitizeTelegramInlineCode(formatCardNumberGrouped(cardNumber))}\`${detectedDefaultBank ? ` (${escapeTelegramMarkdown(detectedDefaultBank)})` : ''}`,
            },
            {
              label: t(activeCtx, 'admin_setting_card_holder'),
              value: escapeTelegramMarkdown(cardHolder),
            },
            {
              label: t(activeCtx, 'admin_setting_unique_topup_amount_enabled'),
              value: uniqueAmountEnabled ? onBadge : offBadge,
            },
            {
              label: t(activeCtx, 'admin_setting_payment_message_auto_delete_hours'),
              value:
                autoDeleteHours === 0
                  ? t(activeCtx, 'admin_setting_payment_message_auto_delete_disabled')
                  : `${localizedNumber(autoDeleteHours, activeCtx)} ${t(activeCtx, 'hours_unit')}`,
            },
          ],
        },
        {
          emoji: '🔄',
          title: t(activeCtx, 'admin_setting_wallet_transfer_enabled'),
          fields: [
            {
              label: t(activeCtx, 'admin_setting_wallet_transfer_enabled'),
              value: transferEnabled ? onBadge : offBadge,
            },
            {
              label: t(activeCtx, 'admin_setting_wallet_transfer_min_amount'),
              value: `${localizedNumber(transferMinAmount, activeCtx)} ${t(activeCtx, 'currency_toman')}`,
            },
          ],
        },
        {
          emoji: '🔔',
          title: t(activeCtx, 'admin_setting_receipt_notify_enabled'),
          fields: [
            {
              label: t(activeCtx, 'admin_setting_receipt_notify_enabled'),
              value: receiptNotifyEnabled ? onBadge : offBadge,
            },
            {
              label: t(activeCtx, 'admin_setting_receipt_notify_mode'),
              value:
                receiptNotifyMode === 'simple'
                  ? t(activeCtx, 'admin_receipt_notify_mode_simple')
                  : t(activeCtx, 'admin_receipt_notify_mode_full'),
            },
            {
              label: t(activeCtx, 'admin_setting_receipt_notify_admins'),
              value: isAllAdmins
                ? t(activeCtx, 'admin_receipt_notify_admins_all')
                : receiptNotifyAdminsRaw
                    .split(',')
                    .map((id) => `\`${sanitizeTelegramInlineCode(id.trim())}\``)
                    .join(', '),
            },
            {
              label: t(activeCtx, 'admin_setting_receipt_duplicate_policy'),
              value: duplicatePolicyLabel,
            },
          ],
        },
      ],
      footer:
        activeCardsCount >= 2
          ? `${t(activeCtx, 'admin_bank_cards_rotation_active', { count: localizedNumber(activeCardsCount, activeCtx) })}\nℹ️ ${t(activeCtx, 'admin_home_hint')}`
          : configuredCardsCount > 0 && activeCardsCount === 0
            ? `${t(activeCtx, 'admin_bank_cards_all_disabled_warning')}\nℹ️ ${t(activeCtx, 'admin_home_hint')}`
            : `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
    });

    const cardsBtnBadge =
      configuredCardsCount > 0
        ? ` (${localizedNumber(activeCardsCount, activeCtx)}/${localizedNumber(configuredCardsCount, activeCtx)})`
        : '';

    const keyboard = new InlineKeyboard()
      .text(`${t(activeCtx, 'admin_sales_bank_cards_button')}${cardsBtnBadge}`, 'pay:cards')
      .row()
      .text(t(activeCtx, 'admin_setting_card_number'), 'pay:edit:card_number')
      .text(t(activeCtx, 'admin_setting_card_holder'), 'pay:edit:card_holder')
      .row()
      .text(
        `${t(activeCtx, 'admin_setting_unique_topup_amount_enabled')}: ${uniqueAmountEnabled ? onBadge : offBadge}`,
        'pay:toggle:unique_amount'
      )
      .row()
      .text(
        t(activeCtx, 'admin_setting_payment_message_auto_delete_hours'),
        'pay:edit:payment_message_auto_delete_hours'
      )
      .row()
      .text(
        `${t(activeCtx, 'admin_setting_wallet_transfer_enabled')}: ${transferEnabled ? onBadge : offBadge}`,
        'pay:toggle:transfer'
      )
      .row()
      .text(
        t(activeCtx, 'admin_setting_wallet_transfer_min_amount'),
        'pay:edit:wallet_transfer_min_amount'
      )
      .row()
      .text(
        `${t(activeCtx, 'admin_setting_receipt_notify_enabled')}: ${receiptNotifyEnabled ? onBadge : offBadge}`,
        'pay:toggle:receipt_notify'
      )
      .row()
      .text(
        `${t(activeCtx, 'admin_setting_receipt_notify_mode')}: ${
          receiptNotifyMode === 'simple'
            ? t(activeCtx, 'admin_receipt_notify_mode_simple')
            : t(activeCtx, 'admin_receipt_notify_mode_full')
        }`,
        'pay:toggle:receipt_mode'
      )
      .row()
      .text(
        `${t(activeCtx, 'admin_setting_receipt_duplicate_policy')}: ${duplicatePolicyLabel}`,
        'pay:toggle:dup_policy'
      )
      .row()
      .text(
        `${t(activeCtx, 'admin_setting_receipt_notify_admins')}: ${
          isAllAdmins
            ? t(activeCtx, 'admin_receipt_notify_admins_all')
            : `${localizedNumber(receiptNotifyAdminsRaw.split(',').filter(Boolean).length, activeCtx)} ${t(activeCtx, 'admin_receipt_notify_admins_select')}`
        }`,
        'pay:admins:receipt'
      )
      .row()
      .text(t(activeCtx, 'admin_menu_back_to_sales'), 'pay:back');

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['pay:cards', 'pay:edit:', 'pay:toggle:', 'pay:admins:'],
      backCallbacks: ['pay:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return;
    if (input.type === 'back') break;
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === 'pay:cards' || input.data === 'pay:edit:bank_cards_json') {
      const outcome = await manageBankCards(conversation, activeCtx);
      if (outcome === 'cancel') return;
      continue;
    }

    if (input.data === 'pay:toggle:unique_amount') {
      const nextVal = (!uniqueAmountEnabled).toString();
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting(
          'unique_topup_amount_enabled',
          nextVal
        );
      });
      continue;
    }

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

    if (input.data === 'pay:toggle:dup_policy') {
      const nextPolicy = receiptDuplicatePolicy === 'block' ? 'warn' : 'block';
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting(
          'receipt_duplicate_policy',
          nextPolicy
        );
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
        const outcome = await editSetting(conversation, activeCtx, definition);
        if (outcome === 'cancel') return;
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

  for (;;) {
    const state = await conversation.external((outsideCtx) => {
      const services = outsideCtx?.services ?? activeCtx.services;
      const ts = services?.translationService;
      if (!ts) return undefined;
      return {
        adminIds: services?.adminIds ?? [],
        currentAdminsRaw: ts.getSetting('receipt_notify_admins', '').trim(),
      };
    });
    if (!state) break;
    const { adminIds, currentAdminsRaw } = state;

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

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['pay:rec_adm:'],
      backCallbacks: ['pay:rec_adm:done'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return activeCtx;
    if (input.type === 'back') {
      if (input.ctx) activeCtx = input.ctx;
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
