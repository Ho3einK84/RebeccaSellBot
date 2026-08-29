import { describe, expect, it } from 'vitest';
import {
  buildTopupPresets,
  formatCardNumberGrouped,
} from '../../src/telegram/conversations/adminConversations/wallet.js';

describe('Topup Helpers', () => {
  it('formats 16-digit card number with 4-digit groups', () => {
    expect(formatCardNumberGrouped('6037991812345678')).toBe('6037 9918 1234 5678');
    expect(formatCardNumberGrouped('6037-9918-1234-5678')).toBe('6037 9918 1234 5678');
    expect(formatCardNumberGrouped('12345')).toBe('12345');
  });

  it('builds dynamic topup presets within min and max bounds', () => {
    const presets10k = buildTopupPresets(10_000, 10_000_000);
    expect(presets10k).toEqual([10_000, 20_000, 50_000, 100_000]);

    const presets100k = buildTopupPresets(100_000, 1_000_000);
    expect(presets100k).toEqual([100_000, 200_000, 500_000, 1_000_000]);

    const tightBounds = buildTopupPresets(50_000, 60_000);
    expect(tightBounds).toEqual([50_000]);
  });
});
