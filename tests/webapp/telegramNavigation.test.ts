import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  openTelegramLinkAndMinimize,
  minimizeOrCloseWebApp,
} from '../../webapp/src/shared/lib/telegramNavigation.js';

describe('telegramNavigation', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { window: unknown }).window = {
      open: vi.fn(),
      close: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  describe('openTelegramLinkAndMinimize', () => {
    it('calls openTelegramLink and minimizes if minimize is available', () => {
      const openTelegramLinkMock = vi.fn();
      const minimizeMock = vi.fn();
      const closeMock = vi.fn();

      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: {
          openTelegramLink: openTelegramLinkMock,
          minimize: minimizeMock,
          close: closeMock,
        },
      };

      openTelegramLinkAndMinimize('https://t.me/test_bot?start=renew_123', 100);

      expect(openTelegramLinkMock).toHaveBeenCalledWith('https://t.me/test_bot?start=renew_123');
      expect(minimizeMock).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);

      expect(minimizeMock).toHaveBeenCalledTimes(1);
      expect(closeMock).not.toHaveBeenCalled();
    });

    it('falls back to close if minimize is not a function', () => {
      const openTelegramLinkMock = vi.fn();
      const closeMock = vi.fn();

      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: {
          openTelegramLink: openTelegramLinkMock,
          close: closeMock,
        },
      };

      openTelegramLinkAndMinimize('https://t.me/test_bot?start=transfer_456', 150);

      expect(openTelegramLinkMock).toHaveBeenCalledWith('https://t.me/test_bot?start=transfer_456');
      expect(closeMock).not.toHaveBeenCalled();

      vi.advanceTimersByTime(150);

      expect(closeMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to window.open if openTelegramLink is absent', () => {
      const openMock = vi.fn();
      window.open = openMock;

      openTelegramLinkAndMinimize('https://t.me/test_bot?start=delete_789');

      expect(openMock).toHaveBeenCalledWith(
        'https://t.me/test_bot?start=delete_789',
        '_blank',
        'noopener,noreferrer'
      );
    });
  });

  describe('minimizeOrCloseWebApp', () => {
    it('calls minimize when available', () => {
      const minimizeMock = vi.fn();
      const closeMock = vi.fn();

      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: {
          minimize: minimizeMock,
          close: closeMock,
        },
      };

      minimizeOrCloseWebApp();

      expect(minimizeMock).toHaveBeenCalledTimes(1);
      expect(closeMock).not.toHaveBeenCalled();
    });

    it('falls back to close when minimize is not available', () => {
      const closeMock = vi.fn();

      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: {
          close: closeMock,
        },
      };

      minimizeOrCloseWebApp();

      expect(closeMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to window.close when Telegram WebApp is absent', () => {
      const windowCloseMock = vi.fn();
      window.close = windowCloseMock;

      minimizeOrCloseWebApp();

      expect(windowCloseMock).toHaveBeenCalledTimes(1);
    });
  });
});
