import React from 'react';
import { Clock, Users, TrendingUp } from 'lucide-react';
import { useAdminStats } from './hooks/useAdminStats.js';
import { HealthBanner } from './components/HealthBanner.js';
import { RevenueGrid } from './components/RevenueGrid.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { SkeletonStatsGrid } from '@/shared/components/ui/Skeleton.js';
import type { TabType } from '@/shared/types/admin.js';

interface OverviewTabProps {
  onSwitchTab: (tab: TabType) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ onSwitchTab }) => {
  const { t } = useLanguage();
  const { stats, panelHealth, isLoading } = useAdminStats();
  const { formatMoney, formatNumber } = useFormatters();
  const { cardClass, isDark, textPrimary, textSecondary, textMuted } = useThemeTokens();

  if (isLoading && !stats) {
    return <SkeletonStatsGrid count={6} />;
  }

  if (!stats) return null;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Primary KPI Hero Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Pending Receipts */}
        <div
          className={`rounded-2xl p-4 sm:p-5 flex items-center justify-between cursor-pointer border transition-all duration-200 active:scale-[0.99] ${cardClass} hover:border-amber-500/40`}
          onClick={() => onSwitchTab('receipts')}
        >
          <div className="space-y-1">
            <span
              className={`text-xs font-semibold uppercase tracking-wider block ${textSecondary}`}
            >
              {t('admin.overview.pendingReceipts')}
            </span>
            <div className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-amber-500">
              {formatNumber(stats.pendingReceipts)}
            </div>
            <span className={`text-[11px] block ${textMuted}`}>
              {t('admin.overview.pendingReceiptsSub')}
            </span>
          </div>
          <div
            className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 transition-colors ${
              isDark
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                : 'bg-amber-50 border-amber-200 text-amber-700'
            }`}
          >
            <Clock className="w-5 h-5" />
          </div>
        </div>

        {/* Total Users */}
        <div
          className={`rounded-2xl p-4 sm:p-5 flex items-center justify-between cursor-pointer border transition-all duration-200 active:scale-[0.99] ${cardClass} hover:border-indigo-500/40`}
          onClick={() => onSwitchTab('users')}
        >
          <div className="space-y-1">
            <span
              className={`text-xs font-semibold uppercase tracking-wider block ${textSecondary}`}
            >
              {t('admin.overview.totalUsers')}
            </span>
            <div
              className={`text-2xl sm:text-3xl font-bold font-mono tracking-tight ${textPrimary}`}
            >
              {formatNumber(stats.totalUsers)}
            </div>
            <span className={`text-[11px] block ${textMuted}`}>
              {t('admin.overview.totalUsersSub')}
            </span>
          </div>
          <div
            className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 transition-colors ${
              isDark
                ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                : 'bg-indigo-50 border-indigo-200 text-indigo-700'
            }`}
          >
            <Users className="w-5 h-5" />
          </div>
        </div>

        {/* Total Sales */}
        <div
          className={`rounded-2xl p-4 sm:p-5 flex items-center justify-between border ${cardClass}`}
        >
          <div className="space-y-1">
            <span
              className={`text-xs font-semibold uppercase tracking-wider block ${textSecondary}`}
            >
              {t('admin.overview.totalSales')}
            </span>
            <div
              className={`text-2xl sm:text-3xl font-bold font-mono tracking-tight ${
                isDark ? 'text-emerald-400' : 'text-emerald-600'
              }`}
            >
              {formatMoney(stats.totalSales)}{' '}
              <span className={`text-xs font-normal ${textSecondary}`}>{t('common.currency')}</span>
            </div>
            <span className={`text-[11px] block ${textMuted}`}>
              {t('admin.overview.totalSalesSub')}
            </span>
          </div>
          <div
            className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 transition-colors ${
              isDark
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}
          >
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Panels Health Summary */}
      <HealthBanner panelHealth={panelHealth} onSwitchToPanels={() => onSwitchTab('panels')} />

      {/* Revenue & Subscription Breakdown Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <RevenueGrid stats={stats} />
      </div>
    </div>
  );
};
