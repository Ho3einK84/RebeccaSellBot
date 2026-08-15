import { describe, expect, it, vi } from 'vitest';
import { customVolumeEnabled } from '../../src/domain/services/FeatureSettings.js';

function settings(value?: string) {
  return {
    getSetting: vi.fn((_key: string, fallback = '') => value ?? fallback),
  };
}

describe('customVolumeEnabled', () => {
  it('preserves the existing enabled behavior when no database value exists', () => {
    expect(customVolumeEnabled(settings())).toBe(true);
  });

  it('only disables the feature for an explicit false value', () => {
    expect(customVolumeEnabled(settings('true'))).toBe(true);
    expect(customVolumeEnabled(settings('false'))).toBe(false);
    expect(customVolumeEnabled(settings(' FALSE '))).toBe(false);
    expect(customVolumeEnabled(settings('0'))).toBe(false);
  });
});
