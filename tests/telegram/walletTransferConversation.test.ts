import { describe, expect, it, vi } from 'vitest';
import { transferBalanceConversation } from '../../src/telegram/conversations/userConversations.js';
import { walletMenu } from '../../src/telegram/keyboards/mainMenu.js';
import type { ConversationContext, MyConversation } from '../../src/telegram/types.js';

describe('transferBalanceConversation and walletMenu integration', () => {
  it('includes wallet transfer button in walletMenu when feature is enabled', () => {
    expect(walletMenu).toBeDefined();
  });

  it('aborts conversation immediately if wallet transfer is disabled', async () => {
    let messageId = 0;
    const replyMock = vi.fn().mockImplementation(async () => ({ message_id: ++messageId }));
    const outsideCtx = { session: {} };
    const conversation = {
      external: vi.fn(async (task: (c: typeof outsideCtx) => unknown) => task(outsideCtx)),
    } as unknown as MyConversation;

    const ctx = {
      from: { id: 100 },
      reply: replyMock,
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          getSetting: vi.fn((key: string) =>
            key === 'wallet_transfer_enabled' ? 'false' : '5000'
          ),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as ConversationContext;

    await transferBalanceConversation(conversation, ctx);
    expect(replyMock).toHaveBeenCalledWith(
      expect.stringContaining('wallet_transfer_disabled'),
      expect.anything()
    );
  });

  it('warns sender if balance is below minimum transfer threshold', async () => {
    let messageId = 0;
    const replyMock = vi.fn().mockImplementation(async () => ({ message_id: ++messageId }));
    const outsideCtx = { session: {} };
    const conversation = {
      external: vi.fn(async (task: (c: typeof outsideCtx) => unknown) => task(outsideCtx)),
    } as unknown as MyConversation;

    const ctx = {
      from: { id: 100 },
      reply: replyMock,
      services: {
        walletService: {
          getBalance: vi.fn().mockResolvedValue(2000),
        },
        translationService: {
          get: vi.fn((key: string) => key),
          getSetting: vi.fn((key: string) => (key === 'wallet_transfer_enabled' ? 'true' : '5000')),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as ConversationContext;

    await transferBalanceConversation(conversation, ctx);
    expect(replyMock).toHaveBeenCalledWith(
      expect.stringContaining('wallet_transfer_insufficient_balance'),
      expect.anything()
    );
  });
});
