import { describe, expect, it, vi } from 'vitest';
import { adminSetBalanceConversation } from '../../src/telegram/conversations/adminConversations.js';
import { isAdminCallbackData } from '../../src/telegram/botRuntime.js';
import type { MenuContext, MyConversation } from '../../src/telegram/types.js';

describe('admin conversation authorization', () => {
  it('recognizes grammY admin submenu callbacks as protected data', () => {
    expect(isAdminCallbackData('admin-menu/0/0//')).toBe(true);
    expect(isAdminCallbackData('admin-daily-menu/0/1//')).toBe(true);
    expect(isAdminCallbackData('admin-sales-menu/1/0//')).toBe(true);
    expect(isAdminCallbackData('admin-panels-menu/0/0//')).toBe(true);
    expect(isAdminCallbackData('admin-system-menu/0/1//')).toBe(true);
    expect(isAdminCallbackData('main-menu/0/0//')).toBe(false);
  });

  it('rejects a direct admin-conversation invocation from an ID outside ADMIN_IDS', async () => {
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const waitFor = vi.fn();
    const external = vi.fn(async (task: (ctx: { session: Record<string, unknown> }) => unknown) =>
      task({ session: {} })
    );
    const ctx = {
      from: { id: 123, is_bot: false, first_name: 'Untrusted' },
      reply,
      services: {
        isAdmin: vi.fn(() => false),
        translationService: {
          resolveLocale: vi.fn(() => 'fa'),
          get: vi.fn((key: string) => key),
        },
      },
    } as unknown as MenuContext;

    await adminSetBalanceConversation({ waitFor, external } as unknown as MyConversation, ctx);

    expect(ctx.services?.isAdmin).toHaveBeenCalledWith(123);
    expect(reply).toHaveBeenCalledWith('admin_access_denied', expect.any(Object));
    expect(waitFor).not.toHaveBeenCalled();
  });
});
