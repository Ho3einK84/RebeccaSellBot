import { describe, expect, it } from 'vitest';
import {
  buildTopupPresets,
  formatCardNumberGrouped,
} from '../../src/telegram/conversations/adminConversations/wallet.js';

describe('Topup Helpers', () => {
  it('formats 16-digit card number with 4-digit groups using spaces and LRM for BiDi stability', () => {
    expect(formatCardNumberGrouped('6037991812345678')).toBe(
      '\u200E6037 \u200E9918 \u200E1234 \u200E5678'
    );
    expect(formatCardNumberGrouped('6037-9918-1234-5678')).toBe(
      '\u200E6037 \u200E9918 \u200E1234 \u200E5678'
    );
    expect(formatCardNumberGrouped('12345')).toBe('12345');
  });

  it('builds dynamic topup presets within min and max bounds', () => {
    const presetsDefault = buildTopupPresets(10_000, 10_000_000);
    expect(presetsDefault).toEqual([50_000, 100_000, 200_000, 500_000]);

    const presets100k = buildTopupPresets(100_000, 1_000_000);
    expect(presets100k).toEqual([100_000, 200_000, 500_000]);

    const tightBounds = buildTopupPresets(50_000, 60_000);
    expect(tightBounds).toEqual([50_000]);
  });
});
