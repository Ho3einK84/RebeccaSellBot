import { InlineKeyboard } from 'grammy';
import type { ConversationContext, MyConversation } from '../../../types.js';
import { localizedNumber, t } from '../../../locale.js';
import { buildScreen } from '../../../ui.js';
import { requireAdmin } from '../shared.js';
import { renderSettingsScreen, waitForSettingsInput } from './navigation.js';
import { editSetting } from './conversation.js';
import { getSettingDefinition } from './catalog.js';
import { renderSalesMenu } from '../../../keyboards/adminMenu.js';

export async function adminLuckyWheelSettingsConversation(
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
        enabled: ts.getSetting('lucky_wheel_enabled', 'true') === 'true',
        minAmount: ts.getSettingNum('lucky_wheel_min_amount', 1_000),
        maxAmount: ts.getSettingNum('lucky_wheel_max_amount', 50_000),
        baseLuck: ts.getSettingNum('lucky_wheel_base_luck_percent', 50),
        decayPercent: ts.getSettingNum('lucky_wheel_decay_percent', 10),
        cooldownHours: ts.getSettingNum('lucky_wheel_cooldown_hours', 24),
        maxSpins: ts.getSettingNum('lucky_wheel_max_spins', 5),
      };
    });
    if (!state) return;
    const { enabled, minAmount, maxAmount, baseLuck, decayPercent, cooldownHours, maxSpins } =
      state;

    const onBadge = t(activeCtx, 'admin_overview_active');
    const offBadge = t(activeCtx, 'admin_overview_inactive');

    const screenText = buildScreen({
      emoji: '🎡',
      title: t(activeCtx, 'admin_sales_lucky_wheel_title'),
      subtitle: t(activeCtx, 'admin_sales_lucky_wheel_subtitle'),
      primary: {
        emoji: enabled ? '🟢' : '⚪️',
        label: t(activeCtx, 'admin_setting_lucky_wheel_enabled'),
        value: enabled ? onBadge : offBadge,
      },
      sections: [
        {
          emoji: '⚙️',
          title: t(activeCtx, 'admin_setting_group_lucky_wheel'),
          fields: [
            {
              label: t(activeCtx, 'admin_setting_lucky_wheel_min_amount'),
              value: `${localizedNumber(minAmount, activeCtx)} ${t(activeCtx, 'currency_toman')}`,
            },
            {
              label: t(activeCtx, 'admin_setting_lucky_wheel_max_amount'),
              value: `${localizedNumber(maxAmount, activeCtx)} ${t(activeCtx, 'currency_toman')}`,
            },
            {
              label: t(activeCtx, 'admin_setting_lucky_wheel_base_luck_percent'),
              value: `${localizedNumber(baseLuck, activeCtx)}%`,
            },
            {
              label: t(activeCtx, 'admin_setting_lucky_wheel_decay_percent'),
              value: `${localizedNumber(decayPercent, activeCtx)}%`,
            },
            {
              label: t(activeCtx, 'admin_setting_lucky_wheel_cooldown_hours'),
              value: `${localizedNumber(cooldownHours, activeCtx)} ${t(activeCtx, 'hours_unit')}`,
            },
            {
              label: t(activeCtx, 'admin_setting_lucky_wheel_max_spins'),
              value: `${localizedNumber(maxSpins, activeCtx)}`,
            },
          ],
        },
      ],
      footer: `ℹ️ ${t(activeCtx, 'admin_home_hint')}`,
    });

    const keyboard = new InlineKeyboard()
      .text(
        `${t(activeCtx, 'admin_setting_lucky_wheel_enabled')}: ${enabled ? onBadge : offBadge}`,
        'wheel_cfg:toggle'
      )
      .row()
      .text(
        t(activeCtx, 'admin_setting_lucky_wheel_min_amount'),
        'wheel_cfg:edit:lucky_wheel_min_amount'
      )
      .text(
        t(activeCtx, 'admin_setting_lucky_wheel_max_amount'),
        'wheel_cfg:edit:lucky_wheel_max_amount'
      )
      .row()
      .text(
        t(activeCtx, 'admin_setting_lucky_wheel_base_luck_percent'),
        'wheel_cfg:edit:lucky_wheel_base_luck_percent'
      )
      .text(
        t(activeCtx, 'admin_setting_lucky_wheel_decay_percent'),
        'wheel_cfg:edit:lucky_wheel_decay_percent'
      )
      .row()
      .text(
        t(activeCtx, 'admin_setting_lucky_wheel_cooldown_hours'),
        'wheel_cfg:edit:lucky_wheel_cooldown_hours'
      )
      .text(
        t(activeCtx, 'admin_setting_lucky_wheel_max_spins'),
        'wheel_cfg:edit:lucky_wheel_max_spins'
      )
      .row()
      .text(t(activeCtx, 'admin_menu_back_to_sales'), 'wheel_cfg:back');

    await renderSettingsScreen(conversation, activeCtx, screenText, keyboard);

    const input = await waitForSettingsInput(conversation, {
      callbackPrefixes: ['wheel_cfg:toggle', 'wheel_cfg:edit:'],
      backCallbacks: ['wheel_cfg:back'],
      retryKeyboard: keyboard,
    });

    if (input.type === 'cancel') return;
    if (input.type === 'back') break;
    if (input.type !== 'callback') continue;
    activeCtx = input.ctx;

    if (input.data === 'wheel_cfg:toggle') {
      const nextVal = (!enabled).toString();
      await conversation.external(async (outsideCtx) => {
        if (!outsideCtx.services) return;
        await outsideCtx.services.translationService.updateSetting('lucky_wheel_enabled', nextVal);
      });
      continue;
    }

    if (input.data.startsWith('wheel_cfg:edit:')) {
      const key = input.data.slice('wheel_cfg:edit:'.length);
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
