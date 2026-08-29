import { describe, expect, it, vi } from 'vitest';
import {
  formatRemainingTime,
  renderLuckyWheelScreen,
} from '../../src/telegram/features/luckyWheelRoutes.js';
import type { MenuContext } from '../../src/telegram/types.js';
import { TranslationService } from '../../src/domain/services/TranslationService.js';
import { FA_TEXTS } from '../../src/domain/services/TranslationCatalog.fa.js';
import { EN_TEXTS } from '../../src/domain/services/TranslationCatalog.en.js';

describe('Lucky Wheel UI & Localization', () => {
  function createMockContext(
    locale: 'fa' | 'en',
    statusOverrides: Partial<any> = {}
  ): {
    ctx: MenuContext;
    getRenderedText: () => string;
    getRenderedOptions: () => any;
  } {
    let renderedText = '';
    let renderedOptions: any = {};
    const translationService = new TranslationService();

    const ctx = {
      from: { id: 123456, language_code: locale },
      userLocale: locale,
      services: {
        luckyWheelService: {
          getStatus: vi.fn().mockResolvedValue({
            enabled: true,
            canSpin: true,
            totalSpins: 1,
            maxSpins: 3,
            minPrize: 10000,
            maxPrize: 100000,
            currentEffectiveLuck: 50,
            ...statusOverrides,
          }),
        },
        translationService,
      },
      editMessageText: vi.fn(async (text: string, opts: any) => {
        renderedText = text;
        renderedOptions = opts;
      }),
      reply: vi.fn(async (text: string, opts: any) => {
        renderedText = text;
        renderedOptions = opts;
        return { message_id: 100 };
      }),
      callbackQuery: {
        message: { message_id: 999 },
      },
      chat: { id: 123456 },
      answerCallbackQuery: vi.fn(),
    } as unknown as MenuContext;

    return {
      ctx,
      getRenderedText: () => renderedText,
      getRenderedOptions: () => renderedOptions,
    };
  }

  it('renders lucky wheel screen in English with complete LTR/English purity and no Persian artifacts', async () => {
    const { ctx, getRenderedText, getRenderedOptions } = createMockContext('en', {
      canSpin: false,
      reason: 'cooldown_active',
      secondsRemaining: 23 * 3600 + 27 * 60, // 23h 27m
      totalSpins: 1,
      maxSpins: 3,
      minPrize: 10000,
      maxPrize: 100000,
    });

    await renderLuckyWheelScreen(ctx);
    const text = getRenderedText();

    expect(text).toContain('🎡 *Lucky Wheel*');
    expect(text).toContain('_Try your luck to receive gift balance._');
    expect(text).toContain('📊 *Wheel Status*');
    expect(text).toContain('🎯 *Spins Remaining:* 2 / 3');
    expect(text).toContain('🎁 *Gift Amount:* 10,000 to 100,000 Toman');
    expect(text).toContain('⏳ *Next Spin:* 23 hour(s) and 27 minute(s)');

    // Strictly ensure no Persian script exists in the English output
    expect(/[\u0600-\u06ff]/u.test(text)).toBe(false);
    expect(text).not.toContain('تا');
    expect(text).not.toContain('دقیقه');
    expect(text).not.toContain('ساعت');
  });

  it('renders lucky wheel screen in Persian with correct RTL stability and Persian numerals', async () => {
    const { ctx, getRenderedText } = createMockContext('fa', {
      canSpin: false,
      reason: 'cooldown_active',
      secondsRemaining: 23 * 3600 + 27 * 60, // 23h 27m
      totalSpins: 1,
      maxSpins: 3,
      minPrize: 10000,
      maxPrize: 100000,
    });

    await renderLuckyWheelScreen(ctx);
    const text = getRenderedText();

    expect(text).toContain('🎡 *گردونه شانس*');
    expect(text).toContain('_شانس خود را برای دریافت هدیه امتحان کنید._');
    expect(text).toContain('📊 *وضعیت گردونه*');
    expect(text).toContain('🎯 *فرصت‌های باقیمانده:* ۲ / ۳');
    expect(text).toContain('🎁 *مبلغ هدیه:* ۱۰٬۰۰۰ تا ۱۰۰٬۰۰۰ تومان');
    expect(text).toContain('⏳ *چرخش بعدی:* ۲۳ ساعت و ۲۷ دقیقه');
  });

  it('renders single prize amount when minPrize equals maxPrize', async () => {
    const { ctx, getRenderedText } = createMockContext('en', {
      minPrize: 50000,
      maxPrize: 50000,
    });

    await renderLuckyWheelScreen(ctx);
    const text = getRenderedText();
    expect(text).toContain('🎁 *Gift Amount:* 50,000 Toman');
    expect(text).not.toContain('50,000 to');
  });

  describe('formatRemainingTime helper', () => {
    it('formats hours and minutes accurately in both locales', () => {
      const { ctx: enCtx } = createMockContext('en');
      const { ctx: faCtx } = createMockContext('fa');

      const seconds = 23 * 3600 + 27 * 60; // 23 hours 27 minutes
      expect(formatRemainingTime(seconds, enCtx)).toBe('23 hour(s) and 27 minute(s)');
      expect(formatRemainingTime(seconds, faCtx)).toBe('۲۳ ساعت و ۲۷ دقیقه');
    });

    it('formats exact hours without redundant minutes in both locales', () => {
      const { ctx: enCtx } = createMockContext('en');
      const { ctx: faCtx } = createMockContext('fa');

      const seconds = 2 * 3600; // 2 hours
      expect(formatRemainingTime(seconds, enCtx)).toBe('2 hour(s)');
      expect(formatRemainingTime(seconds, faCtx)).toBe('۲ ساعت');
    });

    it('formats minutes-only under 1 hour in both locales', () => {
      const { ctx: enCtx } = createMockContext('en');
      const { ctx: faCtx } = createMockContext('fa');

      const seconds = 45 * 60; // 45 minutes
      expect(formatRemainingTime(seconds, enCtx)).toBe('45 minute(s)');
      expect(formatRemainingTime(seconds, faCtx)).toBe('۴۵ دقیقه');
    });

    it('handles seconds rounding up to 1 minute in both locales', () => {
      const { ctx: enCtx } = createMockContext('en');
      const { ctx: faCtx } = createMockContext('fa');

      const seconds = 40; // 40 seconds
      expect(formatRemainingTime(seconds, enCtx)).toBe('1 minute(s)');
      expect(formatRemainingTime(seconds, faCtx)).toBe('۱ دقیقه');
    });

    it('handles zero or negative duration gracefully', () => {
      const { ctx: enCtx } = createMockContext('en');
      const { ctx: faCtx } = createMockContext('fa');

      expect(formatRemainingTime(0, enCtx)).toBe('0 minute(s)');
      expect(formatRemainingTime(0, faCtx)).toBe('۰ دقیقه');
      expect(formatRemainingTime(-10, enCtx)).toBe('0 minute(s)');
      expect(formatRemainingTime(-10, faCtx)).toBe('۰ دقیقه');
    });
  });

  it('renders spin button when eligible and hides it during cooldown', async () => {
    const { ctx: activeCtx, getRenderedOptions: getActiveOpts } = createMockContext('fa', {
      canSpin: true,
    });
    await renderLuckyWheelScreen(activeCtx);
    const activeOpts = getActiveOpts();
    const hasSpinBtn = activeOpts.reply_markup?.inline_keyboard?.some((row: any[]) =>
      row.some((b: any) => b.callback_data === 'wheel:spin')
    );
    expect(hasSpinBtn).toBe(true);

    const { ctx: cooldownCtx, getRenderedOptions: getCooldownOpts } = createMockContext('fa', {
      canSpin: false,
      reason: 'cooldown_active',
      secondsRemaining: 3600,
    });
    await renderLuckyWheelScreen(cooldownCtx);
    const cooldownOpts = getCooldownOpts();
    const hasCooldownSpinBtn = cooldownOpts.reply_markup?.inline_keyboard?.some((row: any[]) =>
      row.some((b: any) => b.callback_data === 'wheel:spin')
    );
    expect(hasCooldownSpinBtn).toBe(false);
  });
});
