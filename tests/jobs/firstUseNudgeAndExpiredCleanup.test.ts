import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from 'grammy';
import type { ConfigService } from '../../src/domain/services/ConfigService.js';
import {
  RebeccaApiError,
  RebeccaOriginDownError,
  type RebeccaService,
  type RebeccaUserDetail,
} from '../../src/domain/services/RebeccaService.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { ConversationContext, MyConversation, SessionData } from '../../src/telegram/types.js';
import { validateTelegramMarkdown } from '../../src/telegram/rendering.js';

const hoistedMocks = vi.hoisted(() => ({
  schedule: vi.fn(() => ({ stop: vi.fn() })),
  getDb: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: { schedule: hoistedMocks.schedule },
}));

vi.mock('../../src/infra/db.js', () => ({
  getDb: () => hoistedMocks.getDb(),
}));

import {
  runFirstUseNudgeCycle,
  startFirstUseNudgeJob,
  stopFirstUseNudgeJob,
  type FirstUseNudgeCandidate,
  type FirstUseNudgeStore,
} from '../../src/jobs/firstUseNudge.js';
import {
  computeCleanupSchedule,
  countConfigsApproachingCleanup,
  runExpiredConfigCleanupCycle,
  startExpiredConfigCleanupJob,
  stopExpiredConfigCleanupJob,
  type CleanupWarningType,
  type ExpiredCleanupAuditEntry,
  type ExpiredConfigCandidate,
  type ExpiredConfigCleanupStore,
} from '../../src/jobs/expiredConfigCleanup.js';
import {
  GENERAL_SETTING_GROUPS,
  SETTING_GROUPS,
  getSettingDefinition,
  getSettingGroup,
} from '../../src/telegram/conversations/adminConversations/settings/catalog.js';
import {
  adminEditSettingsConversation,
  applyAdminSettingUpdate,
} from '../../src/telegram/conversations/adminConversations/settings/conversation.js';
import {
  buildSettingsGroupPrompt,
  buildSettingsInGroupKeyboard,
  displayAdminSettingValue,
} from '../../src/telegram/conversations/adminConversations/settings/presentation.js';
import { validateAdminSetting } from '../../src/telegram/conversations/adminConversations/settings/validation.js';
import { extractCallbackDataList } from '../telegram/helpers/botHarness.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date('2026-11-20T12:00:00Z');
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

function makeTranslationService(overrides: Record<string, string> = {}) {
  const realTs = new TranslationService();
  const settings = new Map<string, string>(Object.entries(overrides));
  const updateSetting = vi.fn(async (key: string, value: string) => {
    settings.set(key, value);
  });

  const service = {
    get: vi.fn((key: string, locale?: string, params?: Record<string, string | number>) =>
      realTs.get(key, locale, params)
    ),
    resolveLocale: vi.fn((raw?: string | null) => realTs.resolveLocale(raw)),
    getSetting: vi.fn((key: string, fallback = '') => settings.get(key) ?? fallback),
    getSettingBool: vi.fn((key: string, fallback = false) => {
      const val = settings.get(key);
      if (val === undefined) return fallback;
      const lower = val.trim().toLowerCase();
      return fallback ? lower !== 'false' && lower !== '0' : lower === 'true' || lower === '1';
    }),
    getSettingNum: vi.fn((key: string, fallback = 0) => {
      const val = settings.get(key);
      if (val === undefined || val.trim() === '') return fallback;
      const parsed = Number(val);
      return Number.isFinite(parsed) ? parsed : fallback;
    }),
    updateSetting,
  } as unknown as TranslationService;

  return { service, settings, updateSetting };
}

function makeRemoteUser(
  username: string,
  overrides: Partial<RebeccaUserDetail> = {}
): RebeccaUserDetail {
  return {
    username,
    status: 'active',
    used_traffic: 0,
    lifetime_used_traffic: 0,
    data_limit: 10 * 1024 ** 3,
    expire: NOW_SEC + 30 * 86_400,
    on_hold_expire_duration: null,
    created_at: '2026-11-18T12:00:00Z',
    subscription_url: `https://panel.example.com/sub/${username}`,
    links: [],
    proxies: {},
    inbounds: {},
    note: null,
    telegram_id: null,
    sub_updated_at: null,
    online_at: null,
    ip_limit: 0,
    service_id: 1,
    service_name: 'Default',
    admin_username: 'admin',
    ...overrides,
  };
}

