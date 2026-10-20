import React, { useEffect, useState } from 'react';
import { ShieldX, AlertTriangle, ExternalLink, X } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Button } from '@/shared/components/ui/Button.js';

interface AuthErrorScreenProps {
  error: string | null;
}

export const AuthErrorScreen: React.FC<AuthErrorScreenProps> = ({ error }) => {
  const { t, isRtl } = useLanguage();
  const { textPrimary, textSecondary } = useThemeTokens();

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
    return () => {
      cancelled = true;
    };
  }, []);

  // t.me deep link when we have the username; otherwise open Telegram app generically
  const openInTelegramUrl = botUsername ? `https://t.me/${botUsername}` : 'tg://';

  return (
    <div
      className="fixed inset-0 w-screen"
      style={{ height: '100dvh' }}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="flex items-center justify-center w-full h-full p-4">
        <div
          className={`p-6 sm:p-8 max-w-sm w-full text-center flex flex-col items-center gap-4 rounded-2xl border shadow-lg bg-surface/90 border-line/10 shadow-black/40 backdrop-blur-xl shadow-slate-200/60`}
        >
          {/* Brand Logo / Shield Icon */}
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center border ${
              isTelegramOnly
                ? 'bg-brand/10 border-brand/20 text-brand'
                : 'bg-warn/10 border-warn/20 text-warn'
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
              className={`h-11 rounded-xl font-semibold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 no-underline bg-brand hover:bg-brand text-brand-ink shadow-lg shadow-brand/20 shadow-slate-900/10`}
            >
              <ExternalLink className="w-4 h-4" />
              <span>{t('auth.openInTelegram')}</span>
            </a>

            {/* Secondary: Close Window */}
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="h-11 w-full"
              onClick={handleClose}
            >
              <X className="w-4 h-4" />
              <span>{t('auth.closeWindow')}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
