import React from 'react';
import type { TelegramWebAppUser } from '../types/telegram.js';
import { useLanguage } from '../i18n/LanguageContext.js';
import { User, Globe, Sparkles, Send, Bot } from 'lucide-react';

interface UserComingSoonProps {
  user: TelegramWebAppUser;
}

export const UserComingSoon: React.FC<UserComingSoonProps> = ({ user }) => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();

  const handleClose = () => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  };

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || t('guestUser');

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#0b0f19]">
      <div className="glass-panel p-6 sm:p-8 max-w-md w-full text-center flex flex-col items-center">
        {languageSelectionEnabled && (
          <div className="w-full flex justify-end mb-4">
            <button
              className="btn btn-ghost btn-sm gap-2 text-xs border border-white/10 hover:bg-white/10 text-slate-300"
              onClick={() => {
                window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
                setLocale(locale === 'fa' ? 'en' : 'fa');
              }}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{t('switchLang')}</span>
            </button>
          </div>
        )}

        <div className="relative mb-4">
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/30 overflow-hidden border-2 border-indigo-400/40">
            {user.photo_url ? (
              <img src={user.photo_url} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <User className="w-10 h-10 text-white" />
            )}
          </div>
          <div className="absolute -bottom-1 -end-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-[#0b0f19] flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-white" />
          </div>
        </div>

        <h1 className="text-xl font-bold text-white mb-2">
          {t('greeting', { name: displayName })}
        </h1>

        <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1 rounded-full text-xs text-slate-300 mb-6">
          <span>{t('telegramId')}</span>
          <code dir="ltr" className="font-mono text-indigo-300">
            {user.id}
          </code>
          {user.username && (
            <span dir="ltr" className="text-slate-400 font-mono inline-block unicode-isolate">
              (@{user.username})
            </span>
          )}
        </div>

        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5 mb-6 text-center w-full">
          <div className="flex items-center justify-center gap-2 text-indigo-400 font-semibold text-sm mb-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>{t('portalTitle')}</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300 shadow-sm">
              {t('betaBadge')}
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed m-0">{t('portalDesc')}</p>
        </div>

        <button
          className="btn btn-primary w-full gap-2 shadow-lg shadow-indigo-600/30 text-white"
          onClick={handleClose}
        >
          <Send className="w-4 h-4 rtl:rotate-180" />
          <span>{t('backToBot')}</span>
        </button>
      </div>
    </div>
  );
};
