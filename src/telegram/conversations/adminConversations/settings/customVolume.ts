import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t } from '../../../locale.js';
import { buildScreen } from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import { renderSettingsScreen, waitForSettingsInput } from './navigation.js';
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
    const state = await conversation.external((outsideCtx) => {
      const ts = (outsideCtx?.services ?? activeCtx.services)?.translationService;
      if (!ts) return undefined;
      return {
        isEnabled: ts.getSettingBool('custom_volume_enabled', true),
        pricePerGb: ts.getSettingNum('price_per_gb', 5000),
        defaultDays: ts.getSettingNum('custom_default_days', 30),
      };
    });
    if (!state) return;
    const { isEnabled, pricePerGb, defaultDays } = state;

    const onBadge = t(activeCtx, 'admin_overview_active');
    const offBadge = t(activeCtx, 'admin_overview_inactive');

    const screenText = buildScreen({
      emoji: '📦',
      title: t(activeCtx, 'admin_sales_custom_volume_title'),
      subtitle: t(activeCtx, 'admin_sales_custom_volume_subtitle'),
      primary: {
        emoji: isEnabled ? '🟢' : '⚪️',
        label: t(activeCtx, 'admin_setting_custom_volume_enabled'),
        value: isEnabled ? onBadge : offBadge,
      },
      sections: [
        {
          emoji: '💰',
          title: t(activeCtx, 'admin_setting_group_pricing'),
          fields: [
            {
              label: t(activeCtx, 'admin_setting_price_per_gb'),
              value: `${localizedNumber(pricePerGb, activeCtx)} ${t(activeCtx, 'currency_toman')}`,
            },
            {
              label: t(activeCtx, 'admin_setting_custom_default_days'),
              value: `${localizedNumber(defaultDays, activeCtx)} ${t(activeCtx, 'days_unit')}`,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(
        `${t(activeCtx, 'admin_setting_custom_volume_enabled')}: ${isEnabled ? onBadge : offBadge}`,
        'cv:toggle'
      )
      .row()
      .text(t(activeCtx, 'admin_setting_price_per_gb'), 'cv:edit:price_per_gb')
      .row()
      .text(t(activeCtx, 'admin_setting_custom_default_days'), 'cv:edit:custom_default_days')
      .row()
      .text(t(activeCtx, 'admin_menu_back_to_sales'), 'cv:back');

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['cv:toggle', 'cv:edit:'],
      backCallbacks: ['cv:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return;
    if (input.type === 'back') break;
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
        const outcome = await editSetting(conversation, activeCtx, definition);
        if (outcome === 'cancel') return;
      }
    }
  }

  await conversation.external(async (outsideCtx) => {
    await renderSalesMenu(outsideCtx);
  });
}
