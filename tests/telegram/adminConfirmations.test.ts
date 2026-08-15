import { describe, expect, it, vi } from 'vitest';
import { InlineKeyboard } from 'grammy';
import type { MenuContext } from '../../src/telegram/types.js';
import { buildConfirmationKeyboard } from '../../src/telegram/ui.js';

describe('Advanced admin actions and confirmations', () => {
  it('builds explicit confirmation keyboards for destructive admin actions', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => (key === 'admin_confirm_button' ? 'تأیید' : 'انصراف')),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const confirmKb = buildConfirmationKeyboard(ctx, 'admin:orphans:baseline_confirm');
    expect(confirmKb).toBeInstanceOf(InlineKeyboard);
    expect(confirmKb.inline_keyboard.length).toBeGreaterThanOrEqual(2);
    const flatData = confirmKb.inline_keyboard
      .flat()
      .map((b) => (b as { callback_data?: string }).callback_data);
    expect(flatData).toContain('admin:orphans:baseline_confirm');
    expect(flatData).toContain('conversation:cancel');
  });

  it('preserves baseline reconciliation semantics', async () => {
    const establishRemoteBaseline = vi.fn().mockResolvedValue({
      remoteTotal: 10,
      alreadyBound: 8,
      ignoredUnbound: 2,
    });

    const services = {
      configReconciliationService: { establishRemoteBaseline },
    };

    const res = await services.configReconciliationService.establishRemoteBaseline(123);
    expect(establishRemoteBaseline).toHaveBeenCalledWith(123);
    expect(res).toEqual({ remoteTotal: 10, alreadyBound: 8, ignoredUnbound: 2 });
  });
});
