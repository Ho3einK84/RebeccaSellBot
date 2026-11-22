import { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { openTelegramLinkAndMinimize } from '@/shared/lib/telegramNavigation.js';

export interface UseTelegramContactVerificationOptions {
  botUsername?: string;
  onVerified?: () => void;
  onFallbackOpened?: () => void;
}

/**
 * Verifies a user's Telegram phone number without leaving the Mini App when
 * Telegram Client supports `WebApp.requestContact()` (Bot API 6.9+), polling
 * `/api/user/profile` briefly until the bot's `message:contact` handler persists
 * the keyed HMAC-SHA256 hash. Automatically falls back to `?start=verify_phone`
 * on older Telegram clients.
 */
export function useTelegramContactVerification(
  options: UseTelegramContactVerificationOptions = {}
) {
  const queryClient = useQueryClient();
  const [isVerifying, setIsVerifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<'waiting' | 'cancelled' | 'timeout' | null>(
    null
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  const supportsNativeRequestContact =
    typeof window !== 'undefined' && typeof window.Telegram?.WebApp?.requestContact === 'function';

  const openBotFallback = useCallback(() => {
    const cleanBot = (options.botUsername || '').replace(/^@/, '').trim();
    if (cleanBot) {
      openTelegramLinkAndMinimize(`https://t.me/${cleanBot}?start=verify_phone`);
    }
    options.onFallbackOpened?.();
  }, [options]);

  const startVerification = useCallback(() => {
    const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
    if (!tg?.requestContact) {
      openBotFallback();
      return;
    }

    setIsVerifying(true);
    setStatusMessage('waiting');
    stopPolling();

    tg.requestContact((sent) => {
      if (!mountedRef.current) return;
      if (!sent) {
        setIsVerifying(false);
        setStatusMessage('cancelled');
        return;
      }

      let attempts = 0;
      const maxAttempts = 12; // ~18 seconds total

      const checkNow = async () => {
        attempts += 1;
        try {
          const profileRes = await api.getUserProfile();
          if (!mountedRef.current) return;
          if (profileRes.user.phoneVerified || !profileRes.user.phoneVerificationRequired) {
            stopPolling();
            setIsVerifying(false);
            setStatusMessage(null);
            await queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
            await queryClient.invalidateQueries({ queryKey: queryKeys.user.trial });
            options.onVerified?.();
            return;
          }
        } catch {
          // Ignore transient poll errors
        }

        if (attempts >= maxAttempts && mountedRef.current) {
          stopPolling();
          setIsVerifying(false);
          setStatusMessage('timeout');
        }
      };

      void checkNow();
      timerRef.current = setInterval(() => {
        void checkNow();
      }, 1500);
    });
  }, [openBotFallback, options, queryClient, stopPolling]);

  return {
    supportsNativeRequestContact,
    isVerifying,
    statusMessage,
    startVerification,
    openBotFallback,
  };
}
