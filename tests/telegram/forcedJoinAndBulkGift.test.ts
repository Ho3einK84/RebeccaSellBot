import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForcedJoinService } from '../../src/domain/services/ForcedJoinService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { BulkGiftService } from '../../src/domain/services/BulkGiftService.js';
import {
  attachAdminRouter,
  clearRegisteredAdminRoutes,
} from '../../src/telegram/admin/adminRouter.js';
import { registerAdminHomeRoutes } from '../../src/telegram/admin/adminHome.js';
import { registerAdminForcedJoinRoutes } from '../../src/telegram/admin/adminForcedJoinRoutes.js';
import { registerAdminBulkGiftRoutes } from '../../src/telegram/features/admin/bulkGiftRoutes.js';
import {
  extractStartPayload,
  forcedJoinGlobalMiddleware,
} from '../../src/telegram/middleware/forcedJoin.js';
import { registerBaseRoutes } from '../../src/telegram/features/baseRoutes.js';
import { registerPurchaseRoutes } from '../../src/telegram/features/purchaseRoutes.js';
import {
  createBotHarness,
  createMockServices,
  createMockTranslationService,
  extractCallbackDataList,
} from './helpers/botHarness.js';

describe('Telegram Forced Join & Bulk Gift flows', () => {
  beforeEach(() => {
    clearRegisteredAdminRoutes();
  });

  it('extracts /start payloads accurately', () => {
    expect(extractStartPayload('/start ref_ABC123')).toBe('ref_ABC123');
    expect(extractStartPayload('/start@mybot ref_XYZ')).toBe('ref_XYZ');
    expect(extractStartPayload('/start')).toBeUndefined();
    expect(extractStartPayload('hello')).toBeUndefined();
  });

  it('preserves /start ref_... referral code across the forced-join lock screen until user joins and re-checks', async () => {
    const ts = createMockTranslationService({
      locale: 'en',
      settings: { forced_join_scope: 'all' },
    });
    let joined = false;
    const getChatMember = vi.fn(async () => ({ status: joined ? 'member' : 'left' }));
    const forcedJoinService = new ForcedJoinService({
      translationService: ts as unknown as TranslationService,
      getAdapter: () => ({ getChatMember }),
      isAdmin: (id) => id === 1,
    });
    await forcedJoinService.addChannel({
      channelId: '@official_news',
      title: 'Official News',
    });

    const getOrCreateUser = vi.fn(async (telegramId: number) => ({
      telegramId,
      locale: 'en' as const,
      localeManual: false,
      isBanned: false,
      balance: 0,
      reservedBalance: 0,
      totalSpend: 0,
    }));

    const services = createMockServices({
      adminIds: [1],
      translationService: ts,
      forcedJoinService,
      walletService: { getOrCreateUser },
    });

    const harness = createBotHarness({ services });
    harness.bot.use(forcedJoinGlobalMiddleware(services));
    registerBaseRoutes(harness.bot, services);

    // 1. New user sends /start ref_REF777 while not in channel -> blocked with forced-join gate
    await harness.sendText('/start ref_REF777', { userId: 505 });
    expect(getOrCreateUser).not.toHaveBeenCalled();
    const sentMessages = harness.callsFor('sendMessage');
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    const gateCallbacks = extractCallbackDataList(
      sentMessages[sentMessages.length - 1]?.payload.reply_markup
    );
    expect(gateCallbacks).toContain('fj:check');

    // 2. User taps re-check BEFORE joining -> still blocked
    await harness.sendCallback('fj:check', { userId: 505 });
    expect(getOrCreateUser).not.toHaveBeenCalled();

    // 3. User joins channel and taps re-check -> cache cleared, membership verified, referral preserved!
    joined = true;
    await harness.sendCallback('fj:check', { userId: 505 });
    expect(getOrCreateUser).toHaveBeenCalledTimes(1);
    expect(getOrCreateUser.mock.calls[0]?.[0]).toBe(505);
    expect(getOrCreateUser.mock.calls[0]?.[4]).toBe('ref_REF777');
  });

  it('enforces trial_only scope on trial:claim and purchase_and_trial scope on new purchase without blocking admins', async () => {
    const ts = createMockTranslationService({
      locale: 'en',
      settings: { forced_join_scope: 'trial_only' },
    });
    const getChatMember = vi.fn(async () => ({ status: 'left' }));
    const forcedJoinService = new ForcedJoinService({
      translationService: ts as unknown as TranslationService,
      getAdapter: () => ({ getChatMember }),
      isAdmin: (id) => id === 1,
    });
    await forcedJoinService.addChannel({ channelId: '@news_gate', title: 'News' });

    const claimTrial = vi.fn(async () => ({ success: true, subUrl: 'https://sub.example/u' }));
    const services = createMockServices({
      adminIds: [1],
      translationService: ts,
      forcedJoinService,
      trialService: { claimTrial },
      contactVerificationService: {
        shouldRequirePhoneForTrial: vi.fn(async () => false),
      },
      panelRegistry: {
        resolveTarget: vi.fn(async () => ({ panelId: 'p1', serviceId: 1 })),
      },
      configService: {
        generateConfigName: vi.fn(async () => 'trial_1'),
      },
    });

    const harness = createBotHarness({ services });
    harness.bot.use(forcedJoinGlobalMiddleware(services));
    registerBaseRoutes(harness.bot, services);
    registerPurchaseRoutes(harness.bot, services);

    // Normal user blocked on trial:claim under trial_only
    await harness.sendCallback('trial:claim', { userId: 202 });
    expect(claimTrial).not.toHaveBeenCalled();
    const msg = harness.callsFor('editMessageText')[0] ?? harness.callsFor('sendMessage')[0];
    expect(extractCallbackDataList(msg?.payload.reply_markup)).toContain('fj:check');

    // Admin bypasses forced join completely
    await harness.sendCallback('trial:claim', { userId: 1 });
    expect(claimTrial).toHaveBeenCalledTimes(1);
  });

  it('renders admin Forced Join and Bulk Gift Telegram routes with valid compact callbacks', async () => {
    const ts = createMockTranslationService({
      locale: 'en',
      settings: { forced_join_scope: 'off' },
    });
    const forcedJoinService = new ForcedJoinService({
      translationService: ts as unknown as TranslationService,
      isAdmin: (id) => id === 1,
    });
    const mockBulkGiftService = {
      listRecentJobs: vi.fn(async () => ({
        items: [],
        total: 0,
        page: 1,
        totalPages: 1,
        activeCount: 0,
      })),
      previewTargets: vi.fn(async () => ({ configCount: 12, userCount: 9 })),
    } as unknown as BulkGiftService;

    const services = createMockServices({
      adminIds: [1],
      isAdmin: vi.fn((id) => id === 1),
      translationService: ts,
      forcedJoinService,
      bulkGiftService: mockBulkGiftService,
    });

    const harness = createBotHarness({ services });
    registerAdminHomeRoutes();
    registerAdminForcedJoinRoutes();
    registerAdminBulkGiftRoutes();
    attachAdminRouter(harness.bot);

    // Open Forced Join hub and switch scope to purchase_and_trial
    await harness.sendCallback('adm:cfg:fj', { userId: 1 });
    const fjMarkup = (harness.callsFor('editMessageText')[0] ?? harness.callsFor('sendMessage')[0])
      ?.payload.reply_markup;
    const fjCallbacks = extractCallbackDataList(fjMarkup);
    expect(fjCallbacks).toContain('adm:fj:sc:purchase_and_trial');
    expect(fjCallbacks).toContain('adm:fj:add');
    for (const cb of fjCallbacks) {
      expect(Buffer.byteLength(cb, 'utf8')).toBeLessThanOrEqual(64);
    }

    await harness.sendCallback('adm:fj:sc:purchase_and_trial', { userId: 1 });
    expect(forcedJoinService.getScope()).toBe('purchase_and_trial');

    // Open Bulk Gift hub and new builder screen
    await harness.sendCallback('adm:msg:gift', { userId: 1 });
    await harness.sendCallback('adm:gift:new', { userId: 1 });
    expect(mockBulkGiftService.previewTargets).toHaveBeenCalled();

    const allEditCalls = harness.callsFor('editMessageText');
    const lastBuilderMarkup = allEditCalls[allEditCalls.length - 1]?.payload.reply_markup;
    const giftCallbacks = extractCallbackDataList(lastBuilderMarkup);
    expect(giftCallbacks).toContain('adm:gift:ed:gb');
    expect(giftCallbacks).toContain('adm:gift:ed:days');
    expect(giftCallbacks).toContain('adm:gift:confirm');
    for (const cb of giftCallbacks) {
      expect(Buffer.byteLength(cb, 'utf8')).toBeLessThanOrEqual(64);
    }
  });
});
