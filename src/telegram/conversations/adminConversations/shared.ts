import type { ConversationContext, MyConversation } from '../../types.js';
import { normalizeInputDigits, t } from '../../locale.js';
import { replyInAdminConversation } from '../../ui.js';

export function parsePositiveSafeInteger(value: string): number | undefined {
  const trimmed = normalizeInputDigits(value);
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseNonnegativeSafeInteger(value: string): number | undefined {
  const trimmed = normalizeInputDigits(value);
  if (!/^\d+$/u.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export async function requireAdmin(
  conversation: MyConversation,
  ctx: ConversationContext
): Promise<number | undefined> {
  const telegramId = ctx.from?.id;
  if (telegramId && ctx.services?.isAdmin(telegramId)) return telegramId;
  if (ctx.services) {
    await replyInAdminConversation(conversation, ctx, t(ctx, 'admin_access_denied'));
  }
  return undefined;
}
