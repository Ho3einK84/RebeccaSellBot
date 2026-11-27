import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetAppVersionCacheForTests,
  resolveAppVersionInfo,
  setAppVersionInfoForTests,
  toPublicAppVersion,
} from '../../src/infra/appVersion.js';
import { resolveVersionMetadata } from '../../scripts/version-info.mjs';
import {
  buildVersionScreen,
  formatAdminStatsVersionValue,
  formatAdminVersionFooter,
} from '../../src/telegram/versionBadge.js';
import { validateTelegramMarkdown } from '../../src/telegram/rendering.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import {
  renderAdminHomeScreen,
  renderAdminStatsScreen,
} from '../../src/telegram/admin/adminHome.js';
import { renderHomeDashboard } from '../../src/telegram/keyboards/homeDashboard.js';
import { createWebAppServer } from '../../src/webapp/server/server.js';
import {
  buildReleaseLink,
  resolveClientAppVersion,
} from '../../webapp/src/shared/lib/appVersion.js';
import { fa as webappFa } from '../../webapp/src/shared/i18n/locales/fa.js';
import { en as webappEn } from '../../webapp/src/shared/i18n/locales/en.js';
import type { Config } from '../../src/infra/config.js';
import type { BotServices, MenuContext } from '../../src/telegram/types.js';

function signTelegramInitData(botToken: string, user: Record<string, unknown>): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
  });
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

