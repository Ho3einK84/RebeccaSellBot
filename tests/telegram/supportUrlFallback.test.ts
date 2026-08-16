import { describe, expect, it, vi } from 'vitest';
import { resolveSupportInfo } from '../../src/telegram/keyboards/mainMenu.js';
import type { MenuContext } from '../../src/telegram/types.js';

describe('supportUrlFallback', () => {
  it('uses explicitly configured support_destination when set', () => {
    const ctx = {
      services: {
        translationService: {
          getSetting: vi.fn(() => '@my_support'),
        },
        adminService: {
          adminIds: [99999],
        },
      },
    } as unknown as MenuContext;

    const info = resolveSupportInfo(ctx);
    expect(info.isConfigured).toBe(true);
    expect(info.url).toBe('https://t.me/my_support');
    expect(info.rawValue).toBe('@my_support');
  });

  it('falls back dynamically to active admin from adminService when support_destination and supportUrl are empty', () => {
    const ctx = {
      services: {
        translationService: {
          getSetting: vi.fn(() => ''),
        },
        adminService: {
          adminIds: [888888],
        },
      },
    } as unknown as MenuContext;

    const info = resolveSupportInfo(ctx);
    expect(info.isConfigured).toBe(true);
    expect(info.url).toBe('tg://user?id=888888');
    expect(info.rawValue).toBe('888888');
  });

  it('returns isConfigured false when no admin is found and no support destination configured', () => {
    const ctx = {
      services: {
        translationService: {
          getSetting: vi.fn(() => ''),
        },
        adminService: {
          adminIds: [],
        },
      },
    } as unknown as MenuContext;

    const info = resolveSupportInfo(ctx);
    expect(info.isConfigured).toBe(false);
  });
});
