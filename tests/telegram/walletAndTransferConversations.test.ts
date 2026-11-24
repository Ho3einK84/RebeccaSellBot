import { describe, expect, it, vi } from 'vitest';
import {
  buildTopupPresets,
  formatCardNumberGrouped,
  topupConversation,
} from '../../src/telegram/conversations/adminConversations/wallet.js';
import {
  transferBalanceConversation,
  transferConfigConversation,
} from '../../src/telegram/conversations/userConversations.js';
import type { ConversationContext, MyConversation } from '../../src/telegram/types.js';
import { createMockServices } from './helpers/botHarness.js';
import { createConversationHarness } from './helpers/conversationHarness.js';

describe('Topup helpers & hydrated conversation', () => {
  it('formats 16-digit card numbers as clean contiguous digits for tap-to-copy mono spans and builds bounded presets', () => {
    expect(formatCardNumberGrouped('6037991812345678')).toBe('6037991812345678');
    expect(formatCardNumberGrouped('6037-9918-1234-5678')).toBe('6037991812345678');
    expect(formatCardNumberGrouped('۶۰۳۷-۹۹۱۸-۱۲۳۴-۵۶۷۸')).toBe('6037991812345678');
    expect(formatCardNumberGrouped('12345')).toBe('12345');

    expect(buildTopupPresets(10_000, 10_000_000)).toEqual([50_000, 100_000, 200_000, 500_000]);
    expect(buildTopupPresets(100_000, 1_000_000)).toEqual([100_000, 200_000, 500_000]);
    expect(buildTopupPresets(50_000, 60_000)).toEqual([50_000]);
  });

  it('completes multi-turn topup conversation via real @grammyjs/conversations runtime', async () => {
    const submitTopupReceipt = vi.fn().mockResolvedValue('rec_live_1');
    const services = createMockServices({
      adminIds: [999],
      walletService: { submitTopupReceipt },
      translationService: {
        getSetting: vi.fn((k: string, fb: string) =>
          k === 'card_number' ? '6037997900000000' : fb
        ),
        getSettingNum: vi.fn((_k: string, fb: number) => fb),
      },
    });
    const harness = createConversationHarness({
      services,
      defaultLocale: 'fa',
      conversations: [['topupConversation', topupConversation]],
    });
    harness.bot.command('topup', async (ctx) => {
      await ctx.conversation.enter('topupConversation');
    });

    await harness.sendText('/topup', { userId: 6_698_253_699 });
    const firstMsgText = String(harness.callsFor('sendMessage')[0]?.payload.text);
    expect(firstMsgText).toContain('topup_choose_amount_hint');
    expect(firstMsgText).toContain('`6037997900000000`');
    const cardLine = firstMsgText.split('\n').find((line) => line.includes('6037997900000000'));
    expect(cardLine).toContain('`6037997900000000`');
    expect(cardLine).not.toContain('\u200E');

    await harness.sendText('100000', { userId: 6_698_253_699 });
    expect(String(harness.callsFor('sendMessage').at(-1)?.payload.text)).toContain(
      'topup_receipt_title'
    );

    await harness.sendPhoto('receipt-file-id', { userId: 6_698_253_699 });
    expect(harness.callsFor('sendPhoto')[0]?.payload).toMatchObject({
      photo: 'receipt-file-id',
      caption: expect.stringContaining('topup_review_title'),
      parse_mode: 'Markdown',
    });

    await harness.sendCallback('topup:confirm', { userId: 6_698_253_699, isCaptionMessage: true });
    expect(submitTopupReceipt).toHaveBeenCalledWith(
      6_698_253_699,
      100_000,
      'receipt-file-id',
      'photo'
    );
    const adminPhoto = harness.callsFor('sendPhoto').find((c) => c.payload.chat_id === 999);
    expect(String(adminPhoto?.payload.caption)).toContain('6698253699');
    expect(String(adminPhoto?.payload.caption)).not.toContain('۶٬۶۹۸٬۲۵۳٬۶۹۹');
  });

  it('suggests exact shortfall amount as first quick button in topupConversation when pendingTopupIntent is fresh', async () => {
    const services = createMockServices({
      translationService: {
        get: vi.fn((key: string) => key),
        getSetting: vi.fn((_k: string, fb: string) => fb),
        getSettingNum: vi.fn((_k: string, fb: number) => fb),
      },
    });
    const harness = createConversationHarness({
      services,
      defaultLocale: 'en',
      initialSession: {
        '777:777': {
          pendingTopupIntent: {
            kind: 'new_config',
            packageId: 'pkg_1',
            deficitAmount: 35_000,
            createdAt: Date.now(),
          },
        },
      },
      conversations: [['topupConversation', topupConversation]],
    });
    harness.bot.command('topup', async (ctx) => {
      await ctx.conversation.enter('topupConversation');
    });

    await harness.sendText('/topup', { userId: 777 });
    const firstMsg = harness.callsFor('sendMessage')[0]?.payload;
    const rows = (
      firstMsg?.reply_markup as {
        inline_keyboard: Array<Array<{ text: string; callback_data?: string }>>;
      }
    ).inline_keyboard;
    expect(rows[0]?.[0]?.callback_data).toBe('amount:35000');
    expect(rows[0]?.[0]?.text).toContain('topup_exact_deficit_button');
  });
});

