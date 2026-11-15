import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import {
  calculateEffectiveLuck,
  calculateLuckyWheelPrize,
  LuckyWheelService,
} from '../../src/domain/services/LuckyWheelService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';
import { createMockDb } from './_helpers/mockDb.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../src/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('LuckyWheelService', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockTranslationService(
    settings: Record<string, string | number> = {},
    withBoolHelper = false
  ) {
    const base = {
      getSetting: vi.fn((key: string, fallback: string) => String(settings[key] ?? fallback)),
      getSettingNum: vi.fn((key: string, fallback: number) => {
        const val = settings[key];
        return val !== undefined ? Number(val) : fallback;
      }),
    };
    if (withBoolHelper) {
      return {
        ...base,
        getSettingBool: vi.fn((key: string, fallback = false) => {
          const val = settings[key];
          if (val === undefined) return fallback;
          const norm = String(val).trim().toLowerCase();
          if (norm === 'true' || norm === '1') return true;
          if (norm === 'false' || norm === '0') return false;
          return fallback;
        }),
      } as unknown as TranslationService;
    }
    return base as unknown as TranslationService;
  }

  describe('pure calculations', () => {
    it('calculates effective luck with diminishing decay clamped at 5%', () => {
      expect(calculateEffectiveLuck(50, 10, 0)).toBe(50);
      expect(calculateEffectiveLuck(50, 10, 1)).toBe(40);
      expect(calculateEffectiveLuck(50, 10, 2)).toBe(30);
      expect(calculateEffectiveLuck(50, 10, 4)).toBe(10);
      expect(calculateEffectiveLuck(50, 10, 10)).toBe(5);
    });

    it('calculates prize within [min, max], scaled by luck, rounded to multiples of 1000', () => {
      const min = 1_000;
      const max = 50_000;
      expect(calculateLuckyWheelPrize(min, max, 50, 0)).toBe(min);
      expect(calculateLuckyWheelPrize(min, max, 50, 1)).toBe(max);
      expect(calculateLuckyWheelPrize(min, max, 90, 0.5)).toBeGreaterThan(
        calculateLuckyWheelPrize(min, max, 10, 0.5)
      );
      for (let r = 0; r <= 1; r += 0.05) {
        expect(calculateLuckyWheelPrize(min, max, 50, r) % 1000).toBe(0);
      }
    });
  });

  describe('getStatus', () => {
    it('returns disabled status for false, "0", or getSettingBool() false without hitting DB', async () => {
      for (const flag of ['false', ' FALSE ', '0']) {
        const service = new LuckyWheelService(
          createMockTranslationService({ lucky_wheel_enabled: flag }, flag === 'false')
        );
        const status = await service.getStatus(12345);
        expect(status.enabled).toBe(false);
        expect(status.canSpin).toBe(false);
        expect(status.reason).toBe('disabled');
        expect(getDbMock).not.toHaveBeenCalled();
      }
    });

    it('detects banned user, max spins reached, active cooldown, and eligible state', async () => {
      const ts = createMockTranslationService({
        lucky_wheel_enabled: '1',
        lucky_wheel_max_spins: 3,
        lucky_wheel_cooldown_hours: 24,
      });

      const bannedDb = createMockDb({ selectResults: [[{ isBanned: true }]] });
      getDbMock.mockReturnValue(bannedDb.db as never);
      await expect(new LuckyWheelService(ts).getStatus(12345)).resolves.toMatchObject({
        canSpin: false,
        reason: 'user_banned',
      });

      const maxedDb = createMockDb({
        selectResults: [
          [{ isBanned: false }],
          [{ count: 3 }],
          [{ createdAt: new Date(Date.now() - 86_400_000) }],
        ],
      });
      getDbMock.mockReturnValue(maxedDb.db as never);
      await expect(new LuckyWheelService(ts).getStatus(12345)).resolves.toMatchObject({
        canSpin: false,
        reason: 'max_spins_reached',
        totalSpins: 3,
      });

      const cooldownDb = createMockDb({
        selectResults: [
          [{ isBanned: false }],
          [{ count: 1 }],
          [{ createdAt: new Date(Date.now() - 3_600_000) }],
        ],
      });
      getDbMock.mockReturnValue(cooldownDb.db as never);
      const cooldownStatus = await new LuckyWheelService(ts).getStatus(12345);
      expect(cooldownStatus.canSpin).toBe(false);
      expect(cooldownStatus.reason).toBe('cooldown_active');
      expect(cooldownStatus.secondsRemaining).toBeGreaterThan(0);

      const readyDb = createMockDb({
        selectResults: [[{ isBanned: false }], [{ count: 1 }], []],
      });
      getDbMock.mockReturnValue(readyDb.db as never);
      await expect(new LuckyWheelService(ts).getStatus(12345)).resolves.toMatchObject({
        enabled: true,
        canSpin: true,
        totalSpins: 1,
        maxSpins: 3,
      });
    });
  });

  describe('spin', () => {
    it('enforces disabled, missing user, banned user, max spins, and cooldown guards', async () => {
      const disabledService = new LuckyWheelService(
        createMockTranslationService({ lucky_wheel_enabled: '0' })
      );
      getDbMock.mockReturnValue(createMockDb().db as never);
      await expect(disabledService.spin(10)).rejects.toThrow('LUCKY_WHEEL_DISABLED');

      const enabledService = new LuckyWheelService(
        createMockTranslationService({
          lucky_wheel_enabled: 'true',
          lucky_wheel_max_spins: 2,
          lucky_wheel_cooldown_hours: 24,
        })
      );

      getDbMock.mockReturnValue(createMockDb({ selectResults: [[]] }).db as never);
      await expect(enabledService.spin(10)).rejects.toThrow('USER_NOT_FOUND');

      getDbMock.mockReturnValue(
        createMockDb({ selectResults: [[{ telegramId: 10, balance: 0, isBanned: true }]] })
          .db as never
      );
      await expect(enabledService.spin(10)).rejects.toThrow('USER_BANNED');

      getDbMock.mockReturnValue(
        createMockDb({
          selectResults: [[{ telegramId: 10, balance: 0, isBanned: false }], [{ count: 2 }]],
        }).db as never
      );
      await expect(enabledService.spin(10)).rejects.toThrow('MAX_SPINS_REACHED');

      getDbMock.mockReturnValue(
        createMockDb({
          selectResults: [
            [{ telegramId: 10, balance: 0, isBanned: false }],
            [{ count: 1 }],
            [{ createdAt: new Date(Date.now() - 60_000) }],
          ],
        }).db as never
      );
      await expect(enabledService.spin(10)).rejects.toThrow('COOLDOWN_ACTIVE');
    });

    it('rejects safe-integer balance overflow before mutating user balance and does not invalidate on rollback', async () => {
      const ts = createMockTranslationService({
        lucky_wheel_enabled: 'true',
        lucky_wheel_min_amount: 5_000,
        lucky_wheel_max_amount: 5_000,
      });
      const hook = vi.fn();
      const service = new LuckyWheelService(ts);
      service.registerInvalidationHook(hook);

      const overflowDb = createMockDb({
        selectResults: [
          [{ telegramId: 10, balance: Number.MAX_SAFE_INTEGER, isBanned: false }],
          [{ count: 0 }],
          [],
        ],
      });
      getDbMock.mockReturnValue(overflowDb.db as never);

      await expect(service.spin(10)).rejects.toThrow('BALANCE_OVERFLOW');
      expect(overflowDb.state.rolledBackTransactions).toBe(1);
      expect(hook).not.toHaveBeenCalled();
    });

    it('records spin, credits wallet atomically in SQL, writes wallet ledger, and invokes hook post-commit', async () => {
      const ts = createMockTranslationService(
        {
          lucky_wheel_enabled: '1',
          lucky_wheel_min_amount: 10_000,
          lucky_wheel_max_amount: 10_000,
          lucky_wheel_base_luck_percent: 60,
          lucky_wheel_decay_percent: 10,
          lucky_wheel_max_spins: 5,
          lucky_wheel_cooldown_hours: 12,
        },
        true
      );

      const hookOrder: string[] = [];
      const mock = createMockDb({
        selectResults: [
          [{ telegramId: 77, balance: 25_000, isBanned: false }],
          [{ count: 1 }],
          [{ createdAt: new Date(Date.now() - 13 * 3_600_000) }],
        ],
        returningResults: [[{ balance: 35_000 }]],
      });
      const origTx = mock.db.transaction as ReturnType<typeof vi.fn>;
      mock.db.transaction = vi.fn(async (cb) => {
        const res = await origTx(cb);
        hookOrder.push('committed');
        return res;
      });
      getDbMock.mockReturnValue(mock.db as never);

      const service = new LuckyWheelService(ts);
      service.registerInvalidationHook(() => {
        hookOrder.push('invalidated');
      });

      const result = await service.spin(77);
      expect(result).toMatchObject({
        success: true,
        amount: 10_000,
        balanceAfter: 35_000,
        spinNumber: 2,
        spinsRemaining: 3,
        effectiveLuckPercent: 50,
      });
      expect(mock.state.selectCalls[0]?.lock).toBe('update');
      expect(mock.state.insertCalls).toHaveLength(2);
      expect(mock.state.insertCalls[0]?.values).toMatchObject({
        telegramId: 77,
        amount: 10_000,
        effectiveLuckPercent: 50,
        spinNumber: 2,
      });
      expect(mock.state.insertCalls[1]?.values).toMatchObject({
        telegramId: 77,
        amount: 10_000,
        balanceAfter: 35_000,
        type: 'lucky_wheel',
      });
      expect(hookOrder).toEqual(['committed', 'invalidated']);
    });
  });
});
