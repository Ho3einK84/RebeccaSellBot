import React from 'react';
import { Calendar, CalendarDays, CalendarRange, CheckCircle2, XCircle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type { DashboardStats } from '@/shared/types/admin.js';

interface RevenueGridProps {
  stats: DashboardStats;
}

export const RevenueGrid: React.FC<RevenueGridProps> = ({ stats }) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber } = useFormatters();
  const { cardClass, isDark, textPrimary, textSecondary, textMuted } = useThemeTokens();

  return (
    <>
      {/* Daily Revenue */}
      <div
        className={`rounded-2xl p-4 flex items-center justify-between border transition-all duration-200 hover:border-slate-300 dark:hover:border-white/20 ${cardClass}`}
      >
        <div className="space-y-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.overview.dailyRevenue')}
          </span>
          <div className={`text-lg font-bold font-mono tracking-tight ${textPrimary}`}>
            {formatMoney(stats.dailyRevenue)}{' '}
            <span className={`text-xs font-normal ${textSecondary}`}>{t('common.currency')}</span>
          </div>
          <span className={`text-[11px] block ${textMuted}`}>
            {t('admin.overview.dailyRevenueSub')}
          </span>
        </div>
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
            isDark
              ? 'bg-white/[0.04] border-white/10 text-zinc-300'
              : 'bg-slate-100 border-slate-200/80 text-slate-700'
          }`}
        >
          <Calendar className="w-4 h-4" />
        </div>
      </div>

      {/* Weekly Revenue */}
      <div
        className={`rounded-2xl p-4 flex items-center justify-between border transition-all duration-200 hover:border-slate-300 dark:hover:border-white/20 ${cardClass}`}
      >
        <div className="space-y-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.overview.weeklyRevenue')}
          </span>
          <div className={`text-lg font-bold font-mono tracking-tight ${textPrimary}`}>
            {formatMoney(stats.weeklyRevenue)}{' '}
            <span className={`text-xs font-normal ${textSecondary}`}>{t('common.currency')}</span>
          </div>
          <span className={`text-[11px] block ${textMuted}`}>
            {t('admin.overview.weeklyRevenueSub')}
          </span>
        </div>
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
            isDark
              ? 'bg-white/[0.04] border-white/10 text-zinc-300'
              : 'bg-slate-100 border-slate-200/80 text-slate-700'
          }`}
        >
          <CalendarDays className="w-4 h-4" />
        </div>
      </div>

      {/* Monthly Revenue */}
      <div
        className={`rounded-2xl p-4 flex items-center justify-between border transition-all duration-200 hover:border-slate-300 dark:hover:border-white/20 ${cardClass}`}
      >
        <div className="space-y-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.overview.monthlyRevenue')}
          </span>
          <div className={`text-lg font-bold font-mono tracking-tight ${textPrimary}`}>
            {formatMoney(stats.monthlyRevenue)}{' '}
            <span className={`text-xs font-normal ${textSecondary}`}>{t('common.currency')}</span>
          </div>
          <span className={`text-[11px] block ${textMuted}`}>
            {t('admin.overview.monthlyRevenueSub')}
          </span>
        </div>
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
            isDark
              ? 'bg-white/[0.04] border-white/10 text-zinc-300'
              : 'bg-slate-100 border-slate-200/80 text-slate-700'
          }`}
        >
          <CalendarRange className="w-4 h-4" />
        </div>
      </div>

      {/* Active Subs */}
      <div
        className={`rounded-2xl p-4 flex items-center justify-between border transition-all duration-200 hover:border-slate-300 dark:hover:border-white/20 ${cardClass}`}
      >
        <div className="space-y-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.overview.activeSubs')}
          </span>
          <div
            className={`text-lg font-bold font-mono tracking-tight ${
              isDark ? 'text-emerald-400' : 'text-emerald-600'
            }`}
          >
            {formatNumber(stats.activeSubscriptions)}
          </div>
          <span className={`text-[11px] block ${textMuted}`}>
            {t('admin.overview.activeSubsSub')}
          </span>
        </div>
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
            isDark
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
        </div>
      </div>

      {/* Inactive Subs */}
      <div
        className={`rounded-2xl p-4 flex items-center justify-between border transition-all duration-200 hover:border-slate-300 dark:hover:border-white/20 ${cardClass}`}
      >
        <div className="space-y-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.overview.inactiveSubs')}
          </span>
          <div className={`text-lg font-bold font-mono tracking-tight ${textSecondary}`}>
            {formatNumber(stats.inactiveSubscriptions)}
          </div>
          <span className={`text-[11px] block ${textMuted}`}>
            {t('admin.overview.inactiveSubsSub')}
          </span>
        </div>
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
            isDark
              ? 'bg-white/[0.04] border-white/10 text-zinc-400'
              : 'bg-slate-100 border-slate-200/80 text-slate-500'
          }`}
        >
          <XCircle className="w-4 h-4" />
        </div>
      </div>
    </>
  );
};
