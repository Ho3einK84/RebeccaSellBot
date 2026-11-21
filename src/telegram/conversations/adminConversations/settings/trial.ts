import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t } from '../../../locale.js';
import { buildScreen } from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import { renderSettingsScreen, waitForSettingsInput } from './navigation.js';
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
    const state = await conversation.external((outsideCtx) => {
      const ts = (outsideCtx?.services ?? activeCtx.services)?.translationService;
      if (!ts) return undefined;
      return {
        isEnabled: ts.getSettingBool('trial_enabled', true),
        trialGb: ts.getSettingNum('trial_gb', 1),
        trialDays: ts.getSettingNum('trial_days', 3),
        requirePhone: ts.getSettingBool('require_phone_for_trial', false),
        iranOnlyPhone: ts.getSettingBool('phone_verify_iran_only', true),
      };
    });
    if (!state) return;
    const { isEnabled, trialGb, trialDays, requirePhone, iranOnlyPhone } = state;

    const onBadge = t(activeCtx, 'admin_overview_active');
    const offBadge = t(activeCtx, 'admin_overview_inactive');

    const screenText = buildScreen({
      emoji: '🎁',
      title: t(activeCtx, 'admin_sales_trial_title'),
      subtitle: t(activeCtx, 'admin_sales_trial_subtitle'),
      primary: {
        emoji: isEnabled ? '🟢' : '⚪️',
        label: t(activeCtx, 'admin_setting_trial_enabled'),
        value: isEnabled ? onBadge : offBadge,
      },
      sections: [
        {
          emoji: '⚙️',
          title: t(activeCtx, 'admin_sales_trial_specs_section'),
          fields: [
            {
              label: t(activeCtx, 'admin_setting_trial_gb'),
              value: `${localizedNumber(trialGb, activeCtx)} ${t(activeCtx, 'traffic_unit_gb')}`,
            },
            {
              label: t(activeCtx, 'admin_setting_trial_days'),
              value: `${localizedNumber(trialDays, activeCtx)} ${t(activeCtx, 'days_unit')}`,
            },
            {
              label: t(activeCtx, 'admin_setting_require_phone_for_trial'),
              value: requirePhone ? onBadge : offBadge,
            },
            {
              label: t(activeCtx, 'admin_setting_phone_verify_iran_only'),
              value: iranOnlyPhone ? onBadge : offBadge,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(
        `${t(activeCtx, 'admin_setting_trial_enabled')}: ${isEnabled ? onBadge : offBadge}`,
        'trial:toggle'
      )
      .row()
      .text(t(activeCtx, 'admin_setting_trial_gb'), 'trial:edit:trial_gb')
      .row()
      .text(t(activeCtx, 'admin_setting_trial_days'), 'trial:edit:trial_days')
      .row()
      .text(
        `${t(activeCtx, 'admin_setting_require_phone_for_trial')}: ${requirePhone ? onBadge : offBadge}`,
        'trial:toggle:phone'
      )
      .row()
      .text(
        `${t(activeCtx, 'admin_setting_phone_verify_iran_only')}: ${iranOnlyPhone ? onBadge : offBadge}`,
        'trial:toggle:iran_only'
      )
      .row()
      .text(t(activeCtx, 'admin_menu_back_to_sales'), 'trial:back');

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['trial:toggle', 'trial:edit:'],
      backCallbacks: ['trial:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return;
    if (input.type === 'back') break;
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

    if (input.data === 'trial:toggle:phone') {
      const nextVal = (!requirePhone).toString();
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting(
          'require_phone_for_trial',
          nextVal
        );
      });
      continue;
    }

    if (input.data === 'trial:toggle:iran_only') {
      const nextVal = (!iranOnlyPhone).toString();
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting(
          'phone_verify_iran_only',
          nextVal
        );
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
