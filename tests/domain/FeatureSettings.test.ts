import { describe, expect, it, vi } from 'vitest';
import {
  customVolumeEnabled,
  walletTransferEnabled,
  walletTransferMinAmount,
} from '../../src/domain/services/FeatureSettings.js';

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

describe('walletTransferEnabled', () => {
  it('defaults to true when no setting row exists', () => {
    expect(walletTransferEnabled(settings())).toBe(true);
  });

  it('correctly disables when configured as false', () => {
    expect(walletTransferEnabled(settings('false'))).toBe(false);
    expect(walletTransferEnabled(settings('0'))).toBe(false);
    expect(walletTransferEnabled(settings('true'))).toBe(true);
  });
});

describe('walletTransferMinAmount', () => {
  it('returns default 5000 when unset', () => {
    expect(walletTransferMinAmount(settings())).toBe(5000);
  });

  it('returns configured positive integer', () => {
    expect(walletTransferMinAmount(settings('10000'))).toBe(10000);
    expect(walletTransferMinAmount(settings('invalid'))).toBe(5000);
  });
});
