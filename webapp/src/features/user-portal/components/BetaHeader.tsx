import React from 'react';
import {
  Sun,
  Moon,
  Globe,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  FlaskConical,
  User,
  ShieldCheck,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';

interface BetaHeaderProps {
  user: TelegramWebAppUser;
  onRefresh: () => void;
  onExitBeta: () => void;
  isAdminPreview?: boolean;
  onSwitchToAdmin?: () => void;
  balance?: number;
  currency?: string;
  isRefreshing?: boolean;
}

export const BetaHeader: React.FC<BetaHeaderProps> = ({
  user,
  onRefresh,
  onExitBeta,
  isAdminPreview = false,
  onSwitchToAdmin,
  balance,
  currency,
  isRefreshing = false,
}) => {
  const { t, locale, isRtl, languageSelectionEnabled, setLocale } = useLanguage();
  const { isDark, toggleTheme } = useThemeTokens();
  const { triggerHaptic } = useHaptic();
  const { sanitizeDisplayName, formatToman } = useFormatters();
  const displayCurrency = currency || t('common.currency');

  const { displayName, initials } = sanitizeDisplayName(
    user.first_name,
    user.last_name,
    t('user.guestUser')
  );

  const handleToggleLanguage = () => {
    triggerHaptic('selection');
    void setLocale(locale === 'fa' ? 'en' : 'fa');
  };

  const handleToggleTheme = () => {
    triggerHaptic('light');
    toggleTheme();
  };

  const handleExit = () => {
    triggerHaptic('medium');
    if (isAdminPreview && onSwitchToAdmin) {
      onSwitchToAdmin();
    } else {
      onExitBeta();
    }
  };

  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <header className="w-full flex flex-col gap-2.5 mb-4 relative z-10">
      {/* Top action row */}
      <div className="w-full flex items-center justify-between">
        {/* Return button: To Admin Panel if in admin preview, otherwise back to overview */}
        <button
          type="button"
          onClick={handleExit}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
            isAdminPreview
              ? isDark
                ? 'bg-indigo-600/15 border-indigo-500/30 hover:bg-indigo-600/25 text-indigo-300'
                : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 text-indigo-700 shadow-2xs'
              : isDark
                ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-300'
                : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-2xs'
          }`}
          title={isAdminPreview ? t('user.backToAdmin') : t('user.backToComingSoon')}
        >
          {isAdminPreview ? (
            <ShieldCheck className="w-3.5 h-3.5" />
          ) : (
            <BackIcon className="w-3.5 h-3.5" />
          )}
          <span>{isAdminPreview ? t('user.backToAdmin') : t('user.backToComingSoon')}</span>
        </button>

        {/* Right utility buttons: Refresh, Theme, Language (harmonized with Admin rounded-xl) */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
                : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-xs'
            }`}
            onClick={onRefresh}
            aria-label={t('common.refresh')}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : 'text-slate-500 dark:text-zinc-400'}`}
            />
          </button>

          <button
            type="button"
            className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
                : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-xs'
            }`}
            onClick={handleToggleTheme}
            aria-label={t('common.themeToggle')}
          >
            {isDark ? (
              <Sun className="w-3.5 h-3.5 text-amber-300" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-700" />
            )}
          </button>

          {languageSelectionEnabled && (
            <button
              type="button"
              className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-xl border text-[11px] font-medium transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
                  : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-xs'
              }`}
              onClick={handleToggleLanguage}
            >
              <Globe className="w-3 h-3 opacity-70" />
              <span>{t('common.switchLang')}</span>
            </button>
          )}
        </div>
      </div>

      {/* User profile & Beta banner row */}
      <div
        className={`w-full p-3 sm:p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
          isDark
            ? 'bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-zinc-900/60 border-indigo-500/20 shadow-lg shadow-black/20'
            : 'bg-gradient-to-r from-indigo-50/80 via-white to-purple-50/70 border-indigo-100 shadow-xs'
        }`}
      >
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          {/* Small avatar */}
          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0 border border-indigo-400/30 bg-indigo-500/10">
            {user.photo_url ? (
              <img src={user.photo_url} alt={displayName} className="w-full h-full object-cover" />
            ) : initials ? (
              <span className="text-xs font-bold font-mono text-indigo-500 dark:text-indigo-300">
                {initials}
              </span>
            ) : (
              <User className="w-4 h-4 text-indigo-400" />
            )}
          </div>

          {/* Name & Beta Tag */}
          <div className="flex flex-col min-w-0 flex-1 text-start">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`text-xs sm:text-sm font-bold truncate ${isDark ? 'text-white' : 'text-slate-900'}`}
              >
                {displayName}
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-semibold bg-indigo-500/15 text-indigo-500 dark:text-indigo-300 border border-indigo-500/25 shrink-0">
                <FlaskConical className="w-2.5 h-2.5 shrink-0" />
                <span>{t('user.betaBadge')}</span>
              </span>
              {isAdminPreview && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30 shrink-0">
                  <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
                  <span>{t('user.adminPreviewBadge')}</span>
                </span>
              )}
            </div>
            <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono">
              {t('common.idLabel')} {user.id}
            </span>
          </div>
        </div>

        {/* Quick balance badge */}
        {balance !== undefined && (
          <div className="flex flex-col items-end shrink-0 ps-1">
            <span className="text-[10px] text-slate-500 dark:text-zinc-400">
              {t('user.dashboard.walletBalance')}
            </span>
            <span className="font-mono font-bold text-xs sm:text-sm text-indigo-600 dark:text-indigo-300 whitespace-nowrap">
              {formatToman(balance)} {displayCurrency}
            </span>
          </div>
        )}
      </div>
    </header>
  );
};
