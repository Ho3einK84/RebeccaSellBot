import { describe, expect, it } from 'vitest';
import { InlineKeyboard } from 'grammy';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import { buildAdminPanelOutageScreen } from '../../src/telegram/botRuntime.js';
import { tForLocale } from '../../src/telegram/locale.js';
import type { BotServices } from '../../src/telegram/types.js';

describe('Admin Panel Outage Screen & Notification', () => {
  const translationService = new TranslationService();
  const mockServices = {
    translationService,
  } as unknown as BotServices;

  it('renders a polished, structured Persian outage alert with monospace endpoint and attempt units', () => {
    const screen = buildAdminPanelOutageScreen(
      mockServices,
      'fa',
      'پنل اصلی',
      'GET /api/user/h_1504644064_37',
      3
    );

    // Title & Subtitle hierarchy
    expect(screen).toContain('🚨 *اختلال در اتصال پنل*');
    expect(screen).toContain('_ارتباط با یکی از پنل‌ها با خطا مواجه شد._');

    // Status
    expect(screen).toContain('🔴 *وضعیت*');
    expect(screen).toContain('خطا');

    // Section & Emoji discipline
    expect(screen).toContain('🔌 *اتصال*');
    expect(screen).toContain('🖥️ *نام پنل:* پنل اصلی');

    // Monospace endpoint code wrapping for BiDi/LTR protection
    expect(screen).toContain('🌐 *آدرس پنل:* `GET /api/user/h_1504644064_37`');

    // Attempt unit & Persian digit
    expect(screen).toContain('🔁 *تلاش‌های ناموفق:* ۳ مرتبه');

    // Clear actionable troubleshooting steps
    expect(screen).toContain('💡 *اقدامات پیشنهادی:*');
    expect(screen).toContain('• بررسی روشن بودن سرور و اتصال اینترنت پنل');
    expect(screen).toContain('• بررسی دسترسی‌پذیری آدرس، پورت و فایروال سرور');
    expect(screen).toContain('• بررسی فعال بودن سرویس پنل و لاگ‌های خطا');
  });

  it('renders an equivalent polished English outage alert', () => {
    const screen = buildAdminPanelOutageScreen(
      mockServices,
      'en',
      'Main Panel',
      'GET /api/user/h_1504644064_37',
      3
    );

    expect(screen).toContain('🚨 *Panel Connection Outage*');
    expect(screen).toContain('_Communication with a panel has failed._');
    expect(screen).toContain('🔴 *Status*\nError');
    expect(screen).toContain('🔌 *Connection*');
    expect(screen).toContain('🖥️ *Panel name:* Main Panel');
    expect(screen).toContain('🌐 *Panel URL:* `GET /api/user/h_1504644064_37`');
    expect(screen).toContain('🔁 *Failed connection attempts:* 3 attempts');
    expect(screen).toContain('💡 *Recommended actions:*');
    expect(screen).toContain('• Check server status and panel network connectivity');
    expect(screen).toContain('• Verify panel host, port reachability, and firewall rules');
    expect(screen).toContain('• Inspect Rebecca / Xray daemon status and service logs');
  });

  it('safely escapes backticks inside raw endpoints', () => {
    const screen = buildAdminPanelOutageScreen(
      mockServices,
      'fa',
      'Panel `test`',
      'POST /api/user/`malicious`?foo=1',
      5
    );

    // Endpoint backticks sanitized to prevent broken Telegram Markdown
    expect(screen).not.toContain('```malicious```');
    expect(screen).toContain('`POST /api/user/malicious?foo=1`');
  });

  it('builds quick action keyboard with panel management and dismiss options', () => {
    const keyboard = new InlineKeyboard()
      .text(tForLocale(translationService, 'fa', 'admin_panel_manage_button'), 'admin:panels:open')
      .text(tForLocale(translationService, 'fa', 'menu_close'), 'ui:dismiss');

    expect(keyboard.inline_keyboard[0]![0]!.text).toBe('🖥️ مدیریت پنل‌ها');
    expect(keyboard.inline_keyboard[0]![0]!.callback_data).toBe('admin:panels:open');
    expect(keyboard.inline_keyboard[0]![1]!.text).toBe('✖️ بستن');
    expect(keyboard.inline_keyboard[0]![1]!.callback_data).toBe('ui:dismiss');
  });
});
