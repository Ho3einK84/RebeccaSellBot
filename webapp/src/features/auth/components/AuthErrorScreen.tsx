import React, { useEffect, useState } from 'react';
import { ShieldX, AlertTriangle, ExternalLink, X } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

interface AuthErrorScreenProps {
  error: string | null;
}

export const AuthErrorScreen: React.FC<AuthErrorScreenProps> = ({ error }) => {
  const { t, isRtl } = useLanguage();
  const { isDark, textPrimary, textSecondary } = useThemeTokens();

  const handleClose = () => {
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  };

  const isTelegramOnly = error === 'telegramOnly' || error?.includes('ربات');
  const message =
    error === 'telegramOnly'
      ? t('auth.telegramOnly')
      : error === 'authFailed'
        ? t('auth.authFailed')
        : error || t('auth.authFailed');

  const [botUsername, setBotUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/bot-info')
      .then((res) => {
        if (!res.ok) throw new Error('bot-info unavailable');
        return res.json();
      })
      .then((data: { username: string }) => {
        if (!cancelled) setBotUsername(data.username);
      })
      .catch(() => {
        if (!cancelled) setBotUsername(null);
      });
    return () => { cancelled = true; };
  }, []);

  // t.me deep link when we have the username; otherwise open Telegram app generically
  const openInTelegramUrl = botUsername
    ? `https://t.me/${botUsername}`
    : 'tg://';

  return (
    <div
      className="fixed inset-0 w-screen"
      style={{ height: '100dvh' }}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="flex items-center justify-center w-full h-full p-4">
        <div
          className={`p-6 sm:p-8 max-w-sm w-full text-center flex flex-col items-center gap-4 rounded-2xl border shadow-lg ${
            isDark
              ? 'bg-[#10121a]/90 border-white/[0.08] shadow-black/40 backdrop-blur-xl'
              : 'bg-white border-slate-200 shadow-slate-200/60'
          }`}
        >
          {/* Brand Logo / Shield Icon */}
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center border ${
              isTelegramOnly
                ? isDark
                  ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-600'
                : isDark
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  : 'bg-amber-50 border-amber-200 text-amber-600'
            }`}
          >
            {isTelegramOnly ? (
              <ShieldX className="w-8 h-8" />
            ) : (
              <AlertTriangle className="w-8 h-8" />
            )}
          </div>

          {/* Heading */}
          <h2 className={`text-lg font-bold tracking-tight ${textPrimary}`}>
            {t('auth.authErrorTitle')}
          </h2>

          {/* Message */}
          <p className={`text-sm leading-relaxed ${textSecondary}`}>{message}</p>

          {/* CTA Buttons */}
          <div className="flex flex-col gap-2.5 w-full mt-1">
            {/* Primary: Open in Telegram */}
            <a
              href={openInTelegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`h-11 rounded-xl font-semibold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 no-underline ${
                isDark
                  ? 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-indigo-500/20'
                  : 'bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-900/10'
              }`}
            >
              <ExternalLink className="w-4 h-4" />
              <span>{t('auth.openInTelegram')}</span>
            </a>

            {/* Secondary: Close Window */}
            <button
              type="button"
              className={`h-11 rounded-xl font-medium text-sm transition-all active:scale-[0.98] cursor-pointer border flex items-center justify-center gap-2 ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-xs'
              }`}
              onClick={handleClose}
            >
              <X className="w-4 h-4" />
              <span>{t('auth.closeWindow')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