function makeMemoryNudgeStore(initial: FirstUseNudgeCandidate[]) {
  const claimedIds = new Set<string>();
  const deliveredKeys = new Set<string>();
  const eventLog: string[] = [];

  const store: FirstUseNudgeStore = {
    listCandidates: vi.fn(async (windowStart: Date, windowEnd: Date) =>
      initial.filter(
        (c) =>
          !claimedIds.has(c.id) &&
          c.createdAt.getTime() >= windowStart.getTime() &&
          c.createdAt.getTime() <= windowEnd.getTime()
      )
    ),
    claimFirstUseCheck: vi.fn(async (configId: string) => {
      eventLog.push(`claim:${configId}`);
      if (claimedIds.has(configId)) return false;
      claimedIds.add(configId);
      return true;
    }),
    recordDelivery: vi.fn(async (candidate: FirstUseNudgeCandidate) => {
      const key = `${candidate.telegramId}:${candidate.panelId}:${candidate.configUsername}:first_use_nudge`;
      eventLog.push(`record:${candidate.id}`);
      if (deliveredKeys.has(key)) return false;
      deliveredKeys.add(key);
      return true;
    }),
  };

  return { store, claimedIds, deliveredKeys, eventLog };
}

function makeMemoryCleanupStore(initial: ExpiredConfigCandidate[]) {
  const activeWarnings = new Set<string>();
  const synced: Array<{ configId: string; remote: RebeccaUserDetail; observedAt: Date }> = [];
  const cleared: Array<{ configId: string }> = [];
  const audits: ExpiredCleanupAuditEntry[] = [];

  const warnKey = (c: ExpiredConfigCandidate, type: CleanupWarningType) =>
    `${c.telegramId}:${c.panelId}:${c.configUsername}:${type}`;

  const store: ExpiredConfigCleanupStore = {
    listExpiredCandidates: vi.fn(async () => initial),
    syncLocalConfigCache: vi.fn(async (configId, remote, observedAt) => {
      synced.push({ configId, remote, observedAt });
    }),
    reserveWarning: vi.fn(async (candidate, type) => {
      const key = warnKey(candidate, type);
      if (activeWarnings.has(key)) return false;
      activeWarnings.add(key);
      return true;
    }),
    releaseWarning: vi.fn(async (candidate, type) => {
      activeWarnings.delete(warnKey(candidate, type));
    }),
    clearWarnings: vi.fn(async (candidate) => {
      activeWarnings.delete(warnKey(candidate, 'expired_cleanup_warn_first'));
      activeWarnings.delete(warnKey(candidate, 'expired_cleanup_warn_last'));
      cleared.push({ configId: candidate.id });
    }),
    recordCleanupAudit: vi.fn(async (entry) => {
      audits.push(entry);
    }),
  };

  return { store, activeWarnings, synced, cleared, audits };
}

