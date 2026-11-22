import { describe, expect, it, vi } from 'vitest';
import {
  buildClaimedMetadataJson,
  runForAppFallbackNudgeCycle,
  type ForAppFallbackCandidate,
  type ForAppFallbackNudgeStore,
} from '../../src/jobs/forappFallbackNudge.js';
import { FORAPP_MANUAL_HINT_DELAY_MS } from '../../src/domain/services/AutomatedPaymentService.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';

function createTranslationService(forappEnabledValue: 'true' | 'false' = 'true') {
  const ts = new TranslationService();
  vi.spyOn(ts, 'getSetting').mockImplementation((key, fallback = '') => {
    if (key === 'forapp_enabled') return forappEnabledValue;
    return fallback;
  });
  return ts;
}

describe('ForApp 5-minute manual-receipt fallback nudge worker', () => {
  it('merges manualHintSentAt cleanly into existing or null metadata JSON', () => {
    const now = new Date('2026-11-22T22:55:00.000Z');
    expect(JSON.parse(buildClaimedMetadataJson(null, now))).toEqual({
      manualHintSentAt: '2026-11-22T22:55:00.000Z',
    });
    expect(JSON.parse(buildClaimedMetadataJson('{"source":"telegram"}', now))).toEqual({
      source: 'telegram',
      manualHintSentAt: '2026-11-22T22:55:00.000Z',
    });
    expect(JSON.parse(buildClaimedMetadataJson('not-json', now))).toEqual({
      manualHintSentAt: '2026-11-22T22:55:00.000Z',
    });
  });

  it('delivers a single manual-receipt fallback hint once 5 minutes pass and claims atomically first', async () => {
    const now = new Date('2026-11-22T23:00:00.000Z');
    const candidate: ForAppFallbackCandidate = {
      id: 'po_1795387000_ab12',
      telegramId: 55555,
      payableAmount: 49_104,
      metadata: null,
      createdAt: new Date(now.getTime() - FORAPP_MANUAL_HINT_DELAY_MS - 15_000),
      expiresAt: new Date(now.getTime() + 14 * 60 * 1000),
      locale: 'fa',
    };

    const callOrder: string[] = [];
    const store: ForAppFallbackNudgeStore = {
      listCandidates: vi.fn(async () => [candidate]),
      claimManualHint: vi.fn(async () => {
        callOrder.push('claim');
        return true;
      }),
    };
    const telegramApi = {
      sendMessage: vi.fn(async () => {
        callOrder.push('send');
        return { message_id: 101 } as never;
      }),
    };

    const summary = await runForAppFallbackNudgeCycle(
      {
        translationService: createTranslationService('true'),
        telegramApi,
        store,
      },
      now
    );

    expect(summary).toEqual({
      enabled: true,
      checked: 1,
      nudged: 1,
      skippedErrors: 0,
    });
    expect(callOrder).toEqual(['claim', 'send']);
    expect(telegramApi.sendMessage).toHaveBeenCalledTimes(1);

    const [chatId, text, options] = telegramApi.sendMessage.mock.calls[0] as unknown as [
      number,
      string,
      { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } },
    ];
    expect(chatId).toBe(55555);
    expect(text).toContain('راهنمای تأیید واریز');
    expect(text).toContain('۴۹٬۱۰۴');
    const buttons = options?.reply_markup?.inline_keyboard?.flat() ?? [];
    expect(buttons.some((b) => b.callback_data === 'porder:manual:po_1795387000_ab12')).toBe(true);
    expect(buttons.some((b) => b.callback_data === 'porder:check:po_1795387000_ab12')).toBe(true);
    expect(buttons.some((b) => b.callback_data === 'ui:dismiss')).toBe(true);
  });

  it('skips young orders, expired orders, and orders whose atomic claim fails', async () => {
    const now = new Date('2026-11-22T23:00:00.000Z');
    const candidates: ForAppFallbackCandidate[] = [
      {
        id: 'po_too_fresh',
        telegramId: 111,
        payableAmount: 50_000,
        metadata: null,
        createdAt: new Date(now.getTime() - 2 * 60 * 1000),
        expiresAt: new Date(now.getTime() + 18 * 60 * 1000),
      },
      {
        id: 'po_expired',
        telegramId: 222,
        payableAmount: 50_000,
        metadata: null,
        createdAt: new Date(now.getTime() - 25 * 60 * 1000),
        expiresAt: new Date(now.getTime() - 1000),
      },
      {
        id: 'po_already_claimed',
        telegramId: 333,
        payableAmount: 50_000,
        metadata: null,
        createdAt: new Date(now.getTime() - 6 * 60 * 1000),
        expiresAt: new Date(now.getTime() + 14 * 60 * 1000),
      },
    ];

    const store: ForAppFallbackNudgeStore = {
      listCandidates: vi.fn(async () => candidates),
      claimManualHint: vi.fn(async () => false),
    };
    const telegramApi = { sendMessage: vi.fn() };

    const summary = await runForAppFallbackNudgeCycle(
      {
        translationService: createTranslationService('true'),
        telegramApi,
        store,
      },
      now
    );

    expect(summary).toEqual({
      enabled: true,
      checked: 1,
      nudged: 0,
      skippedErrors: 0,
    });
    expect(store.claimManualHint).toHaveBeenCalledTimes(1);
    expect(telegramApi.sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing when ForApp is disabled', async () => {
    const store: ForAppFallbackNudgeStore = {
      listCandidates: vi.fn(async () => []),
      claimManualHint: vi.fn(async () => true),
    };
    const telegramApi = { sendMessage: vi.fn() };

    const summary = await runForAppFallbackNudgeCycle({
      translationService: createTranslationService('false'),
      telegramApi,
      store,
    });

    expect(summary).toEqual({
      enabled: false,
      checked: 0,
      nudged: 0,
      skippedErrors: 0,
    });
    expect(store.listCandidates).not.toHaveBeenCalled();
  });
});
