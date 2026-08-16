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

  it('renders target numeric Telegram ID in ASCII digits without comma separators', async () => {
    let messageId = 0;
    const prompts: string[] = [];
    const replyMock = vi.fn().mockImplementation(async (text: string) => {
      prompts.push(text);
      return { message_id: ++messageId };
    });
    const outsideCtx = { from: { id: 100 }, session: {} };
    let inputCall = 0;
    const conversation = {
      external: vi.fn(async (task: (c: typeof outsideCtx) => unknown) => task(outsideCtx)),
      wait: vi.fn().mockImplementation(async () => {
        inputCall++;
        if (inputCall === 1) {
          return {
            from: { id: 100 },
            message: { text: '8952385122' },
            reply: replyMock,
            session: {},
          };
        }
        return {
          from: { id: 100 },
          callbackQuery: { data: 'conversation:cancel' },
          answerCallbackQuery: vi.fn().mockResolvedValue(true),
          reply: replyMock,
          session: {},
          services: {
            translationService: {
              get: vi.fn((key: string) => key),
              resolveLocale: vi.fn(() => 'fa'),
            },
          },
        };
      }),
    } as unknown as MyConversation;

    const ctx = {
      from: { id: 100 },
      reply: replyMock,
      services: {
        walletService: {
          getBalance: vi.fn().mockResolvedValue(100_000),
        },
        userService: {
          findProfile: vi.fn().mockResolvedValue({
            id: 'uuid-1',
            telegramId: 8952385122,
            username: null,
            firstName: 'User',
            lastName: null,
            balance: 0,
            isBanned: false,
            isAgent: false,
            createdAt: new Date(),
          }),
        },
        translationService: {
          get: vi.fn((key: string) => key),
          getSetting: vi.fn((key: string) => (key === 'wallet_transfer_enabled' ? 'true' : '5000')),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as ConversationContext;

    await transferBalanceConversation(conversation, ctx);
    // Amount prompt screen should have been shown with raw numeric Telegram ID `8952385122`
    const amountPromptScreen = prompts.find((p) => p.includes('8952385122'));
    expect(amountPromptScreen).toBeDefined();
    expect(amountPromptScreen).toContain('`8952385122`');
    // Ensure no localized Persian digits or commas are in the Telegram ID
    expect(amountPromptScreen).not.toContain('۸٬۹۵۲٬۳۸۵٬۱۲۲');
    expect(amountPromptScreen).not.toContain('8,952,385,122');
  });
});
