import { InlineKeyboard } from 'grammy';
import {
  resolveRegistrationBlockedCopy,
  type RegistrationBlockReason,
} from '../domain/services/RegistrationPolicy.js';
import { resolveSupportDestination } from '../domain/services/SupportDestination.js';
import { resolveContextLocale } from './locale.js';
import { buildUserEmptyState } from './ui.js';
import type { BotServices, MenuContext } from './types.js';

/**
 * Reply safely to an unregistered visitor whose registration is blocked by
 * `registration_mode` (`closed` or `invite_only`) without creating a DB user.
 */
export async function renderRegistrationBlockedReply(
  ctx: MenuContext,
  services: BotServices,
  reason: RegistrationBlockReason
): Promise<void> {
  const locale = ctx.userLocale ?? resolveContextLocale(ctx);
  const copy = resolveRegistrationBlockedCopy(services.translationService, locale, reason);

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: copy.alert, show_alert: true }).catch(() => {});
    return;
  }

  const supportEnabled = services.translationService.getSettingBool('support_enabled', true);
  let keyboard: InlineKeyboard | undefined;
  if (supportEnabled) {
    const dest = resolveSupportDestination({
      rawDestination: services.translationService.getSetting('support_destination', ''),
      supportUrl: services.supportUrl,
      fallbackAdminId: services.adminIds?.[0],
    });
    if (dest.url) {
      keyboard = new InlineKeyboard().url(
        services.translationService.get('menu_support', locale),
        dest.url
      );
    }
  }

  await ctx.reply(buildUserEmptyState('🔒', copy.title, copy.message), {
    parse_mode: 'Markdown',
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}
