import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/infra/db.js';
import {
  calculateLuckyWheelPrize,
  calculateEffectiveLuck,
  LuckyWheelService,
} from '../../src/domain/services/LuckyWheelService.js';
import type { TranslationService } from '../../src/domain/services/TranslationService.js';

vi.mock('../../src/infra/db.js', () => ({ getDb: vi.fn() }));

describe('LuckyWheel Calculations', () => {
  it('calculates effective luck with diminishing decay', () => {
    // base 50%, decay 10%
    expect(calculateEffectiveLuck(50, 10, 0)).toBe(50);
    expect(calculateEffectiveLuck(50, 10, 1)).toBe(40);
    expect(calculateEffectiveLuck(50, 10, 2)).toBe(30);
    expect(calculateEffectiveLuck(50, 10, 4)).toBe(10);
    // minimum clamped at 5%
    expect(calculateEffectiveLuck(50, 10, 10)).toBe(5);
  });

  it('calculates prize within bounds based on random draw and luck', () => {
    const min = 1000;
    const max = 50000;

    // random = 0 gives minimum
    expect(calculateLuckyWheelPrize(min, max, 50, 0)).toBe(min);

    // random = 1 gives maximum
    expect(calculateLuckyWheelPrize(min, max, 50, 1)).toBe(max);

    // higher luck yields higher prize for same random number
    const highLuckPrize = calculateLuckyWheelPrize(min, max, 90, 0.5);
    const lowLuckPrize = calculateLuckyWheelPrize(min, max, 10, 0.5);
    expect(highLuckPrize).toBeGreaterThan(lowLuckPrize);

    // always rounded to multiple of 1000
    for (let r = 0; r <= 1; r += 0.05) {
      const prize = calculateLuckyWheelPrize(min, max, 50, r);
      expect(prize % 1000).toBe(0);
    }
  });
});

describe('LuckyWheelService', () => {
  const getDbMock = vi.mocked(getDb);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  function createMockTranslationService(settings: Record<string, string | number> = {}) {
    return {
      getSetting: vi.fn((key: string, fallback: string) => String(settings[key] ?? fallback)),
      getSettingNum: vi.fn((key: string, fallback: number) => Number(settings[key] ?? fallback)),
    } as unknown as TranslationService;
  }

  it('returns disabled status when lucky_wheel_enabled is false', async () => {
    const ts = createMockTranslationService({ lucky_wheel_enabled: 'false' });
    const service = new LuckyWheelService(ts);

    const status = await service.getStatus(12345);
    expect(status.enabled).toBe(false);
    expect(status.canSpin).toBe(false);
    expect(status.reason).toBe('disabled');
  });

  it('detects max spins reached', async () => {
    const ts = createMockTranslationService({ lucky_wheel_max_spins: 3 });
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockResolvedValueOnce([{ count: 3 }]),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              orderBy: vi.fn().mockReturnValueOnce({
                limit: vi
                  .fn()
                  .mockResolvedValueOnce([{ createdAt: new Date(Date.now() - 86400 * 1000) }]),
              }),
            }),
          }),
        }),
    };
    getDbMock.mockReturnValue(mockDb as any);

    const service = new LuckyWheelService(ts);
    const status = await service.getStatus(12345);

    expect(status.canSpin).toBe(false);
    expect(status.reason).toBe('max_spins_reached');
    expect(status.totalSpins).toBe(3);
  });

  it('detects active cooldown', async () => {
    const ts = createMockTranslationService({
      lucky_wheel_max_spins: 5,
      lucky_wheel_cooldown_hours: 24,
    });
    const recentDate = new Date(Date.now() - 3600 * 1000); // 1 hour ago
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockResolvedValueOnce([{ count: 1 }]),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              orderBy: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([{ createdAt: recentDate }]),
              }),
            }),
          }),
        }),
    };
    getDbMock.mockReturnValue(mockDb as any);

    const service = new LuckyWheelService(ts);
    const status = await service.getStatus(12345);

    expect(status.canSpin).toBe(false);
    expect(status.reason).toBe('cooldown_active');
    expect(status.secondsRemaining).toBeGreaterThan(0);
  });
});
