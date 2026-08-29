import { describe, expect, it, vi } from 'vitest';
import { renderLuckyWheelScreen } from '../../src/telegram/features/luckyWheelRoutes.js';
import type { MenuContext } from '../../src/telegram/types.js';

describe('Lucky Wheel UI', () => {
  it('renders lucky wheel screen when user is eligible to spin', async () => {
    let renderedText = '';
    let renderedOptions: any = {};

    const mockCtx = {
      from: { id: 123456 },
      userLocale: 'fa',
      services: {
        luckyWheelService: {
          getStatus: vi.fn().mockResolvedValue({
            enabled: true,
            canSpin: true,
            totalSpins: 1,
            maxSpins: 5,
            minPrize: 1000,
            maxPrize: 50000,
            currentEffectiveLuck: 40,
          }),
        },
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
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

    await renderLuckyWheelScreen(mockCtx);

    expect(renderedText).toContain('wheel_title');
    expect(renderedOptions.reply_markup?.inline_keyboard).toBeDefined();
    // Verify spin button exists
    const hasSpinButton = renderedOptions.reply_markup.inline_keyboard.some((row: any[]) =>
      row.some((btn: any) => btn.callback_data === 'wheel:spin')
    );
    expect(hasSpinButton).toBe(true);
  });

  it('renders lucky wheel screen without spin button when cooldown is active', async () => {
    let renderedText = '';
    let renderedOptions: any = {};

    const mockCtx = {
      from: { id: 123456 },
      userLocale: 'fa',
      services: {
        luckyWheelService: {
          getStatus: vi.fn().mockResolvedValue({
            enabled: true,
            canSpin: false,
            reason: 'cooldown_active',
            secondsRemaining: 3600,
            totalSpins: 2,
            maxSpins: 5,
            minPrize: 1000,
            maxPrize: 50000,
            currentEffectiveLuck: 30,
          }),
        },
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
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

    await renderLuckyWheelScreen(mockCtx);

    expect(renderedText).toContain('wheel_title');
    // Spin button should NOT be present
    const hasSpinButton = renderedOptions.reply_markup.inline_keyboard.some((row: any[]) =>
      row.some((btn: any) => btn.callback_data === 'wheel:spin')
    );
    expect(hasSpinButton).toBe(false);
  });
});
