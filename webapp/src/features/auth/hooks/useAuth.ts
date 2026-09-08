import { useState, useEffect } from 'react';
import type { AuthResponse } from '@/shared/types/api.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';
import { api } from '@/shared/lib/api.js';

export function useAuth() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authData, setAuthData] = useState<AuthResponse | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      if (tg.disableVerticalSwipes) {
        tg.disableVerticalSwipes();
      }
    }

    const initData = tg?.initData;

    if (!initData) {
      // If opened in browser outside Telegram during development/testing
      if (import.meta.env.DEV) {
        const mockUser: TelegramWebAppUser = {
          id: 123456789,
          first_name: 'مدیر',
          last_name: 'سیستم',
          username: 'admin',
        };
        setAuthData({
          role: 'admin',
          user: mockUser,
          locale: 'fa',
          languageSelectionEnabled: true,
        });
        setLoading(false);
        return;
      }

      setError('telegramOnly');
      setLoading(false);
      return;
    }

    api
      .validateTelegramAuth(initData)
      .then((data) => {
        setAuthData(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'authFailed');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { loading, error, authData };
}
