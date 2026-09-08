import React from 'react';
import { ShieldCheck, RotateCw, Globe, Check, Copy, Sun, Moon, LogOut } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';

interface AdminHeaderProps {
  user: TelegramWebAppUser;
  onRefresh: () => void;
  onClose: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({ user, onRefresh, onClose, onNotify }) => {
  const { t, locale, isRtl, languageSelectionEnabled, setLocale } = useLanguage();
  const { isDark, toggleTheme, cardClass, textPrimary, textSecondary } = useThemeTokens();
  const { triggerHaptic } = useHaptic();
  const { copy, isCopied } = useCopy();

  const rawAdminName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  const adminDisplayName = rawAdminName || 'Admin';

  return (
    <header
      className={`rounded-2xl p-3.5 sm:p-4 mb-4 border transition-all duration-200 ${cardClass}`}
    >
      {/* Top Tier: Brand, Title & Utility Actions */}
      <div className="flex items-center justify-between gap-2.5 pb-3 border-b border-slate-200/60 dark:border-white/[0.06]">
        {/* Brand & Panel Identity */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition-all ${
              isDark
                ? 'bg-gradient-to-br from-indigo-500/20 to-violet-500/10 border-indigo-500/25 text-indigo-400 shadow-xs'
                : 'bg-indigo-50 border-indigo-200/80 text-indigo-600 shadow-xs'
            }`}
          >
            <ShieldCheck className="w-5 h-5" />
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <h1
              className={`text-sm sm:text-base font-bold m-0 tracking-tight truncate ${textPrimary}`}
            >
              {t('admin.title')}
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${
                isDark
                  ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 status-pulse" />
              <span>{t('admin.betaBadge')}</span>
            </span>
          </div>
        </div>

        {/* Quick Utility Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Theme Toggle */}
          <button
            type="button"
            className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-300'
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200/80 text-slate-700 shadow-xs'
            }`}
            onClick={() => {
              triggerHaptic('light');
              toggleTheme();
            }}
            title={isDark ? t('common.themeLight') : t('common.themeDark')}
            aria-label={isDark ? t('common.themeLight') : t('common.themeDark')}
          >
            {isDark ? (
              <Sun className="w-3.5 h-3.5 text-amber-300" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-700" />
            )}
          </button>

          {/* Language Toggle */}
          {languageSelectionEnabled && (
            <button
              type="button"
              className={`inline-flex items-center gap-1 px-2 h-8 rounded-xl border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-300'
                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200/80 text-slate-700 shadow-xs'
              }`}
              onClick={async () => {
                triggerHaptic('light');
                const next = locale === 'fa' ? 'en' : 'fa';
                const ok = await setLocale(next);
                if (ok) {
                  onNotify(t('admin.notifications.langChangeSuccess'), 'success');
                }
              }}
              title={t('common.language')}
              aria-label={t('common.language')}
            >
              <Globe className="w-3.5 h-3.5 opacity-60" />
              <span className="uppercase text-[11px] font-semibold">{locale}</span>
            </button>
          )}

          {/* Refresh Action */}
          <button
            type="button"
            className={`inline-flex items-center justify-center w-8 h-8 sm:w-auto sm:px-2.5 h-8 rounded-xl border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-300'
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200/80 text-slate-700 shadow-xs'
            }`}
            onClick={onRefresh}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline ms-1.5">{t('common.refresh')}</span>
          </button>

          {/* Exit Mini App */}
          <button
            type="button"
            className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20 text-rose-300'
                : 'bg-rose-50 hover:bg-rose-100 border-rose-200/80 text-rose-700 shadow-xs'
            }`}
            onClick={onClose}
            title={t('admin.exit')}
            aria-label={t('admin.exit')}
          >
            <LogOut className={`w-3.5 h-3.5 ${isRtl ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Bottom Tier: User Profile & Identity Subline */}
      <div className="flex items-center justify-between gap-2 pt-2.5 text-xs flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-xs ${textSecondary}`}>{t('common.welcome')}</span>
          <span className={`font-semibold text-xs truncate ${textPrimary}`}>
            {adminDisplayName}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ms-auto">
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-md border select-none ${
              isDark
                ? 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20'
                : 'text-indigo-700 bg-indigo-50 border-indigo-200'
            }`}
          >
            {t('admin.role')}
          </span>

          <button
            type="button"
            onClick={() => copy(String(user.id), 'header-id')}
            className={`inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-md border transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 hover:border-white/20 text-zinc-300'
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200/80 hover:border-slate-300 text-slate-700 shadow-xs'
            }`}
            title={t('common.copy')}
          >
            <span className="text-[10px] opacity-50">#</span>
            <span dir="ltr">{user.id}</span>
            {isCopied('header-id') ? (
              <Check className="w-3 h-3 text-emerald-500" />
            ) : (
              <Copy className="w-2.5 h-2.5 opacity-50 hover:opacity-100" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