describe('App Version Engine (main / dev / prerelease SemVer)', () => {
  afterEach(() => {
    resetAppVersionCacheForTests();
  });

  it('resolves official main release versions cleanly', () => {
    const info = resolveAppVersionInfo({
      version: '0.3.0',
      branch: 'main',
      commit: '6d9c285f9911223344',
      tag: 'v0.3.0',
      commitsAhead: 0,
      dirty: false,
      builtAt: '2026-11-27T12:00:00Z',
    });

    expect(info.name).toBe('RebeccaSellBot');
    expect(info.channel).toBe('stable');
    expect(info.displayVersion).toBe('v0.3.0');
    expect(info.fullVersion).toBe('v0.3.0+6d9c285');
    expect(info.branch).toBe('main');
    expect(info.commit).toBe('6d9c285');
    expect(info.tag).toBe('v0.3.0');
    expect(info.dirty).toBe(false);

    // Build script parity
    expect(
      resolveVersionMetadata({
        version: '0.3.0',
        branch: 'main',
        commit: '6d9c285f9911223344',
        tag: 'v0.3.0',
        commitsAhead: 0,
        dirty: false,
        builtAt: '2026-11-27T12:00:00Z',
      })
    ).toEqual(info);
  });

  it('resolves dev branch builds with commits ahead and dirty metadata', () => {
    const cleanDev = resolveAppVersionInfo({
      version: '0.3.0',
      branch: 'dev',
      commit: 'a1b2c3d',
      commitsAhead: 0,
      dirty: false,
    });
    expect(cleanDev.channel).toBe('dev');
    expect(cleanDev.displayVersion).toBe('v0.3.0-dev');
    expect(cleanDev.fullVersion).toBe('v0.3.0-dev+a1b2c3d');

    const aheadDirtyDev = resolveAppVersionInfo({
      version: '0.3.0',
      branch: 'refs/heads/dev',
      commit: 'A1B2C3D4E5',
      commitsAhead: '5',
      dirty: 'true',
    });
    expect(aheadDirtyDev.channel).toBe('dev');
    expect(aheadDirtyDev.branch).toBe('dev');
    expect(aheadDirtyDev.commitsAhead).toBe(5);
    expect(aheadDirtyDev.displayVersion).toBe('v0.3.0-dev.5');
    expect(aheadDirtyDev.fullVersion).toBe('v0.3.0-dev.5+a1b2c3d.dirty');
  });

  it('preserves explicit prerelease identifiers and classifies -dev vs -rc/-beta', () => {
    const devPkg = resolveAppVersionInfo({
      version: '0.4.0-dev.2',
      branch: 'dev',
      commit: 'f0e1d2c',
    });
    expect(devPkg.channel).toBe('dev');
    expect(devPkg.displayVersion).toBe('v0.4.0-dev.2');
    expect(devPkg.fullVersion).toBe('v0.4.0-dev.2+f0e1d2c');

    const rcPkg = resolveAppVersionInfo({
      version: '0.4.0-rc.1',
      branch: 'HEAD',
      tag: 'refs/tags/v0.4.0-rc.1',
      commit: '1122334',
    });
    expect(rcPkg.channel).toBe('prerelease');
    expect(rcPkg.branch).toBeNull();
    expect(rcPkg.tag).toBe('v0.4.0-rc.1');
    expect(rcPkg.displayVersion).toBe('v0.4.0-rc.1');
    expect(rcPkg.fullVersion).toBe('v0.4.0-rc.1+1122334');
  });

  it('defaults to stable when built without git context and treats feature branches as dev', () => {
    const bareDocker = resolveAppVersionInfo({ version: '0.3.0' });
    expect(bareDocker.channel).toBe('stable');
    expect(bareDocker.displayVersion).toBe('v0.3.0');
    expect(bareDocker.fullVersion).toBe('v0.3.0');
    expect(bareDocker.branch).toBeNull();
    expect(bareDocker.commit).toBeNull();

    const featureBranch = resolveAppVersionInfo({
      version: '0.3.0',
      branch: 'feat/inventory_limits',
      commit: 'abcdef1',
      commitsAhead: 2,
    });
    expect(featureBranch.channel).toBe('dev');
    expect(featureBranch.branch).toBe('feat/inventory_limits');
    expect(featureBranch.displayVersion).toBe('v0.3.0-dev.2');
  });

  it('sanitizes internal build fields in toPublicAppVersion', () => {
    const full = resolveAppVersionInfo({
      version: '0.3.0',
      branch: 'dev',
      commit: '6d9c285',
      commitsAhead: 3,
      dirty: true,
      builtAt: '2026-11-27T12:00:00Z',
    });
    const pub = toPublicAppVersion(full);
    expect(pub).toEqual({
      name: 'RebeccaSellBot',
      version: '0.3.0',
      displayVersion: 'v0.3.0-dev.3',
      channel: 'dev',
      branch: 'dev',
    });
    expect('commit' in pub).toBe(false);
    expect('dirty' in pub).toBe(false);
    expect('builtAt' in pub).toBe(false);
  });
});

