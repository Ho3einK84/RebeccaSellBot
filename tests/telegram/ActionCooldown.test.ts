import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireUserActionCooldown,
  resetActionCooldowns,
} from '../../src/telegram/middleware/actionCooldown.js';

afterEach(() => {
  resetActionCooldowns();
  vi.useRealTimers();
});

describe('action-specific cooldowns', () => {
  it('blocks a repeated renewal but keeps different users independent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    expect(acquireUserActionCooldown(100, 'renewal', 5_000)).toBe(true);
    expect(acquireUserActionCooldown(100, 'renewal', 5_000)).toBe(false);
    expect(acquireUserActionCooldown(101, 'renewal', 5_000)).toBe(true);

    vi.advanceTimersByTime(5_000);
    expect(acquireUserActionCooldown(100, 'renewal', 5_000)).toBe(true);
  });
});
