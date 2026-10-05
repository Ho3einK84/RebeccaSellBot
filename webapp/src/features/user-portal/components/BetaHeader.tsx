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
  Wallet,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { Badge } from '@/shared/components/ui/Badge.js';
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
    <header className="w-full flex flex-col gap-2 mb-3 relative z-10">
      {/* Top action row */}
      <div className="w-full flex items-center justify-between gap-1.5 flex-nowrap">
        {/* Return button: To Admin Panel if in admin preview, otherwise back to overview */}
        <button
          type="button"
          onClick={handleExit}
          className={`inline-flex items-center gap-1.5 px-2.5 min-h-[38px] rounded-xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer shrink-0 ${
            isAdminPreview
              ? isDark
                ? 'bg-indigo-600/15 border-indigo-500/30 hover:bg-indigo-600/25 text-indigo-300'
                : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 text-indigo-700 shadow-2xs'
              : isDark
                ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-300'
                : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-2xs'
          }`}
          title={isAdminPreview ? t('user.backToAdmin') : t('user.backToComingSoon')}
          aria-label={isAdminPreview ? t('user.backToAdmin') : t('user.backToComingSoon')}
        >
          {isAdminPreview ? (
            <ShieldCheck className="w-4 h-4 shrink-0 text-indigo-400" />
          ) : (
            <BackIcon className="w-4 h-4 shrink-0" />
          )}
          <span className="hidden sm:inline">
            {isAdminPreview ? t('user.backToAdmin') : t('user.backToComingSoon')}
          </span>
          <span className="sm:hidden">{isAdminPreview ? 'پنل ادمین' : 'بازگشت'}</span>
        </button>

        {/* Right utility buttons: Balance, Refresh, Theme, Language */}
        <div className="flex items-center gap-1 shrink-0">
          {balance !== undefined && (
            <div
              className={`min-h-[38px] px-2.5 py-1 rounded-xl border flex items-center gap-1.5 ${
                isDark
                  ? 'bg-indigo-950/40 border-indigo-500/20 text-indigo-300'
                  : 'bg-indigo-50/80 border-indigo-100 text-indigo-700'
              }`}
            >
              <Wallet className="w-3.5 h-3.5 opacity-75 shrink-0" />
              <span className="font-mono font-bold text-xs leading-none whitespace-nowrap">
                {formatToman(balance)} {displayCurrency}
              </span>
            </div>
          )}

          <button
            type="button"
            className={`inline-flex items-center justify-center w-[38px] h-[38px] rounded-xl border transition-all active:scale-95 cursor-pointer shrink-0 ${
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
            className={`inline-flex items-center justify-center w-[38px] h-[38px] rounded-xl border transition-all active:scale-95 cursor-pointer shrink-0 ${
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
              className={`inline-flex items-center justify-center w-[38px] h-[38px] rounded-xl border transition-all active:scale-95 cursor-pointer shrink-0 ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
                  : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-xs'
              }`}
              onClick={handleToggleLanguage}
              aria-label={t('common.switchLang')}
            >
              <Globe className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />
            </button>
          )}
        </div>
      </div>

      {/* User profile row - compact 2-line title & badges to prevent any name truncation */}
      <div
        className={`w-full px-3 py-2 rounded-2xl border flex items-center justify-between gap-2.5 ${
          isDark
            ? 'bg-gradient-to-r from-indigo-950/30 via-purple-950/15 to-zinc-900/40 border-indigo-500/20 shadow-xs'
            : 'bg-gradient-to-r from-indigo-50/70 via-white to-purple-50/60 border-indigo-100 shadow-2xs'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center shrink-0 border border-indigo-400/30 bg-indigo-500/10">
            {user.photo_url ? (
              <img src={user.photo_url} alt={displayName} className="w-full h-full object-cover" />
            ) : initials ? (
              <span className="text-[11px] font-bold font-mono text-indigo-500 dark:text-indigo-300">
                {initials}
              </span>
            ) : (
              <User className="w-4 h-4 text-indigo-400" />
            )}
          </div>

          <div className="flex flex-col min-w-0 flex-1 justify-center">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`text-xs sm:text-sm font-bold truncate ${isDark ? 'text-white' : 'text-slate-900'}`}
              >
                {displayName}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <Badge variant="primary" size="xs">
                <FlaskConical className="w-2.5 h-2.5 shrink-0" />
                <span>{t('user.betaBadge')}</span>
              </Badge>
              {isAdminPreview && (
                <Badge variant="primary" size="xs">
                  <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
                  <span>{t('user.adminPreviewBadge')}</span>
                </Badge>
              )}
            </div>
          </div>
        </div>

        <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono shrink-0 select-all">
          {t('common.idLabel')} {user.id}
        </span>
      </div>
    </header>
  );
};
