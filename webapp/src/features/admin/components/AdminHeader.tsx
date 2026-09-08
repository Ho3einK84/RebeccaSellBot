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
  const { isDark, toggleTheme, cardClass, textPrimary, textSecondary, textMuted } =
    useThemeTokens();
  const { triggerHaptic } = useHaptic();
  const { copy, isCopied } = useCopy();

  const rawAdminName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  const adminDisplayName = rawAdminName || 'Admin';

  return (
    <header
      className={`rounded-2xl p-3.5 sm:p-4 mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3.5 border transition-colors ${cardClass}`}
    >
      <div className="flex items-center gap-3 w-full sm:w-auto">
        <div
          className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border transition-colors ${
            isDark
              ? 'bg-gradient-to-tr from-indigo-600/20 to-violet-500/20 border-indigo-500/30 text-indigo-400 shadow-md shadow-indigo-950/40'
              : 'bg-indigo-50 border-indigo-200 text-indigo-600 shadow-sm'
          }`}
        >
          <ShieldCheck className="w-6 h-6" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className={`text-sm sm:text-base font-bold m-0 truncate ${textPrimary}`}>
              {t('admin.title')}
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                isDark
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>{t('admin.betaBadge')}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs mt-1 flex-wrap">
            <span className={textSecondary}>{t('common.welcome')}</span>
            <span className={`font-semibold ${textPrimary}`}>{adminDisplayName}</span>
            <span className={textMuted}>·</span>
            <button
              type="button"
              onClick={() => copy(String(user.id), 'header-id')}
              className={`inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-lg border transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/10'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
              title={t('common.copy')}
            >
              <span>🆔</span>
              <span dir="ltr">{user.id}</span>
              {isCopied('header-id') ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3 opacity-60" />
              )}
            </button>
            <span className={textMuted}>·</span>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${
                isDark
                  ? 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20'
                  : 'text-indigo-700 bg-indigo-50 border-indigo-200'
              }`}
            >
              {t('admin.role')}
            </span>
          </div>
        </div>
      </div>

      {/* Utility Buttons */}
      <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t border-slate-200/50 dark:border-white/5 sm:border-0">
        <button
          type="button"
          className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition-all active:scale-95 cursor-pointer ${
            isDark
              ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
              : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-sm'
          }`}
          onClick={() => {
            triggerHaptic('light');
            toggleTheme();
          }}
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
            className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
                : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-sm'
            }`}
            onClick={async () => {
              triggerHaptic('light');
              const next = locale === 'fa' ? 'en' : 'fa';
              const ok = await setLocale(next);
              if (ok) {
                onNotify(t('admin.notifications.langChangeSuccess'), 'success');
              }
            }}
          >
            <Globe className="w-3.5 h-3.5 opacity-70" />
            <span>{t('common.switchLang')}</span>
          </button>
        )}

        <button
          type="button"
          className={`inline-flex items-center justify-center w-8 h-8 sm:w-auto sm:px-3 h-8 rounded-full border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
            isDark
              ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
              : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-sm'
          }`}
          onClick={onRefresh}
          title={t('common.refresh')}
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline ms-1">{t('common.refresh')}</span>
        </button>

        <button
          type="button"
          className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition-all active:scale-95 cursor-pointer ${
            isDark
              ? 'bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20 text-rose-300'
              : 'bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-700 shadow-sm'
          }`}
          onClick={onClose}
          title={t('admin.exit')}
        >
          <LogOut className={`w-3.5 h-3.5 ${isRtl ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </header>
  );
};
