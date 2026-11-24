import { describe, expect, it, vi } from 'vitest';
import {
  ForcedJoinError,
  ForcedJoinService,
  MAX_FORCED_JOIN_CHANNELS,
  doesForcedJoinScopeApply,
  isChatMemberJoined,
  normalizeForcedJoinChannelId,
  normalizeForcedJoinInviteLink,
  type ForcedJoinTelegramAdapter,
} from '../../src/domain/services/ForcedJoinService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { CONFIGURATION_DEFAULTS } from '../../src/domain/services/TranslationCatalog.js';

function createMemoryTranslationService(initial: Record<string, string> = {}) {
  const store = new Map<string, string>([
    ...Object.entries(CONFIGURATION_DEFAULTS),
    ...Object.entries(initial),
  ]);

  const service = {
    getSetting: vi.fn((key: string, fallback = '') => store.get(key) ?? fallback),
    getSettingBool: vi.fn((key: string, fallback = false) => {
      const val = store.get(key);
      if (val === undefined) return fallback;
      return val === 'true' || val === '1';
    }),
    updateSetting: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };

  return { service: service as unknown as TranslationService, store };
}

describe('ForcedJoinService', () => {
  it('normalizes usernames, URLs, numeric IDs (including Persian digits), and invite links', () => {
    expect(normalizeForcedJoinChannelId('@my_channel')).toBe('@my_channel');
    expect(normalizeForcedJoinChannelId('https://t.me/my_channel/')).toBe('@my_channel');
    expect(normalizeForcedJoinChannelId('t.me/public_news')).toBe('@public_news');
    expect(normalizeForcedJoinChannelId('-1001234567890')).toBe('-1001234567890');
    expect(normalizeForcedJoinChannelId('-۱۰۰۱۲۳۴۵۶۷۸۹۰')).toBe('-1001234567890');
    expect(normalizeForcedJoinChannelId('invalid')).toBeNull();
    expect(normalizeForcedJoinChannelId('123456789')).toBeNull();

    expect(normalizeForcedJoinInviteLink('', '@my_channel')).toBe('https://t.me/my_channel');
    expect(normalizeForcedJoinInviteLink('t.me/+AbCdEfGh', '-1001234567890')).toBe(
      'https://t.me/+AbCdEfGh'
    );
    expect(normalizeForcedJoinInviteLink('http://t.me/+AbCdEfGh')).toBe('https://t.me/+AbCdEfGh');
    expect(normalizeForcedJoinInviteLink('https://evil.example/join')).toBeNull();
    expect(normalizeForcedJoinInviteLink('', '-1001234567890')).toBeNull();
  });

  it('enforces scope matrix accurately and never blocks renewals under purchase_and_trial', () => {
    expect(doesForcedJoinScopeApply('off', 'any')).toBe(false);
    expect(doesForcedJoinScopeApply('off', 'trial')).toBe(false);
    expect(doesForcedJoinScopeApply('off', 'purchase')).toBe(false);
    expect(doesForcedJoinScopeApply('off', 'renewal')).toBe(false);

    expect(doesForcedJoinScopeApply('all', 'any')).toBe(true);
    expect(doesForcedJoinScopeApply('all', 'trial')).toBe(true);
    expect(doesForcedJoinScopeApply('all', 'purchase')).toBe(true);
    expect(doesForcedJoinScopeApply('all', 'renewal')).toBe(true);

    expect(doesForcedJoinScopeApply('trial_only', 'any')).toBe(false);
    expect(doesForcedJoinScopeApply('trial_only', 'trial')).toBe(true);
    expect(doesForcedJoinScopeApply('trial_only', 'purchase')).toBe(false);
    expect(doesForcedJoinScopeApply('trial_only', 'renewal')).toBe(false);

    expect(doesForcedJoinScopeApply('purchase_and_trial', 'any')).toBe(false);
    expect(doesForcedJoinScopeApply('purchase_and_trial', 'trial')).toBe(true);
    expect(doesForcedJoinScopeApply('purchase_and_trial', 'purchase')).toBe(true);
    expect(doesForcedJoinScopeApply('purchase_and_trial', 'renewal')).toBe(false);
  });

  it('interprets Telegram ChatMember statuses correctly', () => {
    expect(isChatMemberJoined({ status: 'creator' })).toBe(true);
    expect(isChatMemberJoined({ status: 'administrator' })).toBe(true);
    expect(isChatMemberJoined({ status: 'member' })).toBe(true);
    expect(isChatMemberJoined({ status: 'restricted', is_member: true })).toBe(true);
    expect(isChatMemberJoined({ status: 'restricted', is_member: false })).toBe(false);
    expect(isChatMemberJoined({ status: 'left' })).toBe(false);
    expect(isChatMemberJoined({ status: 'kicked' })).toBe(false);
  });

  it('supports channel CRUD, deduplication, and channel limit enforcement', async () => {
    const { service: ts } = createMemoryTranslationService();
    const fj = new ForcedJoinService({ translationService: ts });

    const added = await fj.addChannel({
      channelId: '@NewsChannel',
      title: 'Official News',
    });
    expect(added.channelId).toBe('@NewsChannel');
    expect(added.inviteLink).toBe('https://t.me/NewsChannel');
    expect(added.enabled).toBe(true);

    // Duplicate (case-insensitive)
    await expect(fj.addChannel({ channelId: '@newschannel', title: 'Dup' })).rejects.toMatchObject({
      code: 'DUPLICATE_CHANNEL',
    });

    const toggled = await fj.toggleChannel(added.id, false);
    expect(toggled.enabled).toBe(false);

    const updated = await fj.updateChannel(added.id, {
      title: 'Updated News',
      inviteLink: 'https://t.me/+privateHash',
      enabled: true,
    });
    expect(updated.title).toBe('Updated News');
    expect(updated.inviteLink).toBe('https://t.me/+privateHash');
    expect(updated.enabled).toBe(true);

    // Fill up to MAX_FORCED_JOIN_CHANNELS
    for (let i = 1; i < MAX_FORCED_JOIN_CHANNELS; i += 1) {
      await fj.addChannel({
        channelId: `@chan_${i}_valid`,
        title: `Channel ${i}`,
      });
    }
    await expect(
      fj.addChannel({ channelId: '@overflow_chan', title: 'Overflow' })
    ).rejects.toBeInstanceOf(ForcedJoinError);

    expect(await fj.deleteChannel(added.id)).toBe(true);
    expect(await fj.deleteChannel('nonexistent')).toBe(false);
  });

  it('always allows admins to bypass without hitting Telegram getChatMember', async () => {
    const { service: ts } = createMemoryTranslationService({ forced_join_scope: 'all' });
    const getChatMember = vi.fn(async () => ({ status: 'left' }));
    const fj = new ForcedJoinService({
      translationService: ts,
      getAdapter: () => ({ getChatMember }),
      isAdmin: (id) => id === 999,
    });
    await fj.addChannel({ channelId: '@main_chan', title: 'Main' });

    const adminRes = await fj.checkMembership(999, 'any');
    expect(adminRes.allowed).toBe(true);
    expect(adminRes.bypassedByAdmin).toBe(true);
    expect(getChatMember).not.toHaveBeenCalled();

    const userRes = await fj.checkMembership(123, 'any');
    expect(userRes.allowed).toBe(false);
    expect(userRes.missingChannels).toHaveLength(1);
    expect(getChatMember).toHaveBeenCalledTimes(1);
  });

  it('caches membership checks for TTL and clears immediately on invalidateUserCache / bypassCache', async () => {
    let nowMs = 10_000;
    const { service: ts } = createMemoryTranslationService({ forced_join_scope: 'all' });
    let memberStatus = 'left';
    const getChatMember = vi.fn(async () => ({ status: memberStatus }));

    const fj = new ForcedJoinService({
      translationService: ts,
      getAdapter: () => ({ getChatMember }),
      cacheTtlMs: 45_000,
      now: () => nowMs,
    });
    await fj.addChannel({ channelId: '@cached_chan', title: 'Cached' });

    // 1st call hits Telegram
    expect((await fj.checkMembership(501, 'any')).allowed).toBe(false);
    expect(getChatMember).toHaveBeenCalledTimes(1);

    // 2nd call within 45s hits cache (even if user joined meanwhile)
    memberStatus = 'member';
    nowMs += 20_000;
    expect((await fj.checkMembership(501, 'any')).allowed).toBe(false);
    expect(getChatMember).toHaveBeenCalledTimes(1);

    // Explicit re-check with bypassCache invalidates immediately
    expect((await fj.checkMembership(501, 'any', { bypassCache: true })).allowed).toBe(true);
    expect(getChatMember).toHaveBeenCalledTimes(2);

    // Cached joined=true inside TTL
    nowMs += 30_000;
    expect((await fj.checkMembership(501, 'any')).allowed).toBe(true);
    expect(getChatMember).toHaveBeenCalledTimes(2);

    // After TTL expires (>45s since last fetch), calls Telegram again
    nowMs += 20_000;
    memberStatus = 'left';
    expect((await fj.checkMembership(501, 'any')).allowed).toBe(false);
    expect(getChatMember).toHaveBeenCalledTimes(3);

    // Explicit invalidateUserCache clears immediately
    memberStatus = 'member';
    fj.invalidateUserCache(501);
    expect((await fj.checkMembership(501, 'any')).allowed).toBe(true);
    expect(getChatMember).toHaveBeenCalledTimes(4);
  });

  it('fails open safely on Telegram 400/403/network errors without blocking users or poisoning cache', async () => {
    const { service: ts } = createMemoryTranslationService({ forced_join_scope: 'all' });
    const getChatMember = vi.fn(async (chatId: string | number) => {
      if (chatId === '@broken_chan') {
        const err = new Error('Forbidden: bot is not a member of the channel chat') as Error & {
          error_code: number;
        };
        err.error_code = 403;
        throw err;
      }
      if (chatId === '@missing_chan') {
        const err = new Error('Bad Request: chat not found') as Error & { error_code: number };
        err.error_code = 400;
        throw err;
      }
      return { status: 'left' };
    });

    const fj = new ForcedJoinService({
      translationService: ts,
      getAdapter: () => ({ getChatMember }),
    });
    await fj.addChannel({ channelId: '@broken_chan', title: 'Broken' });
    await fj.addChannel({ channelId: '@missing_chan', title: 'Missing' });

    // Only broken channels -> user is NOT falsely locked out
    const res1 = await fj.checkMembership(700, 'any');
    expect(res1.allowed).toBe(true);
    expect(res1.missingChannels).toHaveLength(0);
    expect(res1.failSafeSkippedCount).toBe(2);

    // Adding a healthy channel where user is not joined still enforces that healthy channel
    await fj.addChannel({ channelId: '@healthy_chan', title: 'Healthy' });
    const res2 = await fj.checkMembership(700, 'any');
    expect(res2.allowed).toBe(false);
    expect(res2.missingChannels.map((c) => c.channelId)).toEqual(['@healthy_chan']);
    expect(res2.failSafeSkippedCount).toBe(2);
  });

  it('tests bot channel admin access and auto-detects chat metadata', async () => {
    const { service: ts } = createMemoryTranslationService();
    const adapter: ForcedJoinTelegramAdapter = {
      getMe: vi.fn(async () => ({ id: 777777, username: 'test_bot' })),
      getChat: vi.fn(async (chatId) => ({
        id: -1009876543210,
        title: chatId === '@admin_ok' ? 'Official Announcements' : 'Private Channel',
        username: chatId === '@admin_ok' ? 'admin_ok' : undefined,
        invite_link: chatId === '-1009876543210' ? 'https://t.me/+privLink' : undefined,
      })),
      getChatMember: vi.fn(async (chatId) => ({
        status: chatId === '@admin_ok' ? 'administrator' : 'member',
      })),
    };

    const fj = new ForcedJoinService({
      translationService: ts,
      getAdapter: () => adapter,
    });

    const okRes = await fj.testChannelAccess('@admin_ok');
    expect(okRes.ok).toBe(true);
    expect(okRes.isAdmin).toBe(true);
    expect(okRes.chatTitle).toBe('Official Announcements');
    expect(okRes.inviteLink).toBe('https://t.me/admin_ok');

    const nonAdminRes = await fj.testChannelAccess('-1009876543210');
    expect(nonAdminRes.ok).toBe(false);
    expect(nonAdminRes.isAdmin).toBe(false);
    expect(nonAdminRes.errorCode).toBe('BOT_NOT_ADMIN');
    expect(nonAdminRes.inviteLink).toBe('https://t.me/+privLink');
  });
});
