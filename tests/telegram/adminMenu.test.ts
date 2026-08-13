import { describe, expect, it } from 'vitest';
import {
  adminDailyMenu,
  adminMenu,
  adminPanelsMenu,
  adminSalesMenu,
  adminSystemMenu,
} from '../../src/telegram/keyboards/adminMenu.js';

describe('Grouped admin menu and user profile', () => {
  it('instantiates submenus for grouped admin management', () => {
    expect(adminMenu).toBeDefined();
    expect(adminDailyMenu).toBeDefined();
    expect(adminSalesMenu).toBeDefined();
    expect(adminPanelsMenu).toBeDefined();
    expect(adminSystemMenu).toBeDefined();

    expect((adminMenu as unknown as { id: string }).id).toBe('admin-menu');
    expect((adminDailyMenu as unknown as { id: string }).id).toBe('admin-daily-menu');
    expect((adminSalesMenu as unknown as { id: string }).id).toBe('admin-sales-menu');
    expect((adminPanelsMenu as unknown as { id: string }).id).toBe('admin-panels-menu');
    expect((adminSystemMenu as unknown as { id: string }).id).toBe('admin-system-menu');
  });
});
