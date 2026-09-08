import React from 'react';
import { Sun, Moon, Globe } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

export const UserHeader: React.FC = () => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();
  const { isDark, toggleTheme } = useThemeTokens();
  const { triggerHaptic } = useHaptic();

  const handleToggleLanguage = () => {
    triggerHaptic('selection');
    void setLocale(locale === 'fa' ? 'en' : 'fa');
  };

  const handleToggleTheme = () => {
    triggerHaptic('light');
    toggleTheme();
  };

  return (
    <header className="w-full max-w-md mx-auto flex items-center justify-between px-4 pt-3.5 pb-1 relative z-10 shrink-0">
      {/* Online status indicator */}
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
          isDark
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 status-pulse" />
        <span>{t('user.serviceOnlineStatus')}</span>
      </div>

      {/* Right utility buttons: Theme switch & Language */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition-all active:scale-95 cursor-pointer ${
            isDark
              ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
              : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-sm'
          }`}
          onClick={handleToggleTheme}
          aria-label={t('common.themeToggle')}
          title={isDark ? t('common.themeLight') : t('common.themeDark')}
        >
          {isDark ? (
            <Sun className="w-4 h-4 text-amber-300" />
          ) : (
            <Moon className="w-4 h-4 text-slate-700" />
          )}
        </button>

        {languageSelectionEnabled && (
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 px-3 py-1 h-8 rounded-full border text-[11px] font-medium transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
                : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-sm'
            }`}
            onClick={handleToggleLanguage}
            aria-label={t('common.switchLang')}
          >
            <Globe className="w-3.5 h-3.5 opacity-70" />
            <span>{t('common.switchLang')}</span>
          </button>
        )}
      </div>
    </header>
  );
};
