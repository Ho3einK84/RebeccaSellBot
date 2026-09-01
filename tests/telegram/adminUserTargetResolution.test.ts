import { describe, expect, it, vi } from 'vitest';
import { promptAndResolveAdminTargetUser } from '../../src/telegram/conversations/adminConversations/shared.js';
import type { ConversationContext, MyConversation } from '../../src/telegram/types.js';
import type { LocalUserProfile } from '../../src/domain/services/UserService.js';

function createDummyProfile(id: number, username = `user_${id}`): LocalUserProfile {
  return {
    id: `00000000-0000-0000-0000-00000000000${id}`,
    telegramId: id,
    username,
    firstName: `First${id}`,
    lastName: `Last${id}`,
    balance: 100_000,
    reservedBalance: 0,
    isBanned: false,
    hasUsedTrial: false,
    locale: 'fa',
    localeManual: false,
    referrerId: null,
    referralCode: `ref_${id}`,
    registrationSource: 'telegram',
    lastSeenAt: new Date(),
    totalSpend: 50_000,
    activeSubscriptionCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    transactionCount: 2,
    referredUserCount: 0,
    referralBonusEarned: 0,
    cashbackEarned: 0,
  };
}

describe('promptAndResolveAdminTargetUser', () => {
  it('resolves immediately when initialTelegramId is provided and valid', async () => {
    const profile = createDummyProfile(12345);
    const mockFindProfile = vi.fn().mockResolvedValue(profile);

    const fakeCtx = {
      services: {
        userService: {
          findProfile: mockFindProfile,
        },
      },
      session: {},
    } as unknown as ConversationContext;

    const fakeConversation = {
      external: vi.fn((cb) => cb(fakeCtx)),
    } as unknown as MyConversation;

    const result = await promptAndResolveAdminTargetUser(fakeConversation, fakeCtx, {
      titleKey: 'admin_menu_manual_topup',
      subtitleKey: 'admin_target_telegram_id_prompt',
      initialTelegramId: 12345,
    });

    expect(result).toEqual(profile);
    expect(mockFindProfile).toHaveBeenCalledWith('12345');
  });

  it('prompts and resolves directly when search returns single matching candidate', async () => {
    const profile = createDummyProfile(999, 'ali_reza');
    const mockSearchProfiles = vi.fn().mockResolvedValue([profile]);

    const fakeCtx = {
      from: { id: 100 },
      reply: vi.fn().mockResolvedValue({ message_id: 101 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      session: {},
      services: {
        userService: {
          searchProfiles: mockSearchProfiles,
        },
        translationService: {
          get: vi.fn((k: string) => k),
        },
      },
    } as unknown as ConversationContext;

    const fakeConversation = {
      external: vi.fn((cb) => cb(fakeCtx)),
      wait: vi.fn().mockResolvedValue({
        message: { text: '@ali_reza' },
        from: { id: 100 },
        reply: vi.fn().mockResolvedValue({ message_id: 102 }),
        deleteMessage: vi.fn().mockResolvedValue(true),
        session: {},
      }),
    } as unknown as MyConversation;

    const result = await promptAndResolveAdminTargetUser(fakeConversation, fakeCtx, {
      titleKey: 'admin_user_search_button',
      subtitleKey: 'admin_search_subtitle',
    });

    expect(result).toEqual(profile);
    expect(mockSearchProfiles).toHaveBeenCalledWith('@ali_reza', 6);
  });

  it('shows candidate picker and resolves selected candidate when multiple users match', async () => {
    const p1 = createDummyProfile(101, 'user1');
    const p2 = createDummyProfile(102, 'user2');
    const mockSearchProfiles = vi.fn().mockResolvedValue([p1, p2]);

    const fakeCtx = {
      from: { id: 100 },
      reply: vi.fn().mockResolvedValue({ message_id: 201 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      session: {},
      services: {
        userService: {
          searchProfiles: mockSearchProfiles,
        },
        translationService: {
          get: vi.fn((k: string) => k),
        },
      },
    } as unknown as ConversationContext;

    const fakeConversation = {
      external: vi.fn((cb) => cb(fakeCtx)),
      wait: vi
        .fn()
        .mockResolvedValueOnce({
          message: { text: 'user' },
          from: { id: 100 },
          reply: vi.fn().mockResolvedValue({ message_id: 202 }),
          deleteMessage: vi.fn().mockResolvedValue(true),
          session: {},
        })
        .mockResolvedValueOnce({
          callbackQuery: { data: 'target:select:102' },
          from: { id: 100 },
          answerCallbackQuery: vi.fn().mockResolvedValue(true),
          deleteMessage: vi.fn().mockResolvedValue(true),
          session: {},
        }),
    } as unknown as MyConversation;

    const result = await promptAndResolveAdminTargetUser(fakeConversation, fakeCtx, {
      titleKey: 'admin_user_search_button',
      subtitleKey: 'admin_search_subtitle',
    });

    expect(result).toEqual(p2);
  });
});
