import React from 'react';
import { AlertTriangle, ShieldX } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';

interface AuthErrorScreenProps {
  error: string | null;
}

export const AuthErrorScreen: React.FC<AuthErrorScreenProps> = ({ error }) => {
  const { t } = useLanguage();

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

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-panel p-8 max-w-sm w-full text-center flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 border border-amber-500/20">
          {isTelegramOnly ? <ShieldX className="w-7 h-7" /> : <AlertTriangle className="w-7 h-7" />}
        </div>
        <h2 className="text-lg font-bold text-white">{t('auth.authErrorTitle')}</h2>
        <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
        <button
          type="button"
          className="btn btn-primary w-full shadow-lg shadow-indigo-500/20 cursor-pointer"
          onClick={handleClose}
        >
          {t('auth.closeWindow')}
        </button>
      </div>
    </div>
  );
};
