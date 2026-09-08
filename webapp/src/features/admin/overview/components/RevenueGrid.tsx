import React from 'react';
import { Calendar, CalendarDays, CalendarRange, CheckCircle2, XCircle, Gift } from 'lucide-react';
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
        className={`rounded-2xl p-4 sm:p-4.5 flex items-center justify-between border transition-all duration-200 group hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-white/20 ${cardClass}`}
      >
        <div className="space-y-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.overview.dailyRevenue')}
          </span>
          <div className={`text-lg sm:text-xl font-bold font-mono tracking-tight ${textPrimary}`}>
            {formatMoney(stats.dailyRevenue)}{' '}
            <span className={`text-xs font-normal ${textSecondary}`}>{t('common.currency')}</span>
          </div>
          <span className={`text-[11px] block ${textMuted}`}>
            {t('admin.overview.dailyRevenueSub')}
          </span>
        </div>
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 shadow-xs ${
            isDark
              ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
              : 'bg-indigo-50 border-indigo-200 text-indigo-700'
          }`}
        >
          <Calendar className="w-4 h-4" />
        </div>
      </div>

      {/* Weekly Revenue */}
      <div
        className={`rounded-2xl p-4 sm:p-4.5 flex items-center justify-between border transition-all duration-200 group hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-white/20 ${cardClass}`}
      >
        <div className="space-y-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.overview.weeklyRevenue')}
          </span>
          <div className={`text-lg sm:text-xl font-bold font-mono tracking-tight ${textPrimary}`}>
            {formatMoney(stats.weeklyRevenue)}{' '}
            <span className={`text-xs font-normal ${textSecondary}`}>{t('common.currency')}</span>
          </div>
          <span className={`text-[11px] block ${textMuted}`}>
            {t('admin.overview.weeklyRevenueSub')}
          </span>
        </div>
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 shadow-xs ${
            isDark
              ? 'bg-violet-500/10 border-violet-500/20 text-violet-400'
              : 'bg-violet-50 border-violet-200 text-violet-700'
          }`}
        >
          <CalendarDays className="w-4 h-4" />
        </div>
      </div>

      {/* Monthly Revenue */}
      <div
        className={`rounded-2xl p-4 sm:p-4.5 flex items-center justify-between border transition-all duration-200 group hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-white/20 ${cardClass}`}
      >
        <div className="space-y-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.overview.monthlyRevenue')}
          </span>
          <div className={`text-lg sm:text-xl font-bold font-mono tracking-tight ${textPrimary}`}>
            {formatMoney(stats.monthlyRevenue)}{' '}
            <span className={`text-xs font-normal ${textSecondary}`}>{t('common.currency')}</span>
          </div>
          <span className={`text-[11px] block ${textMuted}`}>
            {t('admin.overview.monthlyRevenueSub')}
          </span>
        </div>
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 shadow-xs ${
            isDark
              ? 'bg-sky-500/10 border-sky-500/20 text-sky-400'
              : 'bg-sky-50 border-sky-200 text-sky-700'
          }`}
        >
          <CalendarRange className="w-4 h-4" />
        </div>
      </div>

      {/* Active Subs */}
      <div
        className={`rounded-2xl p-4 sm:p-4.5 flex items-center justify-between border transition-all duration-200 group hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-white/20 ${cardClass}`}
      >
        <div className="space-y-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.overview.activeSubs')}
          </span>
          <div
            className={`text-lg sm:text-xl font-bold font-mono tracking-tight ${
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
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 shadow-xs ${
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
        className={`rounded-2xl p-4 sm:p-4.5 flex items-center justify-between border transition-all duration-200 group hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-white/20 ${cardClass}`}
      >
        <div className="space-y-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.overview.inactiveSubs')}
          </span>
          <div className={`text-lg sm:text-xl font-bold font-mono tracking-tight ${textSecondary}`}>
            {formatNumber(stats.inactiveSubscriptions)}
          </div>
          <span className={`text-[11px] block ${textMuted}`}>
            {t('admin.overview.inactiveSubsSub')}
          </span>
        </div>
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 shadow-xs ${
            isDark
              ? 'bg-white/[0.04] border-white/10 text-zinc-400'
              : 'bg-slate-100 border-slate-200/80 text-slate-500'
          }`}
        >
          <XCircle className="w-4 h-4" />
        </div>
      </div>

      {/* Referral Bonuses */}
      <div
        className={`rounded-2xl p-4 sm:p-4.5 flex items-center justify-between border transition-all duration-200 group hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-white/20 ${cardClass}`}
      >
        <div className="space-y-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.overview.referralBonus')}
          </span>
          <div className={`text-lg sm:text-xl font-bold font-mono tracking-tight ${textPrimary}`}>
            {formatMoney(stats.totalReferralBonus)}{' '}
            <span className={`text-xs font-normal ${textSecondary}`}>{t('common.currency')}</span>
          </div>
          <span className={`text-[11px] block ${textMuted}`}>
            {t('admin.overview.referralBonusSub')}
          </span>
        </div>
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 shadow-xs ${
            isDark
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}
        >
          <Gift className="w-4 h-4" />
        </div>
      </div>
    </>
  );
};