describe('Telegram Bot Version Display & Markdown Safety', () => {
  const realTs = new TranslationService();

  function makeCtx(locale: 'fa' | 'en'): MenuContext {
    return {
      from: { id: 1001 },
      userLocale: locale,
      session: {},
      reply: vi.fn().mockResolvedValue({ message_id: 1 }),
      services: {
        translationService: {
          get: (key: string, loc?: string, vars?: Record<string, string | number>) =>
            realTs.get(key, (loc as 'fa' | 'en') ?? locale, vars),
          resolveLocale: () => locale,
          getSettingBool: () => false,
          getSettingNum: (_k: string, d = 0) => d,
          getSetting: (_k: string, d = '') => d,
        },
        walletService: {
          getBalance: vi.fn().mockResolvedValue(50_000),
          getAvailableBalance: vi.fn().mockResolvedValue(50_000),
          getPendingReceiptCount: vi.fn().mockResolvedValue(0),
          getDashboardStats: vi.fn().mockResolvedValue({
            pendingReceipts: 0,
            dailyRevenue: 0,
            weeklyRevenue: 0,
            monthlyRevenue: 0,
            totalUsers: 1,
            totalSales: 0,
            activeSubscriptions: 0,
            inactiveSubscriptions: 0,
            totalReferralBonus: 0,
            totalCashback: 0,
          }),
        },
        configService: {
          listConfigsForOwner: vi.fn().mockResolvedValue([]),
        },
        pricingService: {
          getPackages: vi.fn().mockReturnValue([]),
        },
      },
    } as unknown as MenuContext;
  }

  afterEach(() => {
    resetAppVersionCacheForTests();
  });

  it('formats minimal admin main and dev versions without upstream branding and with valid Telegram Markdown v1', () => {
    const mainInfo = resolveAppVersionInfo({
      version: '0.3.0',
      branch: 'main',
      commit: '6d9c285',
      builtAt: '2026-11-27T12:00:00Z',
    });
    const devInfo = resolveAppVersionInfo({
      version: '0.3.0',
      branch: 'feat/my_branch',
      commit: 'a1b2c3d',
      commitsAhead: 4,
      dirty: true,
      builtAt: '2026-11-27T12:00:00Z',
    });

    for (const locale of ['fa', 'en'] as const) {
      const ctx = makeCtx(locale);
      const adminMainFooter = formatAdminVersionFooter(ctx, mainInfo);
      expect(adminMainFooter).toContain('`v0.3.0`');
      expect(adminMainFooter).not.toContain('RebeccaSellBot');
      expect(validateTelegramMarkdown(adminMainFooter).valid).toBe(true);

      const adminDevFooter = formatAdminVersionFooter(ctx, devInfo);
      expect(adminDevFooter).toContain('`v0.3.0-dev.4`');
      expect(adminDevFooter).toContain('`a1b2c3d`');
      expect(adminDevFooter).not.toContain('RebeccaSellBot');
      expect(validateTelegramMarkdown(adminDevFooter).valid).toBe(true);

      const statsValue = formatAdminStatsVersionValue(ctx, devInfo);
      expect(statsValue).toContain('`v0.3.0-dev.4`');
      expect(statsValue).toContain('`a1b2c3d`');
      expect(statsValue).not.toContain('RebeccaSellBot');
      expect(validateTelegramMarkdown(statsValue).valid).toBe(true);

      const adminScreen = buildVersionScreen(ctx, { info: devInfo });
      expect(adminScreen).toContain('`v0.3.0-dev.4`');
      expect(adminScreen).toContain('`a1b2c3d`');
      expect(adminScreen).toContain('`v0.3.0-dev.4+a1b2c3d.dirty`');
      expect(adminScreen).not.toContain('RebeccaSellBot');
      expect(validateTelegramMarkdown(adminScreen).valid).toBe(true);
    }
  });

  it('keeps user home dashboard free of version text while showing minimal version in Admin Home & Stats', async () => {
    setAppVersionInfoForTests(
      resolveAppVersionInfo({
        version: '0.3.0',
        branch: 'dev',
        commit: '9988776',
        commitsAhead: 2,
      })
    );
    const ctx = makeCtx('fa');

    const homeText = await renderHomeDashboard(ctx);
    expect(homeText).not.toContain('v0.3.0-dev.2');
    expect(homeText).not.toContain('RebeccaSellBot');
    expect(homeText).not.toContain('9988776');

    await renderAdminHomeScreen(ctx);
    const adminHomeText = String(
      (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? ''
    );
    expect(adminHomeText).toContain('`v0.3.0-dev.2`');
    expect(adminHomeText).toContain('`9988776`');
    expect(adminHomeText).not.toContain('RebeccaSellBot');

    await renderAdminStatsScreen(ctx);
    const adminStatsText = String(
      (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? ''
    );
    expect(adminStatsText).toContain('نسخه ربات');
    expect(adminStatsText).toContain('`v0.3.0-dev.2`');
    expect(adminStatsText).toContain('`9988776`');
    expect(adminStatsText).not.toContain('RebeccaSellBot');
  });
});

describe('WebApp API & Frontend Version Integration', () => {
  const BOT_TOKEN = '123456789:TEST_BOT_TOKEN_FOR_VERSION_ROUTES';

  afterEach(() => {
    resetAppVersionCacheForTests();
  });

  it('exposes public version on /api/health, /api/auth/bot-info, user auth, and full version for admins', async () => {
    setAppVersionInfoForTests(
      resolveAppVersionInfo({
        version: '0.3.0',
        branch: 'dev',
        commit: 'deadbee',
        commitsAhead: 7,
        dirty: false,
        builtAt: '2026-11-27T12:30:00Z',
      })
    );

    const ts = new TranslationService();
    const adminId = 42;
    const regularUserId = 99;
    const services = {
      botUsername: 'RebeccaShopBot',
      adminIds: [adminId],
      isAdmin: (id: number) => id === adminId,
      adminService: { isAdmin: (id: number) => id === adminId, adminIds: [adminId] },
      translationService: ts,
      userService: {
        getLocale: vi.fn().mockResolvedValue('fa'),
        exists: vi.fn().mockResolvedValue(true),
        findProfile: vi.fn().mockImplementation(async (id: string) => ({
          id: `u_${id}`,
          telegramId: Number(id),
          username: 'tester',
          firstName: 'Test',
          lastName: 'User',
          balance: 10_000,
          reservedBalance: 0,
          referralCode: 'ref_test',
          totalSpend: 0,
          activeSubscriptionCount: 0,
          transactionCount: 0,
          referredUserCount: 0,
          referralBonusEarned: 0,
          cashbackEarned: 0,
          hasUsedTrial: false,
          isBanned: false,
          createdAt: new Date().toISOString(),
        })),
      },
      walletService: {
        getOrCreateUser: vi.fn().mockResolvedValue({ locale: 'fa' }),
        getDashboardStats: vi.fn().mockResolvedValue({
          pendingReceipts: 0,
          dailyRevenue: 0,
          weeklyRevenue: 0,
          monthlyRevenue: 0,
          totalUsers: 2,
          totalSales: 0,
          activeSubscriptions: 0,
          inactiveSubscriptions: 0,
          totalReferralBonus: 0,
          totalCashback: 0,
        }),
        getPendingReceiptForUser: vi.fn().mockResolvedValue(null),
      },
      panelRegistry: {
        listPanels: vi.fn().mockReturnValue([]),
      },
    } as unknown as BotServices;

    const app = await createWebAppServer(
      {
        NODE_ENV: 'test',
        BOT_TOKEN,
        ADMIN_SESSION_SECRET: 'a'.repeat(40),
        WEBAPP_PORT: 3002,
        WEBAPP_HOST: '127.0.0.1',
        INSTANCE_NAME: 'test',
        REGISTRY_DIR: '/tmp/rsbot-test-registry-version',
      } as unknown as Config,
      services,
      { serveStatic: false }
    );

    try {
      const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json()).toEqual({
        status: 'ok',
        component: 'webapp',
        version: 'v0.3.0-dev.7',
        channel: 'dev',
      });

      const botInfoRes = await app.inject({ method: 'GET', url: '/api/auth/bot-info' });
      expect(botInfoRes.statusCode).toBe(200);
      expect(botInfoRes.json().appVersion).toEqual({
        name: 'RebeccaSellBot',
        version: '0.3.0',
        displayVersion: 'v0.3.0-dev.7',
        channel: 'dev',
        branch: 'dev',
      });

      const userAuthRes = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: {
          initData: signTelegramInitData(BOT_TOKEN, { id: regularUserId, first_name: 'Ali' }),
        },
      });
      expect(userAuthRes.statusCode).toBe(200);
      const userAuthBody = userAuthRes.json();
      expect(userAuthBody.role).toBe('user');
      expect(userAuthBody.appVersion.displayVersion).toBe('v0.3.0-dev.7');
      expect(userAuthBody.appVersion.commit).toBeUndefined();

      const profileRes = await app.inject({
        method: 'GET',
        url: '/api/user/profile',
        headers: { authorization: `Bearer ${userAuthBody.token}` },
      });
      expect(profileRes.statusCode).toBe(200);
      expect(profileRes.json().appVersion.displayVersion).toBe('v0.3.0-dev.7');
      expect(profileRes.json().appVersion.commit).toBeUndefined();

      const adminAuthRes = await app.inject({
        method: 'POST',
        url: '/api/auth/telegram-validate',
        payload: {
          initData: signTelegramInitData(BOT_TOKEN, { id: adminId, first_name: 'Admin' }),
        },
      });
      expect(adminAuthRes.statusCode).toBe(200);
      const adminAuthBody = adminAuthRes.json();
      expect(adminAuthBody.role).toBe('admin');
      expect(adminAuthBody.appVersion.displayVersion).toBe('v0.3.0-dev.7');
      expect(adminAuthBody.appVersion.commit).toBe('deadbee');
      expect(adminAuthBody.appVersion.fullVersion).toBe('v0.3.0-dev.7+deadbee');

      const statsRes = await app.inject({
        method: 'GET',
        url: '/api/admin/stats',
        headers: { authorization: `Bearer ${adminAuthBody.token}` },
      });
      expect(statsRes.statusCode).toBe(200);
      expect(statsRes.json().appVersion.displayVersion).toBe('v0.3.0-dev.7');
      expect(statsRes.json().appVersion.commit).toBe('deadbee');
    } finally {
      await app.close();
    }
  });

  it('merges server version in WebApp helper, builds release links, and keeps FA/EN locale parity', () => {
    const merged = resolveClientAppVersion({
      name: 'RebeccaSellBot',
      version: '0.3.0',
      displayVersion: 'v0.3.0',
      channel: 'stable',
      branch: 'main',
      tag: 'v0.3.0',
      repositoryUrl: 'https://github.com/Ho3einK84/RebeccaSellBot',
    });
    expect(merged.displayVersion).toBe('v0.3.0');
    expect(buildReleaseLink(merged)).toBe(
      'https://github.com/Ho3einK84/RebeccaSellBot/releases/tag/v0.3.0'
    );

    const devLink = buildReleaseLink({
      name: 'RebeccaSellBot',
      version: '0.3.0',
      displayVersion: 'v0.3.0-dev.3',
      channel: 'dev',
      branch: 'dev',
      commit: '6d9c285',
      repositoryUrl: 'https://github.com/Ho3einK84/RebeccaSellBot',
    });
    expect(devLink).toBe('https://github.com/Ho3einK84/RebeccaSellBot/commit/6d9c285');

    const faKeys = Object.keys(webappFa.version).sort();
    const enKeys = Object.keys(webappEn.version ?? {}).sort();
    expect(enKeys).toEqual(faKeys);
  });
});

describe('Documentation Version Sync Guard', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const trackedDocs = [
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/architecture.md',
    'docs/configuration.md',
    'docs/deployment.md',
    'docs/telegram-architecture.md',
    'docs/webapp-architecture.md',
  ] as const;

  it('keeps every tracked doc synced with package.json version and CHANGELOG.md', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    const normalizedVersion = pkg.version.trim().replace(/^v/iu, '').split('+')[0]!;
    const expectedSyncVersion = `v${normalizedVersion}`;

    for (const docPath of trackedDocs) {
      const content = await readFile(path.join(repoRoot, docPath), 'utf8');
      const match =
        /^\s*>\s*\*\*Last synced with version:\*\*\s*`(v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)`\s*$/mu.exec(
          content
        );
      expect(match?.[1], `${docPath} must be synced with ${expectedSyncVersion}`).toBe(
        expectedSyncVersion
      );
    }

    if (!normalizedVersion.includes('-')) {
      const changelog = await readFile(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
      const escaped = normalizedVersion.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      expect(changelog).toMatch(new RegExp(`^## \\[${escaped}\\](?:\\s|$)`, 'mu'));
    }
  });
});
