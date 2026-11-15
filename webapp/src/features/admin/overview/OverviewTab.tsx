import React from 'react';
import { Clock, Users, TrendingUp, Wallet } from 'lucide-react';
import { useAdminStats } from './hooks/useAdminStats.js';
import { HealthBanner } from './components/HealthBanner.js';
import { OverviewAnalytics } from './components/OverviewAnalytics.js';
import { RevenueGrid } from './components/RevenueGrid.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { StatCard } from '@/shared/components/ui/StatCard.js';
import { Button } from '@/shared/components/ui/Button.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { SkeletonStatsGrid } from '@/shared/components/ui/Skeleton.js';
import type { TabType } from '@/shared/types/admin.js';

interface OverviewTabProps {
  onSwitchTab: (tab: TabType) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ onSwitchTab }) => {
  const { t } = useLanguage();
  const { stats, panelHealth, isLoading, error, refetch } = useAdminStats();
  const { formatMoney, formatNumber } = useFormatters();

  if (isLoading && !stats) {
    return <SkeletonStatsGrid count={6} />;
  }

  if (error && !stats) {
    return (
      <EmptyState
        icon={<Clock className="h-5 w-5" />}
        tone="danger"
        title={t('common.error')}
        description={error instanceof Error ? error.message : t('common.networkError')}
        action={
          <Button variant="primary" size="sm" onClick={() => refetch()}>
            {t('common.refresh')}
          </Button>
        }
      />
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-5 pb-6">
      <HealthBanner panelHealth={panelHealth} onSwitchToPanels={() => onSwitchTab('panels')} />

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label={t('admin.overview.pendingReceipts')}
          value={formatNumber(stats.pendingReceipts)}
          hint={t('admin.overview.pendingReceiptsSub')}
          icon={<Clock className="h-4 w-4" />}
          tone="warn"
          onClick={() => onSwitchTab('receipts')}
          index={0}
        />
        <StatCard
          label={t('admin.overview.totalUsers')}
          value={formatNumber(stats.totalUsers)}
          hint={t('admin.overview.totalUsersSub')}
          icon={<Users className="h-4 w-4" />}
          tone="brand"
          onClick={() => onSwitchTab('users')}
          index={1}
        />
        <StatCard
          label={t('admin.overview.totalSales')}
          value={formatMoney(stats.totalSales)}
          unit={t('common.currency')}
          hint={t('admin.overview.totalSalesSub')}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="ok"
          index={2}
          className="col-span-2 sm:col-span-1"
        />
        <StatCard
          label={t('admin.overview.dailyRevenue')}
          value={formatMoney(stats.dailyRevenue)}
          unit={t('common.currency')}
          hint={t('admin.overview.dailyRevenueSub')}
          icon={<Wallet className="h-4 w-4" />}
          tone="ok"
          index={3}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {/* Live Visual Analytics */}
      <OverviewAnalytics stats={stats} />

      {/* Granular Metrics Breakdown */}
      <div className="space-y-3">
        <SectionHeader title={t('admin.overview.revenueBreakdown')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <RevenueGrid stats={stats} />
        </div>
      </div>
    </div>
  );
};
