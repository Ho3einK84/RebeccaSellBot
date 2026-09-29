import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Bot } from 'grammy';
import type { MenuContext, BotServices } from '../../src/telegram/types.js';
import { registerBaseRoutes } from '../../src/telegram/features/baseRoutes.js';

describe('Bot /start service deep links (renew_, transfer_, delete_)', () => {
  let startHandler: ((ctx: any) => Promise<void>) | undefined;
  let mockServices: any;
  let mockBot: any;

  beforeEach(() => {
    startHandler = undefined;
    mockBot = {
      use: vi.fn(),
      command: vi.fn((cmd: string, handler: (ctx: any) => Promise<void>) => {
        if (cmd === 'start') startHandler = handler;
      }),
      callbackQuery: vi.fn(),
    } as unknown as Bot<MenuContext>;

    mockServices = {
      userService: {
        exists: vi.fn().mockResolvedValue(true),
      },
      walletService: {
        getOrCreateUser: vi.fn().mockResolvedValue({
          id: 1,
          telegramId: 12345,
          locale: 'fa',
          localeManual: true,
        }),
      },
      configService: {
        getOwnedConfigById: vi.fn(async (telegramId: number, configId: string) => {
          if (telegramId === 12345 && configId === 'cfg_test_1') {
            return {
              id: 'cfg_test_1',
              telegramId: 12345,
              configUsername: 'u12345_srv1',
              panelId: 'panel_1',
              serviceId: 1,
            };
          }
          return undefined;
        }),
      },
      pricingService: {
        getPackages: vi.fn(() => [
          { id: 'pkg_1', name: 'Plan 1', gbAmount: 10, durationDays: 30, price: 50000 },
        ]),
      },
      refundService: {
        quote: vi.fn(async (_telegramId: number, configId: string) => ({
          eligible: true,
          grossAmount: 50000,
          cashbackWithheld: 0,
          refundAmount: 35000,
        })),
      },
      translationService: {
        getDefaultLocale: vi.fn(() => 'fa'),
        getSetting: vi.fn((_key: string, fallback: any) => fallback),
        getSettingBool: vi.fn(() => false),
        getSettingNum: vi.fn(() => 5000),
        get: vi.fn((key: string) => key),
        resolveLocale: vi.fn(() => 'fa'),
      },
      isAdmin: vi.fn(() => false),
    } as unknown as BotServices;

    registerBaseRoutes(mockBot, mockServices);
  });

  it('handles renew_<configId> deep link for owned config', async () => {
    const editMessageText = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 101 });
    const ctx: any = {
      from: { id: 12345, first_name: 'TestUser' },
      chat: { id: 12345, type: 'private' },
      match: 'renew_cfg_test_1',
      services: mockServices,
      reply,
      editMessageText,
      session: {},
    };

    await startHandler!(ctx);

    expect(mockServices.configService.getOwnedConfigById).toHaveBeenCalledWith(12345, 'cfg_test_1');
    expect(reply).toHaveBeenCalled();
  });

  it('shows not-owned error when renew_<configId> is not owned', async () => {
    const reply = vi.fn().mockResolvedValue({ message_id: 102 });
    const ctx: any = {
      from: { id: 12345, first_name: 'TestUser' },
      chat: { id: 12345, type: 'private' },
      match: 'renew_cfg_other',
      services: mockServices,
      reply,
      session: {},
    };

    await startHandler!(ctx);

    expect(mockServices.configService.getOwnedConfigById).toHaveBeenCalledWith(12345, 'cfg_other');
    expect(reply).toHaveBeenCalled();
  });

  it('handles transfer_<configId> deep link by setting session and entering conversation', async () => {
    const enterConversation = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 103 });
    const ctx: any = {
      from: { id: 12345, first_name: 'TestUser' },
      chat: { id: 12345, type: 'private' },
      match: 'transfer_cfg_test_1',
      services: mockServices,
      reply,
      session: {},
      conversation: {
        enter: enterConversation,
      },
    };

    await startHandler!(ctx);

    expect(mockServices.configService.getOwnedConfigById).toHaveBeenCalledWith(12345, 'cfg_test_1');
    expect(ctx.session.transferConfigId).toBe('cfg_test_1');
    expect(ctx.session.transferConfigOwnerTelegramId).toBe(12345);
    expect(enterConversation).toHaveBeenCalledWith('transferConfigConversation');
  });

  it('shows not-owned error when transfer_<configId> is not owned', async () => {
    const enterConversation = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 104 });
    const ctx: any = {
      from: { id: 12345, first_name: 'TestUser' },
      chat: { id: 12345, type: 'private' },
      match: 'transfer_cfg_other',
      services: mockServices,
      reply,
      session: {},
      conversation: {
        enter: enterConversation,
      },
    };

    await startHandler!(ctx);

    expect(mockServices.configService.getOwnedConfigById).toHaveBeenCalledWith(12345, 'cfg_other');
    expect(enterConversation).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalled();
  });

  it('handles delete_<configId> deep link by quoting refund and rendering delete screen', async () => {
    const reply = vi.fn().mockResolvedValue({ message_id: 105 });
    const ctx: any = {
      from: { id: 12345, first_name: 'TestUser' },
      chat: { id: 12345, type: 'private' },
      match: 'delete_cfg_test_1',
      services: mockServices,
      reply,
      session: {},
    };

    await startHandler!(ctx);

    expect(mockServices.configService.getOwnedConfigById).toHaveBeenCalledWith(12345, 'cfg_test_1');
    expect(mockServices.refundService.quote).toHaveBeenCalledWith(12345, 'cfg_test_1');
    expect(reply).toHaveBeenCalled();
  });

  it('shows not-owned error when delete_<configId> is not owned', async () => {
    const reply = vi.fn().mockResolvedValue({ message_id: 106 });
    const ctx: any = {
      from: { id: 12345, first_name: 'TestUser' },
      chat: { id: 12345, type: 'private' },
      match: 'delete_cfg_other',
      services: mockServices,
      reply,
      session: {},
    };

    await startHandler!(ctx);

    expect(mockServices.configService.getOwnedConfigById).toHaveBeenCalledWith(12345, 'cfg_other');
    expect(mockServices.refundService.quote).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalled();
  });
});