describe('transferBalanceConversation & transferConfigConversation', () => {
  it('aborts when wallet transfer is disabled and rejects sender below minimum available balance', async () => {
    const disabledServices = createMockServices({
      translationService: {
        getSetting: vi.fn((k: string) => (k === 'wallet_transfer_enabled' ? 'false' : '5000')),
      },
    });
    const replyDisabled = vi.fn().mockResolvedValue({ message_id: 1 });
    await transferBalanceConversation(
      { external: vi.fn(async (t) => t({ session: {} })) } as unknown as MyConversation,
      {
        from: { id: 100 },
        reply: replyDisabled,
        services: disabledServices,
      } as unknown as ConversationContext
    );
    expect(replyDisabled).toHaveBeenCalledWith(
      expect.stringContaining('wallet_transfer_disabled'),
      expect.anything()
    );

    const lowBalServices = createMockServices({
      walletService: {
        getBalance: vi.fn().mockResolvedValue(2000),
        getAvailableBalance: undefined,
      },
      translationService: {
        getSetting: vi.fn((k: string) => (k === 'wallet_transfer_enabled' ? 'true' : '5000')),
      },
    });
    const replyLow = vi.fn().mockResolvedValue({ message_id: 2 });
    await transferBalanceConversation(
      { external: vi.fn(async (t) => t({ session: {} })) } as unknown as MyConversation,
      {
        from: { id: 100 },
        reply: replyLow,
        services: lowBalServices,
      } as unknown as ConversationContext
    );
    expect(replyLow).toHaveBeenCalledWith(
      expect.stringContaining('wallet_transfer_insufficient_balance'),
      expect.anything()
    );
  });

  it('uses getAvailableBalance over getBalance when checking reserved funds', async () => {
    const harness = createConversationHarness({
      defaultLocale: 'fa',
      conversations: [['transferBalanceConversation', transferBalanceConversation]],
      services: createMockServices({
        walletService: {
          getBalance: vi.fn().mockResolvedValue(100_000),
          getAvailableBalance: vi.fn().mockResolvedValue(2_000),
        },
        translationService: {
          getSetting: vi.fn((k: string) => (k === 'wallet_transfer_enabled' ? 'true' : '5000')),
        },
      }),
    });
    harness.bot.command('tbal', async (ctx) => {
      await ctx.conversation.enter('transferBalanceConversation');
    });

    await harness.sendText('/tbal', { userId: 100 });
    expect(harness.services.walletService.getAvailableBalance).toHaveBeenCalledWith(100);
    expect(String(harness.callsFor('sendMessage')[0]?.payload.text)).toContain(
      'wallet_transfer_insufficient_balance'
    );
  });

  it('renders target Telegram ID in ASCII digits without commas and executes config transfer in external()', async () => {
    const prompts: string[] = [];
    const replyMock = vi.fn().mockImplementation(async (text: string) => {
      prompts.push(text);
      return { message_id: prompts.length };
    });
    let step = 0;
    const services = createMockServices({
      walletService: { getAvailableBalance: vi.fn().mockResolvedValue(100_000) },
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
        getSetting: vi.fn((k: string) => (k === 'wallet_transfer_enabled' ? 'true' : '5000')),
      },
    });
    const conv = {
      external: vi.fn(async (t) => t({ from: { id: 100 }, session: {} })),
      wait: vi.fn(async () => {
        step += 1;
        return step === 1
          ? ({
              from: { id: 100 },
              message: { text: '8952385122' },
              reply: replyMock,
              session: {},
            } as never)
          : ({
              from: { id: 100 },
              callbackQuery: { data: 'conversation:cancel' },
              answerCallbackQuery: vi.fn().mockResolvedValue(true),
              reply: replyMock,
              session: {},
              services,
            } as never);
      }),
    } as unknown as MyConversation;

    await transferBalanceConversation(conv, {
      from: { id: 100 },
      reply: replyMock,
      services,
    } as unknown as ConversationContext);

    const amountPrompt = prompts.find((p) => p.includes('8952385122'));
    expect(amountPrompt).toContain('`8952385122`');
    expect(amountPrompt).not.toContain('۸٬۹۵۲٬۳۸۵٬۱۲۲');
    expect(amountPrompt).not.toContain('8,952,385,122');

    // Real multi-turn transferConfigConversation
    const transfer = vi
      .fn()
      .mockResolvedValue({ configUsername: 'alice_vpn', fromTelegramId: 100, toTelegramId: 200 });
    const cfgHarness = createConversationHarness({
      services: createMockServices({
        configService: {
          getOwnedConfigById: vi.fn().mockResolvedValue({
            id: 'cfg_tr_1',
            telegramId: 100,
            configUsername: 'alice_vpn',
          }),
        },
        userService: {
          findProfile: vi
            .fn()
            .mockResolvedValue({ telegramId: 200, firstName: 'Bob', username: 'bob' }),
        },
        configTransferService: { transfer },
      }),
      initialSession: {
        '100:100': { transferConfigId: 'cfg_tr_1', transferConfigOwnerTelegramId: 100 },
      },
      conversations: [['transferConfigConversation', transferConfigConversation]],
    });
    cfgHarness.bot.command('tcfg', async (ctx) => {
      await ctx.conversation.enter('transferConfigConversation');
    });

    await cfgHarness.sendText('/tcfg', { userId: 100 });
    await cfgHarness.sendText('200', { userId: 100 });
    await cfgHarness.sendCallback('transfer_confirm', { userId: 100 });
    expect(transfer).toHaveBeenCalledWith({
      configId: 'cfg_tr_1',
      fromTelegramId: 100,
      toTelegramId: 200,
      actorTelegramId: 100,
      allowAdminOverride: false,
    });
  });
});
