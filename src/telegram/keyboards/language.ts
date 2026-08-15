import { InlineKeyboard } from 'grammy';
import type { ConversationContext } from '../types.js';
import { t } from '../locale.js';

/** Shared language picker for customer and administrator menus. */
export function languageKeyboard(
  ctx: ConversationContext,
  destination: 'main' | 'admin' = 'main'
): InlineKeyboard {
  return new InlineKeyboard()
    .text('🦁 فارسی', 'locale:fa')
    .text('🇬🇧 English', 'locale:en')
    .row()
    .text(t(ctx, 'menu_back'), `nav:${destination}`);
}