describe('24h First-Use Smart Nudge Job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopFirstUseNudgeJob();
  });

  it('sends localized FA/EN nudges once for 24h–72h unused active/on_hold configs with service & support buttons', async () => {
    const candidates: FirstUseNudgeCandidate[] = [
      {
        id: 'cfg_fa_active',
        telegramId: 1001,
        panelId: 'legacy',
        configUsername: 'user_fa_1',
        createdAt: new Date(NOW.getTime() - 30 * HOUR_MS),
        locale: 'fa',
      },
      {
        id: 'cfg_en_hold',
        telegramId: 1002,
        panelId: 'legacy',
        configUsername: 'user_en_2',
        createdAt: new Date(NOW.getTime() - 48 * HOUR_MS),
        locale: 'en',
      },
    ];
    const { store, claimedIds, eventLog } = makeMemoryNudgeStore(candidates);
    const { service: translationService } = makeTranslationService({
      first_use_nudge_enabled: 'true',
      support_destination: '@sky_support',
    });

    const sendMessage = vi.fn(async (chatId: number) => {
      eventLog.push(`send:${chatId}`);
      return { message_id: 1 };
    });
    const rebecca = {
      getUser: vi.fn(async (username: string) =>
        username === 'user_en_2'
          ? makeRemoteUser(username, {
              status: 'on_hold',
              used_traffic: 0,
              lifetime_used_traffic: 0,
            })
          : makeRemoteUser(username, {
              status: 'active',
              used_traffic: 0,
              lifetime_used_traffic: 0,
            })
      ),
    } as unknown as RebeccaService;

    const summary = await runFirstUseNudgeCycle(
      {
        panels: rebecca,
        translationService,
        telegramApi: { sendMessage } as unknown as Pick<Api, 'sendMessage'>,
        store,
      },
      NOW
    );

    expect(summary).toEqual({
      enabled: true,
      checked: 2,
      nudged: 2,
      stampedWithoutNudge: 0,
      skippedErrors: 0,
    });
    expect(claimedIds).toEqual(new Set(['cfg_fa_active', 'cfg_en_hold']));
    // Verify atomic claim occurred strictly BEFORE sendMessage.
    expect(eventLog.indexOf('claim:cfg_fa_active')).toBeLessThan(eventLog.indexOf('send:1001'));
    expect(eventLog.indexOf('claim:cfg_en_hold')).toBeLessThan(eventLog.indexOf('send:1002'));

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const [faChatId, faText, faOpts] = sendMessage.mock.calls[0] as [
      number,
      string,
      {
        parse_mode: string;
        reply_markup: {
          inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
        };
      },
    ];
    expect(faChatId).toBe(1001);
    expect(faText).toContain('راهنمای شروع اتصال');
    expect(faText).toContain('`user_fa_1`');
    expect(validateTelegramMarkdown(faText).valid).toBe(true);
    const faButtons = faOpts.reply_markup.inline_keyboard.flat();
    expect(faButtons).toEqual([
      { text: '📡 مشاهدهٔ سرویس', callback_data: 'config:view:cfg_fa_active' },
      { text: '💬 راهنمایی پشتیبانی', url: 'https://t.me/sky_support' },
    ]);

    const [enChatId, enText, enOpts] = sendMessage.mock.calls[1] as [
      number,
      string,
      {
        parse_mode: string;
        reply_markup: {
          inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
        };
      },
    ];
    expect(enChatId).toBe(1002);
    expect(enText).toContain('Quick Connection Guide');
    expect(enText).toContain('`user_en_2`');
    expect(validateTelegramMarkdown(enText).valid).toBe(true);
    const enButtons = enOpts.reply_markup.inline_keyboard.flat();
    expect(enButtons).toEqual([
      { text: '📡 View Service', callback_data: 'config:view:cfg_en_hold' },
      { text: '💬 Contact Support', url: 'https://t.me/sky_support' },
    ]);
  });

  it('enforces at-most-once delivery even across concurrent ticks', async () => {
    const candidate: FirstUseNudgeCandidate = {
      id: 'cfg_race',
      telegramId: 2001,
      panelId: 'legacy',
      configUsername: 'race_user',
      createdAt: new Date(NOW.getTime() - 36 * HOUR_MS),
      locale: 'en',
    };
    const { store } = makeMemoryNudgeStore([candidate]);
    // Both concurrent ticks see the candidate before either claims it.
    (store.listCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([candidate]);

    const { service: translationService } = makeTranslationService({
      first_use_nudge_enabled: 'true',
    });
    const sendMessage = vi.fn(async () => ({ message_id: 1 }));
    const rebecca = {
      getUser: vi.fn(async (username: string) => makeRemoteUser(username)),
    } as unknown as RebeccaService;

    const deps = {
      panels: rebecca,
      translationService,
      telegramApi: { sendMessage } as unknown as Pick<Api, 'sendMessage'>,
      supportUrl: 'https://t.me/fallback_support',
      store,
    };

    const [first, second] = await Promise.all([
      runFirstUseNudgeCycle(deps, NOW),
      runFirstUseNudgeCycle(deps, NOW),
    ]);

    expect(first.nudged + second.nudged).toBe(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('skips used, outside-window, disabled-feature, or error configs and stamps already-used ones', async () => {
    const candidates: FirstUseNudgeCandidate[] = [
      {
        id: 'cfg_too_new',
        telegramId: 3001,
        panelId: 'legacy',
        configUsername: 'too_new',
        createdAt: new Date(NOW.getTime() - 10 * HOUR_MS),
        locale: 'en',
      },
      {
        id: 'cfg_too_old',
        telegramId: 3002,
        panelId: 'legacy',
        configUsername: 'too_old',
        createdAt: new Date(NOW.getTime() - 80 * HOUR_MS),
        locale: 'en',
      },
      {
        id: 'cfg_used_traffic',
        telegramId: 3003,
        panelId: 'legacy',
        configUsername: 'used_now',
        createdAt: new Date(NOW.getTime() - 30 * HOUR_MS),
        locale: 'en',
      },
      {
        id: 'cfg_lifetime_used',
        telegramId: 3004,
        panelId: 'legacy',
        configUsername: 'used_before',
        createdAt: new Date(NOW.getTime() - 30 * HOUR_MS),
        locale: 'en',
      },
      {
        id: 'cfg_expired',
        telegramId: 3005,
        panelId: 'legacy',
        configUsername: 'already_expired',
        createdAt: new Date(NOW.getTime() - 30 * HOUR_MS),
        locale: 'en',
      },
      {
        id: 'cfg_missing_remote',
        telegramId: 3006,
        panelId: 'legacy',
        configUsername: 'missing_404',
        createdAt: new Date(NOW.getTime() - 30 * HOUR_MS),
        locale: 'en',
      },
    ];

    const { store, claimedIds } = makeMemoryNudgeStore(candidates);
    const { service: disabledTs } = makeTranslationService({ first_use_nudge_enabled: 'false' });
    const sendMessage = vi.fn();
    const rebecca = {
      getUser: vi.fn(async (username: string) => {
        if (username === 'used_now') return makeRemoteUser(username, { used_traffic: 1024 });
        if (username === 'used_before') {
          return makeRemoteUser(username, { used_traffic: 0, lifetime_used_traffic: 4096 });
        }
        if (username === 'already_expired') return makeRemoteUser(username, { status: 'expired' });
        if (username === 'missing_404') {
          throw new RebeccaApiError(404, '/api/user/missing_404', 'Not Found');
        }
        return makeRemoteUser(username);
      }),
    } as unknown as RebeccaService;

    // Disabled feature is a no-op.
    const disabledSummary = await runFirstUseNudgeCycle(
      {
        panels: rebecca,
        translationService: disabledTs,
        telegramApi: { sendMessage } as unknown as Pick<Api, 'sendMessage'>,
        store,
      },
      NOW
    );
    expect(disabledSummary.enabled).toBe(false);
    expect(store.listCandidates).not.toHaveBeenCalled();

    // Enabled: filters out-of-window, stamps used/expired without nudging, skips 404 safely.
    const { service: enabledTs } = makeTranslationService({ first_use_nudge_enabled: 'true' });
    const summary = await runFirstUseNudgeCycle(
      {
        panels: rebecca,
        translationService: enabledTs,
        telegramApi: { sendMessage } as unknown as Pick<Api, 'sendMessage'>,
        store,
      },
      NOW
    );

    expect(summary).toEqual({
      enabled: true,
      checked: 4,
      nudged: 0,
      stampedWithoutNudge: 3,
      skippedErrors: 1,
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(claimedIds).toEqual(new Set(['cfg_used_traffic', 'cfg_lifetime_used', 'cfg_expired']));

    startFirstUseNudgeJob({
      panels: rebecca,
      translationService: enabledTs,
      telegramApi: { sendMessage } as unknown as Pick<Api, 'sendMessage'>,
      store,
    });
    expect(hoistedMocks.schedule).toHaveBeenCalledTimes(1);
    stopFirstUseNudgeJob();
  });
});

describe('Staged Automatic Expired-Config Cleanup Job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopExpiredConfigCleanupJob();
  });

  it('respects max(panelExpire, enabled_at, cleanupHoldUntil) + graceDays safety anchor so old expired configs are never abruptly deleted', async () => {
    // Config expired 60 days ago, but admin only turned cleanup ON 1 day ago (grace = 14 days).
    const oldExpireSec = NOW_SEC - 60 * 86_400;
    const enabledAtIso = new Date(NOW.getTime() - 1 * DAY_MS).toISOString();
    const holdUntil = new Date(NOW.getTime() + 5 * DAY_MS);

    const schedule1 = computeCleanupSchedule({
      panelExpireSec: oldExpireSec,
      enabledAt: new Date(enabledAtIso),
      cleanupHoldUntil: null,
      graceDays: 14,
      nowMs: NOW.getTime(),
    });
    expect(schedule1.daysRemaining).toBe(13);
    expect(schedule1.deleteAtMs).toBe(new Date(enabledAtIso).getTime() + 14 * DAY_MS);

    const scheduleHeld = computeCleanupSchedule({
      panelExpireSec: oldExpireSec,
      enabledAt: new Date(NOW.getTime() - 30 * DAY_MS),
      cleanupHoldUntil: holdUntil,
      graceDays: 14,
      nowMs: NOW.getTime(),
    });
    expect(scheduleHeld.daysRemaining).toBe(19);

    const candidates: ExpiredConfigCandidate[] = [
      {
        id: 'cfg_old_safe',
        telegramId: 4001,
        panelId: 'legacy',
        configUsername: 'old_expired_safe',
        panelStatus: 'expired',
        panelExpire: oldExpireSec,
        cleanupHoldUntil: null,
        locale: 'fa',
      },
    ];
    const { store, audits } = makeMemoryCleanupStore(candidates);
    const { service: translationService } = makeTranslationService({
      expired_cleanup_enabled: 'true',
      expired_cleanup_grace_days: '14',
      expired_cleanup_warn_days: '3,1',
      expired_cleanup_enabled_at: enabledAtIso,
    });
    const deleteConfigCompletely = vi.fn(async () => true);
    const sendMessage = vi.fn();
    const rebecca = {
      getUser: vi.fn(async (username: string) =>
        makeRemoteUser(username, { status: 'expired', expire: oldExpireSec })
      ),
    } as unknown as RebeccaService;

    const summary = await runExpiredConfigCleanupCycle(
      {
        panels: rebecca,
        configService: { deleteConfigCompletely } as unknown as Pick<
          ConfigService,
          'deleteConfigCompletely'
        >,
        translationService,
        telegramApi: { sendMessage } as unknown as Pick<Api, 'sendMessage'>,
        store,
      },
      NOW
    );

    expect(summary).toEqual({
      enabled: true,
      checked: 1,
      renewedResynced: 0,
      firstWarningsSent: 0,
      lastWarningsSent: 0,
      deleted: 0,
      skippedErrors: 0,
    });
    expect(deleteConfigCompletely).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
  });

  it('aborts warning/deletion and resyncs local cache when live Rebecca check shows config was renewed', async () => {
    const staleLocalExpireSec = NOW_SEC - 20 * 86_400;
    const renewedRemoteExpireSec = NOW_SEC + 25 * 86_400;
    const candidate: ExpiredConfigCandidate = {
      id: 'cfg_renewed',
      telegramId: 4002,
      panelId: 'legacy',
      configUsername: 'renewed_live',
      panelStatus: 'expired',
      panelExpire: staleLocalExpireSec,
      cleanupHoldUntil: null,
      locale: 'en',
    };
    const { store, synced, cleared } = makeMemoryCleanupStore([candidate]);
    const { service: translationService } = makeTranslationService({
      expired_cleanup_enabled: 'true',
      expired_cleanup_grace_days: '14',
      expired_cleanup_warn_days: '3,1',
      expired_cleanup_enabled_at: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
    });
    const deleteConfigCompletely = vi.fn(async () => true);
    const sendMessage = vi.fn();
    const rebecca = {
      getUser: vi.fn(async (username: string) =>
        makeRemoteUser(username, { status: 'active', expire: renewedRemoteExpireSec })
      ),
    } as unknown as RebeccaService;

    const summary = await runExpiredConfigCleanupCycle(
      {
        panels: rebecca,
        configService: { deleteConfigCompletely } as unknown as Pick<
          ConfigService,
          'deleteConfigCompletely'
        >,
        translationService,
        telegramApi: { sendMessage } as unknown as Pick<Api, 'sendMessage'>,
        store,
      },
      NOW
    );

    expect(summary.renewedResynced).toBe(1);
    expect(summary.deleted).toBe(0);
    expect(deleteConfigCompletely).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(synced).toHaveLength(1);
    expect(synced[0]?.remote.expire).toBe(renewedRemoteExpireSec);
    expect(cleared).toEqual([{ configId: 'cfg_renewed' }]);
  });

  it('delivers deduplicated first & last warnings with renew:open:<id> button, then deletes and writes audit_logs after grace expires', async () => {
    const enabledAtIso = new Date(NOW.getTime() - 60 * DAY_MS).toISOString();
    const expireFirstWarnSec = NOW_SEC - 12 * 86_400; // 2 days left before 14d grace ends -> first warning (3,1)
    const expireLastWarnSec = NOW_SEC - 13 * 86_400 - 12 * 3600; // 0.5 day left -> ceil=1 -> last warning
    const expireDueSec = NOW_SEC - 15 * 86_400; // past 14d grace -> delete

    const candidates: ExpiredConfigCandidate[] = [
      {
        id: 'cfg_warn1',
        telegramId: 5001,
        panelId: 'p1',
        configUsername: 'warn_first_user',
        panelStatus: 'expired',
        panelExpire: expireFirstWarnSec,
        cleanupHoldUntil: null,
        locale: 'en',
      },
      {
        id: 'cfg_warn2',
        telegramId: 5002,
        panelId: 'p1',
        configUsername: 'warn_last_user',
        panelStatus: 'expired',
        panelExpire: expireLastWarnSec,
        cleanupHoldUntil: null,
        locale: 'fa',
      },
      {
        id: 'cfg_delete_me',
        telegramId: 5003,
        panelId: 'p1',
        configUsername: 'delete_me_user',
        panelStatus: 'expired',
        panelExpire: expireDueSec,
        cleanupHoldUntil: null,
        locale: 'en',
      },
    ];

    const { store, audits } = makeMemoryCleanupStore(candidates);
    const { service: translationService } = makeTranslationService({
      expired_cleanup_enabled: 'true',
      expired_cleanup_grace_days: '14',
      expired_cleanup_warn_days: '3,1',
      expired_cleanup_enabled_at: enabledAtIso,
    });

    const deleteConfigCompletely = vi.fn(async () => true);
    const sendMessage = vi.fn(async () => ({ message_id: 77 }));
    const rebecca = {
      getUser: vi.fn(async (username: string) => {
        const match = candidates.find((c) => c.configUsername === username)!;
        return makeRemoteUser(username, { status: 'expired', expire: match.panelExpire });
      }),
    } as unknown as RebeccaService;

    const deps = {
      panels: rebecca,
      configService: { deleteConfigCompletely } as unknown as Pick<
        ConfigService,
        'deleteConfigCompletely'
      >,
      translationService,
      telegramApi: { sendMessage } as unknown as Pick<Api, 'sendMessage'>,
      store,
    };

    const run1 = await runExpiredConfigCleanupCycle(deps, NOW);
    expect(run1).toEqual({
      enabled: true,
      checked: 3,
      renewedResynced: 0,
      firstWarningsSent: 1,
      lastWarningsSent: 1,
      deleted: 1,
      skippedErrors: 0,
    });

    // Verify first warning button & Markdown validity
    const [chat1, text1, opts1] = sendMessage.mock.calls[0] as [
      number,
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } },
    ];
    expect(chat1).toBe(5001);
    expect(text1).toContain('`warn_first_user`');
    expect(text1).toContain('*2 days*');
    expect(validateTelegramMarkdown(text1).valid).toBe(true);
    expect(opts1.reply_markup.inline_keyboard.flat()).toEqual([
      { text: '🔄 Quick Renew', callback_data: 'renew:open:cfg_warn1' },
    ]);

    // Verify last warning button & Persian Markdown validity
    const [chat2, text2, opts2] = sendMessage.mock.calls[1] as [
      number,
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } },
    ];
    expect(chat2).toBe(5002);
    expect(text2).toContain('`warn_last_user`');
    expect(validateTelegramMarkdown(text2).valid).toBe(true);
    expect(opts2.reply_markup.inline_keyboard.flat()).toEqual([
      { text: '🔄 تمدید فوری سرویس', callback_data: 'renew:open:cfg_warn2' },
    ]);

    // Verify deletion delegated to configService + audit log recorded + deletion notice sent
    expect(deleteConfigCompletely).toHaveBeenCalledWith('delete_me_user', 'p1');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      configId: 'cfg_delete_me',
      telegramId: 5003,
      panelId: 'p1',
      configUsername: 'delete_me_user',
      panelExpire: expireDueSec,
      graceDays: 14,
      reason: 'expired_grace_elapsed',
    });
    const [chat3, text3] = sendMessage.mock.calls[2] as [number, string];
    expect(chat3).toBe(5003);
    expect(text3).toContain('`delete_me_user`');
    expect(validateTelegramMarkdown(text3).valid).toBe(true);

    // Second tick: warnings must be deduped (0 warnings resent).
    sendMessage.mockClear();
    (store.listExpiredCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidates.slice(0, 2)
    );
    const run2 = await runExpiredConfigCleanupCycle(deps, NOW);
    expect(run2.firstWarningsSent).toBe(0);
    expect(run2.lastWarningsSent).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();

    // Verify preview count helper accurately counts totalCandidates, approachingDeletion, dueForDeletion.
    const allPreviewCandidates: ExpiredConfigCandidate[] = [
      ...candidates,
      {
        id: 'cfg_safe_far',
        telegramId: 5004,
        panelId: 'p1',
        configUsername: 'far_away',
        panelStatus: 'expired',
        panelExpire: NOW_SEC - 2 * 86_400, // 12 days left > 3
        cleanupHoldUntil: null,
      },
    ];
    const preview = await countConfigsApproachingCleanup(translationService, NOW, {
      listExpiredCandidates: async () => allPreviewCandidates,
    });
    expect(preview).toEqual({
      totalCandidates: 4,
      approachingDeletion: 3,
      dueForDeletion: 1,
    });
  });

  it('cleans up remote 404 configs safely and isolates RebeccaOriginDownError per panel', async () => {
    const enabledAtIso = new Date(NOW.getTime() - 30 * DAY_MS).toISOString();
    const candidates: ExpiredConfigCandidate[] = [
      {
        id: 'cfg_404',
        telegramId: 6001,
        panelId: 'panel_ok',
        configUsername: 'gone_on_panel',
        panelStatus: 'expired',
        panelExpire: NOW_SEC - 5 * 86_400,
        cleanupHoldUntil: null,
      },
      {
        id: 'cfg_down_1',
        telegramId: 6002,
        panelId: 'panel_down',
        configUsername: 'down_user_1',
        panelStatus: 'expired',
        panelExpire: NOW_SEC - 20 * 86_400,
        cleanupHoldUntil: null,
      },
      {
        id: 'cfg_down_2',
        telegramId: 6003,
        panelId: 'panel_down',
        configUsername: 'down_user_2',
        panelStatus: 'expired',
        panelExpire: NOW_SEC - 20 * 86_400,
        cleanupHoldUntil: null,
      },
    ];
    const { store, audits } = makeMemoryCleanupStore(candidates);
    const { service: translationService } = makeTranslationService({
      expired_cleanup_enabled: 'true',
      expired_cleanup_grace_days: '14',
      expired_cleanup_warn_days: '3,1',
      expired_cleanup_enabled_at: enabledAtIso,
    });
    const deleteConfigCompletely = vi.fn(async () => true);
    const getUser = vi.fn(async (username: string) => {
      if (username === 'gone_on_panel') {
        throw new RebeccaApiError(404, '/api/user/gone_on_panel', 'Not Found');
      }
      throw new RebeccaOriginDownError('/api/user/' + username, 502, 3, false);
    });
    const panels = {
      getService: vi.fn(() => ({ getUser }) as unknown as RebeccaService),
    };

    const summary = await runExpiredConfigCleanupCycle(
      {
        panels,
        configService: { deleteConfigCompletely } as unknown as Pick<
          ConfigService,
          'deleteConfigCompletely'
        >,
        translationService,
        telegramApi: { sendMessage: vi.fn() } as unknown as Pick<Api, 'sendMessage'>,
        store,
      },
      NOW
    );

    expect(summary.deleted).toBe(1);
    expect(summary.skippedErrors).toBe(2);
    // panel_down was skipped on the second candidate without a redundant API call.
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(deleteConfigCompletely).toHaveBeenCalledWith('gone_on_panel', 'panel_ok');
    expect(audits[0]?.reason).toBe('remote_missing');

    startExpiredConfigCleanupJob({
      panels,
      configService: { deleteConfigCompletely } as unknown as Pick<
        ConfigService,
        'deleteConfigCompletely'
      >,
      translationService,
      telegramApi: { sendMessage: vi.fn() } as unknown as Pick<Api, 'sendMessage'>,
      store,
    });
    expect(hoistedMocks.schedule).toHaveBeenCalledTimes(1);
    stopExpiredConfigCleanupJob();
  });
});

