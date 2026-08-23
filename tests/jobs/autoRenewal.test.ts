import { describe, expect, it, vi } from 'vitest';
import type { Api } from 'grammy';
import {
  runAutoRenewalSweep,
  type AutoRenewalCandidate,
  type AutoRenewalCandidateStore,
} from '../../src/jobs/autoRenewal.js';
import { RebeccaOriginDownError } from '../../src/domain/services/RebeccaService.js';
import type { RebeccaService } from '../../src/domain/services/RebeccaService.js';
import type { WalletService } from '../../src/domain/services/WalletService.js';
import type { PricingService } from '../../src/domain/services/PricingService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import type { NotificationDeliveryStore } from '../../src/jobs/notifier.js';

const GB = 1024 ** 3;
const NOW = new Date('2026-01-01T00:00:00Z');
const PACKAGE = {
  id: 'pkg_30gb_30d',
  name: '30 GB - 30 Days',
  gbAmount: 30,
  durationDays: 30,
  price: 120_000,
};
const CANDIDATE: AutoRenewalCandidate = {
  configUsername: 'alice',
  telegramId: 77,
  locale: 'en',
  autoRenewPackageId: PACKAGE.id,
};

function remoteUser(overrides: Record<string, unknown> = {}) {
  return {
    username: 'alice',
    status: 'active',
    used_traffic: 9 * GB,
    lifetime_used_traffic: 9 * GB,
    data_limit: 10 * GB,
    expire: Math.floor(NOW.getTime() / 1000) + 86_400,
    created_at: '2026-01-01T00:00:00Z',
    subscription_url: 'https://sub.example/alice',
    subscription_urls: {},
    links: [],
    proxies: {},
    inbounds: {},
    note: null,
    telegram_id: null,
    sub_updated_at: null,
    online_at: null,
    ip_limit: 0,
    service_id: 1,
    service_name: 'default',
    admin_username: 'admin',
    ...overrides,
  };
}

function candidateStore(candidates = [CANDIDATE]): AutoRenewalCandidateStore {
  return {
    listEnabledConfigs: vi.fn().mockResolvedValue(candidates),
    disableAutoRenew: vi.fn().mockResolvedValue(undefined),
  };
}

function deliveryStore(reserved = true): NotificationDeliveryStore {
  let available = reserved;
  return {
    listConfigs: vi.fn().mockResolvedValue([]),
    reserve: vi.fn().mockImplementation(() => {
      if (!available) return Promise.resolve(false);
      available = false;
      return Promise.resolve(true);
    }),
    deactivate: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockImplementation(() => {
      available = reserved;
      return Promise.resolve();
    }),
  };
}

function services(
  overrides: {
    candidates?: AutoRenewalCandidate[];
    balance?: number;
    remote?: object;
    getUserError?: Error;
    sagaError?: Error;
    reserved?: boolean;
  } = {}
) {
  const getUser = overrides.getUserError
    ? vi.fn().mockRejectedValue(overrides.getUserError)
    : vi.fn().mockResolvedValue(overrides.remote ?? remoteUser());
  const executePurchaseSaga = overrides.sagaError
    ? vi.fn().mockRejectedValue(overrides.sagaError)
    : vi.fn().mockResolvedValue({ success: true, configUsername: 'alice' });
  const telegramApi = { sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }) };
  const translations = {
    getSettingNum: vi.fn((_key: string, fallback: number) => fallback),
    resolveLocale: vi.fn(() => 'fa'),
    get: vi.fn((key: string) => key),
  };
  return {
    candidateStore: candidateStore(overrides.candidates),
    deliveryStore: deliveryStore(overrides.reserved),
    rebeccaService: { getUser } as unknown as RebeccaService,
    walletService: {
      getBalance: vi.fn().mockResolvedValue(overrides.balance ?? PACKAGE.price),
      executePurchaseSaga,
    } as unknown as WalletService,
    pricingService: {
      getPackages: vi.fn(() => [PACKAGE]),
      getPackageById: vi.fn((id: string) => (id === PACKAGE.id ? PACKAGE : undefined)),
    } as unknown as PricingService,
    translationService: translations as unknown as TranslationService,
    telegramApi: telegramApi as unknown as Api,
    getUser,
    executePurchaseSaga,
    telegramApi,
  };
}

async function run(ctx: ReturnType<typeof services>) {
  return runAutoRenewalSweep(
    ctx.rebeccaService,
    ctx.walletService,
    ctx.pricingService,
    ctx.translationService,
    ctx.telegramApi,
    ctx.candidateStore,
    ctx.deliveryStore,
    NOW
  );
}

