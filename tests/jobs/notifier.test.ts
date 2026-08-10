import { describe, expect, it, vi } from 'vitest';
import type { Api } from 'grammy';
import {
  assessNotificationConditions,
  runNotifierSweep,
  type ConfigNotificationRecipient,
  type NotificationDeliveryStore,
} from '../../src/jobs/notifier.js';
import type {
  RebeccaService,
  RebeccaUserDetail,
} from '../../src/domain/services/RebeccaService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

const GB = 1024 ** 3;
const NOW = new Date('2026-01-01T00:00:00Z');
const RECIPIENT = { telegramId: 77, configUsername: 'alice' };

function remoteUser(overrides: Partial<RebeccaUserDetail> = {}): RebeccaUserDetail {
  return {
    username: 'alice',
    status: 'active',
    used_traffic: 0,
    lifetime_used_traffic: 0,
    data_limit: 10 * GB,
    expire: Math.floor(NOW.getTime() / 1000) + 3 * 86_400,
    created_at: '2026-01-01T00:00:00Z',
    subscription_url: 'https://sub.example/sub/abcdef0123456789abcdef0123456789',
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

function deliveryStore(
  reserve: (type: 'low_traffic' | 'near_expiry') => boolean | Promise<boolean>,
  recipients: ConfigNotificationRecipient | ConfigNotificationRecipient[] = RECIPIENT
): NotificationDeliveryStore & {
  reserveMock: ReturnType<typeof vi.fn>;
  deactivateMock: ReturnType<typeof vi.fn>;
  releaseMock: ReturnType<typeof vi.fn>;
} {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  const reserveMock = vi.fn(async (_recipient: unknown, type: 'low_traffic' | 'near_expiry') =>
    reserve(type)
  );
  const deactivateMock = vi.fn().mockResolvedValue(undefined);
  const releaseMock = vi.fn().mockResolvedValue(undefined);
  return {
    listConfigs: vi.fn().mockImplementation(async () => list.filter((r) => !r.autoRenewEnabled)),
    reserve: reserveMock,
    deactivate: deactivateMock,
    release: releaseMock,
    reserveMock,
    deactivateMock,
    releaseMock,
  };
}

function translationService(overrides: Partial<Record<string, number>> = {}) {
  return {
    getSettingNum: vi.fn((key: string, fallback: number) => overrides[key] ?? fallback),
    resolveLocale: vi.fn(() => 'fa'),
    get: vi.fn(
      (
        key: string,
        locale: string,
        params: Record<string, string | number> | undefined = undefined
      ) => {
        if (key === 'renewal_button') return locale === 'en' ? 'Renew' : 'تمدید';
        if (key === 'renewal_reason_low_traffic') {
          return locale === 'en'
            ? `Remaining data: ${params?.['remaining']}`
            : `حجم باقی‌مانده: ${params?.['remaining']}`;
        }
        if (key === 'renewal_reason_near_expiry') {
          return locale === 'en'
            ? `Time remaining: ${params?.['remaining']}`
            : `زمان باقی‌مانده: ${params?.['remaining']}`;
        }
        if (key === 'renewal_notification') {
          return locale === 'en'
            ? `Subscription ${params?.['username']} needs renewal.\n${params?.['reasons']}`
            : `اشتراک ${params?.['username']} نیاز به تمدید دارد.\n${params?.['reasons']}`;
        }
        return key;
      }
    ),
  };
}

describe('notifier thresholds and dedupe behavior', () => {
  it('uses strict low-traffic and bounded near-expiry thresholds', () => {
    const exactLowThreshold = assessNotificationConditions(remoteUser({ used_traffic: 8 * GB }), {
      thresholdGb: 2,
      expiryWarningDays: 3,
      now: NOW,
    });
    expect(exactLowThreshold.lowTraffic).toBe(false);
    expect(exactLowThreshold.nearExpiry).toBe(true);

    const belowLowThreshold = assessNotificationConditions(
      remoteUser({ used_traffic: 8 * GB + 1 }),
      { thresholdGb: 2, expiryWarningDays: 3, now: NOW }
    );
    expect(belowLowThreshold.lowTraffic).toBe(true);

    expect(
      assessNotificationConditions(remoteUser({ data_limit: null }), {
        thresholdGb: 2,
        expiryWarningDays: 3,
        now: NOW,
      }).lowTraffic
    ).toBe(false);
    expect(
      assessNotificationConditions(remoteUser({ expire: Math.floor(NOW.getTime() / 1000) - 1 }), {
        thresholdGb: 2,
        expiryWarningDays: 3,
        now: NOW,
      }).nearExpiry
    ).toBe(false);
  });

  it('sends a fresh expiry warning when traffic is already deduped', async () => {
    const store = deliveryStore((type) => type === 'near_expiry');
    const sendMessage = vi.fn().mockResolvedValue({});
    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue(remoteUser({ used_traffic: 9 * GB })),
    };
    const translations = translationService({ low_traffic_threshold_gb: 2 });

    await runNotifierSweep(
      rebeccaService as unknown as RebeccaService,
      translations as unknown as TranslationService,
      { sendMessage } as unknown as Api,
      store,
      NOW
    );

    expect(store.reserveMock).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledOnce();
    const body = String(sendMessage.mock.calls[0]?.[1]);
    expect(body).toContain('زمان باقی‌مانده');
    expect(body).not.toContain('حجم باقی‌مانده');
  });

  it('does not send hourly repeats when every active reason is deduped', async () => {
    const store = deliveryStore(() => false);
    const sendMessage = vi.fn().mockResolvedValue({});
    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue(remoteUser({ used_traffic: 9 * GB })),
    };
    const translations = translationService();

    await runNotifierSweep(
      rebeccaService as unknown as RebeccaService,
      translations as unknown as TranslationService,
      { sendMessage } as unknown as Api,
      store,
      NOW
    );

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('releases only undelivered reasons so the next sweep can retry', async () => {
    const store = deliveryStore((type) => type === 'low_traffic');
    const sendMessage = vi.fn().mockRejectedValue(new Error('bot was blocked'));
    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue(remoteUser({ used_traffic: 9 * GB })),
    };
    const translations = translationService();

    await runNotifierSweep(
      rebeccaService as unknown as RebeccaService,
      translations as unknown as TranslationService,
      { sendMessage } as unknown as Api,
      store,
      NOW
    );

    expect(store.releaseMock).toHaveBeenCalledWith(RECIPIENT, ['low_traffic'], expect.any(Date));
  });

  it('uses the persisted recipient locale for background notification copy', async () => {
    const englishRecipient = { ...RECIPIENT, locale: 'en' as const };
    const store = deliveryStore(() => true, englishRecipient);
    const sendMessage = vi.fn().mockResolvedValue({});
    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue(remoteUser({ used_traffic: 9 * GB })),
    };
    const translations = translationService();

    await runNotifierSweep(
      rebeccaService as unknown as RebeccaService,
      translations as unknown as TranslationService,
      { sendMessage } as unknown as Api,
      store,
      NOW
    );

    expect(translations.get).toHaveBeenCalledWith('renewal_button', 'en');
    expect(String(sendMessage.mock.calls[0]?.[1])).toContain('Subscription alice needs renewal.');
  });

  it('excludes configs with autoRenewEnabled = true from notifier sweep', async () => {
    const autoRenewRecipient = { ...RECIPIENT, autoRenewEnabled: true };
    const store = deliveryStore(() => true, autoRenewRecipient);
    const sendMessage = vi.fn().mockResolvedValue({});
    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue(remoteUser({ used_traffic: 9 * GB })),
    };
    const translations = translationService();

    await runNotifierSweep(
      rebeccaService as unknown as RebeccaService,
      translations as unknown as TranslationService,
      { sendMessage } as unknown as Api,
      store,
      NOW
    );

    expect(store.reserveMock).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('includes configs with autoRenewEnabled = false or unset in notifier sweep', async () => {
    const manualRecipient = { ...RECIPIENT, autoRenewEnabled: false };
    const store = deliveryStore(() => true, manualRecipient);
    const sendMessage = vi.fn().mockResolvedValue({});
    const rebeccaService = {
      getUser: vi.fn().mockResolvedValue(remoteUser({ used_traffic: 9 * GB })),
    };
    const translations = translationService();

    await runNotifierSweep(
      rebeccaService as unknown as RebeccaService,
      translations as unknown as TranslationService,
      { sendMessage } as unknown as Api,
      store,
      NOW
    );

    expect(store.reserveMock).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});