describe('Admin Retention, Receipt Policy & Phone Verification Settings Wiring and Validation', () => {
  it('registers retention group and all new settings with 64-byte safe callbacks', () => {
    const retentionGroup = getSettingGroup('retention');
    expect(retentionGroup).toBeDefined();
    expect(GENERAL_SETTING_GROUPS.some((g) => g.id === 'retention')).toBe(true);
    expect(SETTING_GROUPS.some((g) => g.id === 'retention')).toBe(true);
    expect(retentionGroup?.settings).toEqual([
      'first_use_nudge_enabled',
      'expired_cleanup_enabled',
      'expired_cleanup_grace_days',
      'expired_cleanup_warn_days',
    ]);

    expect(getSettingDefinition('receipt_duplicate_policy')?.group).toBe('payment');
    expect(getSettingDefinition('bank_cards_json')?.group).toBe('payment');
    expect(getSettingDefinition('require_phone_for_trial')?.group).toBe('trial');
    expect(getSettingDefinition('require_phone_for_purchase')?.group).toBe('system');
    expect(getSettingDefinition('phone_verify_iran_only')?.group).toBe('system');

    const { service: translationService } = makeTranslationService({
      expired_cleanup_enabled: 'false',
      expired_cleanup_grace_days: '14',
      expired_cleanup_warn_days: '3,1',
      receipt_duplicate_policy: 'block',
    });
    const fakeCtx = {
      from: { id: 1, is_bot: false, first_name: 'Admin', language_code: 'fa' },
      userLocale: 'fa',
      services: { translationService },
    } as unknown as ConversationContext;

    const retentionKb = buildSettingsInGroupKeyboard(fakeCtx, retentionGroup!);
    for (const cb of extractCallbackDataList(retentionKb)) {
      expect(Buffer.byteLength(cb, 'utf8')).toBeLessThanOrEqual(64);
    }

    const promptWithPreview = buildSettingsGroupPrompt(fakeCtx, 'retention', {
      approachingDeletionCount: 7,
    });
    expect(promptWithPreview).toContain('در آستانهٔ حذف: *۷*');
    expect(validateTelegramMarkdown(promptWithPreview).valid).toBe(true);

    expect(displayAdminSettingValue(fakeCtx, 'receipt_duplicate_policy')).toContain('مسدودسازی');
  });

  it('validates expired_cleanup_grace_days, expired_cleanup_warn_days, receipt_duplicate_policy, and bank_cards_json with Persian digits', () => {
    expect(validateAdminSetting('expired_cleanup_grace_days', '۱۴')).toBe('14');
    expect(validateAdminSetting('expired_cleanup_grace_days', '1')).toBe('1');
    expect(validateAdminSetting('expired_cleanup_grace_days', '365')).toBe('365');
    expect(validateAdminSetting('expired_cleanup_grace_days', '0')).toBeUndefined();
    expect(validateAdminSetting('expired_cleanup_grace_days', '366')).toBeUndefined();
    expect(validateAdminSetting('expired_cleanup_grace_days', '-3')).toBeUndefined();

    expect(validateAdminSetting('expired_cleanup_warn_days', '3,1')).toBe('3,1');
    expect(validateAdminSetting('expired_cleanup_warn_days', '۵، ۲')).toBe('5,2');
    expect(validateAdminSetting('expired_cleanup_warn_days', '13,1', { graceDays: 14 })).toBe(
      '13,1'
    );
    expect(
      validateAdminSetting('expired_cleanup_warn_days', '14,1', { graceDays: 14 })
    ).toBeUndefined();
    expect(validateAdminSetting('expired_cleanup_warn_days', '3,3')).toBeUndefined();
    expect(validateAdminSetting('expired_cleanup_warn_days', '1,3')).toBeUndefined();
    expect(validateAdminSetting('expired_cleanup_warn_days', '3,0')).toBeUndefined();
    expect(validateAdminSetting('expired_cleanup_warn_days', '3,2,1')).toBeUndefined();
    expect(validateAdminSetting('expired_cleanup_warn_days', 'abc')).toBeUndefined();

    expect(validateAdminSetting('receipt_duplicate_policy', 'warn')).toBe('warn');
    expect(validateAdminSetting('receipt_duplicate_policy', 'BLOCK')).toBe('block');
    expect(validateAdminSetting('receipt_duplicate_policy', 'ignore')).toBeUndefined();

    expect(validateAdminSetting('bank_cards_json', '[]')).toBe('[]');
    expect(validateAdminSetting('bank_cards_json', '[{"cardNumber":"6037991234567890"}]')).toBe(
      '[{"cardNumber":"6037991234567890"}]'
    );
    expect(validateAdminSetting('bank_cards_json', '{}')).toBeUndefined();
    expect(validateAdminSetting('bank_cards_json', '["bad"]')).toBeUndefined();
  });

  it('automatically stamps expired_cleanup_enabled_at when admin flips expired_cleanup_enabled from false to true', async () => {
    const fixedNow = new Date('2026-11-21T08:00:00.000Z');
    const { service, settings, updateSetting } = makeTranslationService({
      expired_cleanup_enabled: 'false',
      expired_cleanup_enabled_at: '',
    });

    await applyAdminSettingUpdate(service, 'expired_cleanup_enabled', 'true', fixedNow);
    expect(settings.get('expired_cleanup_enabled')).toBe('true');
    expect(settings.get('expired_cleanup_enabled_at')).toBe('2026-11-21T08:00:00.000Z');

    // Disabling must NOT overwrite the recorded timestamp.
    updateSetting.mockClear();
    await applyAdminSettingUpdate(
      service,
      'expired_cleanup_enabled',
      'false',
      new Date('2026-11-22T00:00:00.000Z')
    );
    expect(updateSetting).toHaveBeenCalledTimes(1);
    expect(updateSetting).toHaveBeenCalledWith('expired_cleanup_enabled', 'false');
    expect(settings.get('expired_cleanup_enabled_at')).toBe('2026-11-21T08:00:00.000Z');

    // End-to-end conversation toggle in the retention group (DB unavailable -> preview safely ignored).
    hoistedMocks.getDb.mockImplementation(() => {
      throw new Error('DB_UNAVAILABLE_IN_UNIT_TEST');
    });
    const convTs = makeTranslationService({
      expired_cleanup_enabled: 'false',
      expired_cleanup_grace_days: '14',
      expired_cleanup_warn_days: '3,1',
    });
    const reply = vi.fn(async () => ({ message_id: 1 }));
    const session: SessionData = {};
    const ctx = {
      from: { id: 42, is_bot: false, first_name: 'Admin', language_code: 'en' },
      userLocale: 'en',
      session,
      reply,
      services: {
        translationService: convTs.service,
        isAdmin: vi.fn(() => true),
      },
    } as unknown as ConversationContext;

    const script = [
      { callback: 'set-edit:expired_cleanup_enabled' },
      { callback: 'conversation:cancel' },
    ];
    const conversation = {
      external: vi.fn(async (op: (outsideCtx: unknown) => unknown) => op(ctx)),
      wait: vi.fn(async () => {
        const next = script.shift();
        if (!next) throw new Error('SCRIPT_EXHAUSTED');
        return {
          ...ctx,
          callbackQuery: { data: next.callback, message: { message_id: 10 } },
          answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        };
      }),
      halt: vi.fn(),
    } as unknown as MyConversation;

    await adminEditSettingsConversation(conversation, ctx, 'retention');

    expect(convTs.settings.get('expired_cleanup_enabled')).toBe('true');
    const stampedAt = convTs.settings.get('expired_cleanup_enabled_at');
    expect(stampedAt).toBeTruthy();
    expect(Number.isNaN(new Date(stampedAt!).getTime())).toBe(false);
  });
});
