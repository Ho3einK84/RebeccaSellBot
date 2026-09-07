import React, { useState, useEffect } from 'react';
import './styles/app.css';
import { UserComingSoon } from './components/UserComingSoon.js';
import { AdminDashboard } from './components/AdminDashboard.js';
import type { TelegramWebAppUser } from './types/telegram.js';
import { LanguageProvider } from './i18n/LanguageContext.js';
import type { SupportedLocale } from './i18n/translations.js';

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
      <div className="coming-soon-container">
        <div className="glass-panel" style={{ padding: '32px 48px', textAlign: 'center' }}>
          <div
            style={{ fontSize: '36px', marginBottom: '16px', animation: 'spin 1s infinite linear' }}
          >
            ⏳
          </div>
          <p style={{ margin: 0, fontSize: '15px', color: '#94a3b8' }}>
            در حال برقراری ارتباط امن با سرور...
          </p>
        </div>
      </div>
    );
  }

  if (error || !authData) {
    return (
      <div className="coming-soon-container">
        <div className="glass-panel coming-soon-card">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ margin: '0 0 12px 0', fontSize: '18px' }}>خطای احراز هویت</h2>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '24px' }}>
            {error || 'امکان احراز هویت تلگرام وجود ندارد.'}
          </p>
          <button
            className="btn-primary"
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
  );
};
