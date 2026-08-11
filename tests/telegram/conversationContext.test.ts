import { describe, expect, it, vi } from 'vitest';
import { conversationContextMiddleware } from '../../src/telegram/bot.js';
import { topupConversation } from '../../src/telegram/conversations/adminConversations.js';
import type { BotServices, ConversationContext } from '../../src/telegram/types.js';
import type { MyConversation } from '../../src/telegram/types.js';

describe('conversation context hydration', () => {
  it('reinjects services and the saved locale into fresh conversation contexts', async () => {
    const services = {
      userService: {
        getLocale: vi.fn().mockResolvedValue('fa'),
      },
      translationService: {
        resolveLocale: vi.fn((locale?: string) => (locale?.startsWith('en') ? 'en' : 'fa')),
      },
    } as unknown as BotServices;
    const ctx = {
      from: {
        id: 123,
        is_bot: false,
        first_name: 'Test',
        language_code: 'en-US',
      },
    } as ConversationContext;
    const next = vi.fn().mockResolvedValue(undefined);

    await conversationContextMiddleware(services)(ctx, next);

    expect(ctx.services).toBe(services);
    expect(ctx.userLocale).toBe('fa');
    expect(next).toHaveBeenCalledOnce();
  });

  it('lets a hydrated top-up conversation prompt, submit a receipt, and notify admins', async () => {
    const submitTopupReceipt = vi.fn().mockResolvedValue('rec_test_1');
    const sendPhoto = vi.fn().mockResolvedValue({ message_id: 99 });
    const services = {
      userService: {
        getLocale: vi.fn().mockResolvedValue('fa'),
      },
      walletService: { submitTopupReceipt },
      translationService: {
        resolveLocale: vi.fn(() => 'fa'),
        get: vi.fn((key: string) => key),
        getSetting: vi.fn((_key: string, fallback: string) => fallback),
        getSettingNum: vi.fn((key: string, fallback: number) => fallback),
      },
      adminIds: [999],
    } as unknown as BotServices;
    let messageId = 0;
    const reply = vi.fn().mockImplementation(async () => ({ message_id: ++messageId }));
    const ctx = {
      from: { id: 123, is_bot: false, first_name: 'Test', language_code: 'en-US' },
      reply,
      api: { sendPhoto },
    } as unknown as ConversationContext;
    const wait = vi
      .fn()
      .mockResolvedValueOnce({ message: { text: '100000' } })
      .mockResolvedValueOnce({ message: { photo: [{ file_id: 'receipt-file-id' }] } })
      .mockResolvedValueOnce({
        callbackQuery: { data: 'topup:confirm' },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      });
    const outsideCtx = { session: {} };
    const external = vi.fn(async (task: (ctx: typeof outsideCtx) => unknown) => task(outsideCtx));

    await conversationContextMiddleware(services)(ctx, async () => {
      await topupConversation({ wait, external } as unknown as MyConversation, ctx);
    });

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('topup_choose_amount_hint'),
      expect.any(Object)
    );
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('topup_receipt_title'),
      expect.any(Object)
    );
    expect(submitTopupReceipt).toHaveBeenCalledWith(123, 100000, 'receipt-file-id');
    expect(sendPhoto).toHaveBeenCalledWith(999, 'receipt-file-id', expect.any(Object));
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('topup_success_title'),
      expect.any(Object)
    );
  });
});