describe('runAutoRenewalSweep', () => {
  it('renews a due config from its wallet with the current package values', async () => {
    const ctx = services();

    await expect(run(ctx)).resolves.toEqual({ checked: 1, renewed: 1, skipped: 0 });
    expect(ctx.executePurchaseSaga).toHaveBeenCalledWith({
      telegramId: 77,
      amount: 120_000,
      type: 'renew_config',
      configUsername: 'alice',
      gbAmount: 30,
      durationDays: 30,
    });
    expect(ctx.telegramApi.sendMessage).toHaveBeenCalledWith(
      77,
      expect.stringContaining('auto_renew_success_title'),
      expect.objectContaining({ parse_mode: 'Markdown', reply_markup: expect.anything() })
    );
  });

  it('deduplicates the low-balance notice across sweeps', async () => {
    const ctx = services({ balance: PACKAGE.price - 1, reserved: true });

    await run(ctx);
    await run(ctx);

    expect(ctx.deliveryStore.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: CANDIDATE.telegramId,
        configUsername: CANDIDATE.configUsername,
      }),
      'auto_renew_low_balance',
      NOW
    );
    expect(ctx.telegramApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(ctx.executePurchaseSaga).not.toHaveBeenCalled();
  });

  it('sends auto_renew_package_unavailable notice and reserves auto_renew_package_missing when package is missing', async () => {
    const missingPkgCandidate = { ...CANDIDATE, autoRenewPackageId: 'removed_package_id' };
    const ctx = services({ candidates: [missingPkgCandidate], reserved: true });

    await run(ctx);

    expect(ctx.deliveryStore.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: CANDIDATE.telegramId,
        configUsername: CANDIDATE.configUsername,
      }),
      'auto_renew_package_missing',
      NOW
    );
    expect(ctx.telegramApi.sendMessage).toHaveBeenCalledWith(
      77,
      expect.stringContaining('auto_renew_package_unavailable_title'),
      expect.objectContaining({ parse_mode: 'Markdown', reply_markup: expect.anything() })
    );
    expect(ctx.candidateStore.disableAutoRenew).toHaveBeenCalledWith(missingPkgCandidate);
    expect(ctx.executePurchaseSaga).not.toHaveBeenCalled();
  });

  it('skips configs that are not due', async () => {
    const ctx = services({
      remote: remoteUser({
        used_traffic: 0,
        expire: Math.floor(NOW.getTime() / 1000) + 30 * 86_400,
      }),
    });

    await expect(run(ctx)).resolves.toEqual({ checked: 1, renewed: 0, skipped: 1 });
    expect(ctx.executePurchaseSaga).not.toHaveBeenCalled();
  });

  it('skips a config in a non-renewable Rebecca status', async () => {
    const ctx = services({ remote: remoteUser({ status: 'deleted' }) });

    await expect(run(ctx)).resolves.toEqual({ checked: 1, renewed: 0, skipped: 1 });
    expect(ctx.executePurchaseSaga).not.toHaveBeenCalled();
  });

  it('isolates an ordinary config failure and continues the sweep', async () => {
    const second = { ...CANDIDATE, configUsername: 'bob' };
    const ctx = services({ candidates: [CANDIDATE, second] });
    ctx.getUser
      .mockRejectedValueOnce(new Error('bad config'))
      .mockResolvedValueOnce(remoteUser({ username: 'bob' }));

    await expect(run(ctx)).resolves.toEqual({ checked: 2, renewed: 1, skipped: 1 });
    expect(ctx.executePurchaseSaga).toHaveBeenCalledTimes(1);
  });

  it('isolates an unavailable panel and continues checking other configs on healthy panels', async () => {
    const second = { ...CANDIDATE, panelId: 'panel_b', configUsername: 'bob' };
    const originDown = new RebeccaOriginDownError('GET /api/user/alice', 521, 5);
    const ctx = services({ candidates: [CANDIDATE, second], getUserError: originDown });

    await expect(run(ctx)).resolves.toEqual({ checked: 2, renewed: 0, skipped: 2 });
    expect(ctx.getUser).toHaveBeenCalledTimes(2);
    expect(ctx.executePurchaseSaga).not.toHaveBeenCalled();
  });

  it('skips subsequent configs on the same down panel without redundant network calls', async () => {
    const second = { ...CANDIDATE, configUsername: 'bob' };
    const originDown = new RebeccaOriginDownError('GET /api/user/alice', 521, 5);
    const ctx = services({ candidates: [CANDIDATE, second], getUserError: originDown });

    await expect(run(ctx)).resolves.toEqual({ checked: 2, renewed: 0, skipped: 2 });
    expect(ctx.getUser).toHaveBeenCalledTimes(1);
    expect(ctx.executePurchaseSaga).not.toHaveBeenCalled();
  });
});
