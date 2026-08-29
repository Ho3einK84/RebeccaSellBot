/**
 * Lucky Wheel routes and Telegram animation flows.
 */

import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import type { BotServices, MenuContext } from '../types.js';
import { localizedNumber, t } from '../locale.js';
import { buildScreen, renderScreen } from '../ui.js';
import { acquireUserActionCooldown } from '../middleware/actionCooldown.js';
import { logger } from '../../infra/logger.js';

function formatRemainingTime(seconds: number, ctx: MenuContext): string {
  if (seconds <= 0) return '0';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);

  if (hours > 0) {
    return `${localizedNumber(hours, ctx)} ${t(ctx, 'hours_unit')} و ${localizedNumber(minutes, ctx)} دقیقه`;
  }
  return `${localizedNumber(minutes, ctx)} دقیقه`;
}

export async function renderLuckyWheelScreen(ctx: MenuContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.services) return;

  const status = await ctx.services.luckyWheelService.getStatus(telegramId);
  const spinsLeft = Math.max(0, status.maxSpins - status.totalSpins);

  const fields = [
    {
      emoji: '🎯',
      label: t(ctx, 'wheel_spins_left_label'),
      value: `${localizedNumber(spinsLeft, ctx)} / ${localizedNumber(status.maxSpins, ctx)}`,
    },
    {
      emoji: '🎁',
      label: t(ctx, 'wheel_prize_label'),
      value: `${localizedNumber(status.minPrize, ctx)} تا ${localizedNumber(status.maxPrize, ctx)} ${t(ctx, 'currency_toman')}`,
    },
  ];

  if (status.reason === 'cooldown_active' && status.secondsRemaining) {
    fields.push({
      emoji: '⏳',
      label: t(ctx, 'wheel_next_spin_label'),
      value: formatRemainingTime(status.secondsRemaining, ctx),
    });
  }

  let footer: string | undefined;
  if (!status.enabled) {
    footer = t(ctx, 'wheel_disabled');
  } else if (status.reason === 'max_spins_reached') {
    footer = t(ctx, 'wheel_max_spins_reached');
  }

  const screenText = buildScreen({
    emoji: '🎡',
    title: t(ctx, 'wheel_title'),
    subtitle: t(ctx, 'wheel_subtitle'),
    sections: [
      {
        emoji: '📊',
        title: t(ctx, 'wheel_status_section'),
        fields,
      },
    ],
    footer,
  });

  const keyboard = new InlineKeyboard();
  if (status.canSpin) {
    keyboard.text(t(ctx, 'wheel_spin_button'), 'wheel:spin').row();
  }
  keyboard.text(t(ctx, 'menu_back_main'), 'nav:main');

  await renderScreen(ctx, screenText, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

export function registerLuckyWheelRoutes(bot: Bot<MenuContext>, services: BotServices): void {
  bot.callbackQuery('wheel:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderLuckyWheelScreen(ctx);
  });

  bot.callbackQuery('wheel:spin', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    if (!acquireUserActionCooldown(telegramId, 'wheel_spin', 3000)) {
      await ctx.answerCallbackQuery({ text: '⏳', show_alert: false });
      return;
    }

    try {
      // Step 1: Trigger spin logic
      const result = await services.luckyWheelService.spin(telegramId);
      await ctx.answerCallbackQuery();

      const chatId = ctx.chat?.id;
      const messageId = ctx.callbackQuery?.message?.message_id;

      // Suspense Animation Frame 1
      if (chatId && messageId) {
        try {
          const frame1 = buildScreen({
            emoji: '🎡',
            title: t(ctx, 'wheel_spinning_title'),
            subtitle: t(ctx, 'wheel_spinning_step1'),
          });
          await ctx.api.editMessageText(chatId, messageId, frame1, { parse_mode: 'Markdown' });
          await new Promise((r) => setTimeout(r, 400));

          // Suspense Animation Frame 2
          const frame2 = buildScreen({
            emoji: '✨',
            title: t(ctx, 'wheel_spinning_title'),
            subtitle: t(ctx, 'wheel_spinning_step2'),
          });
          await ctx.api.editMessageText(chatId, messageId, frame2, { parse_mode: 'Markdown' });
          await new Promise((r) => setTimeout(r, 500));
        } catch {
          // If intermediate frame edits fail (e.g. rate limit), continue to result frame
        }
      }

      // Final Prize Frame
      const winScreen = buildScreen({
        emoji: '🎁',
        title: t(ctx, 'wheel_win_title'),
        subtitle: t(ctx, 'wheel_win_subtitle'),
        primary: {
          emoji: '💰',
          label: t(ctx, 'wheel_prize_label'),
          value: `+${localizedNumber(result.amount, ctx)} ${t(ctx, 'currency_toman')}`,
        },
        sections: [
          {
            emoji: '👛',
            title: t(ctx, 'wallet_dashboard_title'),
            fields: [
              {
                emoji: '💰',
                label: t(ctx, 'wallet_available_balance'),
                value: `${localizedNumber(result.balanceAfter, ctx)} ${t(ctx, 'currency_toman')}`,
              },
              {
                emoji: '🎯',
                label: t(ctx, 'wheel_spins_left_label'),
                value: `${localizedNumber(result.spinsRemaining, ctx)}`,
              },
            ],
          },
        ],
      });

      const keyboard = new InlineKeyboard().text(t(ctx, 'menu_back_main'), 'nav:main');

      if (chatId && messageId) {
        await ctx.api.editMessageText(chatId, messageId, winScreen, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      } else {
        await renderScreen(ctx, winScreen, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      }
    } catch (error: any) {
      logger.error({ error, telegramId }, 'Failed to spin lucky wheel');
      const errCode = error?.message;
      if (
        errCode === 'COOLDOWN_ACTIVE' ||
        errCode === 'MAX_SPINS_REACHED' ||
        errCode === 'LUCKY_WHEEL_DISABLED'
      ) {
        await renderLuckyWheelScreen(ctx);
      } else {
        await ctx.answerCallbackQuery({
          text: t(ctx, 'wheel_error'),
          show_alert: true,
        });
      }
    }
  });
}
