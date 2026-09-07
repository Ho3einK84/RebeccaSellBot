import React, { useState, useEffect } from 'react';
import './styles/app.css';
import { UserComingSoon } from './components/UserComingSoon.js';
import { AdminDashboard } from './components/AdminDashboard.js';
import type { TelegramWebAppUser } from './types/telegram.js';
import { LanguageProvider } from './i18n/LanguageContext.js';
import { ThemeProvider } from './theme/ThemeContext.js';
import type { SupportedLocale } from './i18n/translations.js';
import { Loader2, AlertTriangle, ShieldX } from 'lucide-react';

interface AuthResponse {
  role: 'admin' | 'user';
  user: TelegramWebAppUser;
  locale?: SupportedLocale;
  languageSelectionEnabled?: boolean;
}

export const App: React.FC = () => {
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
      // If opened directly in browser outside of Telegram during development/testing
      if (process.env.NODE_ENV === 'development') {
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

      setError('دسترسی فقط از طریق ربات تلگرام مجاز است.');
      setLoading(false);
      return;
    }

    fetch('/api/auth/telegram-validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ initData }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'اعتبارسنجی ناموفق بود' }));
          throw new Error(err.error || 'احراز هویت تلگرام انجام نشد');
        }
        return res.json();
      })
      .then((data: AuthResponse) => {
        setAuthData(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'خطای ارتباط با سرور');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-panel p-8 max-w-sm w-full text-center flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
          <p className="text-sm text-slate-300 font-medium">در حال برقراری ارتباط امن با سرور...</p>
        </div>
      </div>
    );
  }

  if (error || !authData) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-panel p-8 max-w-sm w-full text-center flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 border border-amber-500/20">
            {error?.includes('ربات') ? (
              <ShieldX className="w-7 h-7" />
            ) : (
              <AlertTriangle className="w-7 h-7" />
            )}
          </div>
          <h2 className="text-lg font-bold text-white">خطای احراز هویت</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            {error || 'امکان احراز هویت تلگرام وجود ندارد.'}
          </p>
          <button
            className="btn btn-primary w-full shadow-lg shadow-indigo-500/20"
            onClick={() => {
              if (window.Telegram?.WebApp?.close) {
                window.Telegram.WebApp.close();
              } else {
                window.close();
              }
            }}
          >
            بستن پنجره
          </button>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <LanguageProvider
        initialLocale={authData.locale || 'fa'}
        languageSelectionEnabled={authData.languageSelectionEnabled ?? true}
      >
        {authData.role === 'admin' ? (
          <AdminDashboard user={authData.user} />
        ) : (
          <UserComingSoon user={authData.user} />
        )}
      </LanguageProvider>
    </ThemeProvider>
  );
};
