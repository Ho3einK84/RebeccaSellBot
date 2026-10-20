import React from 'react';
import { Clock, Users, TrendingUp, Wallet } from 'lucide-react';
import { useAdminStats } from './hooks/useAdminStats.js';
import { HealthBanner } from './components/HealthBanner.js';
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

/**
 * Admin overview.
 * KPI cards all go through <StatCard/> so icon slot, value size, label weight and
 * padding never drift between cards again (the previous hand-rolled markup had the
 * health card mirrored, a smaller value font on the first card and two duplicate
 * calendar icons).
 */
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
    <div className="space-y-4">
      {/* Health first: the most urgent signal used to be card #4 of 6. */}
      <HealthBanner panelHealth={panelHealth} onSwitchToPanels={() => onSwitchTab('panels')} />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatCard
          label={t('admin.overview.pendingReceipts')}
          value={formatNumber(stats.pendingReceipts)}
          hint={t('admin.overview.pendingReceiptsSub')}
          icon={<Clock className="h-5 w-5" />}
          tone="warn"
          onClick={() => onSwitchTab('receipts')}
          index={0}
        />
        <StatCard
          label={t('admin.overview.totalUsers')}
          value={formatNumber(stats.totalUsers)}
          hint={t('admin.overview.totalUsersSub')}
          icon={<Users className="h-5 w-5" />}
          tone="brand"
          onClick={() => onSwitchTab('users')}
          index={1}
        />
        <StatCard
          label={t('admin.overview.totalSales')}
          value={formatMoney(stats.totalSales)}
          unit={t('common.currency')}
          hint={t('admin.overview.totalSalesSub')}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="ok"
          className="col-span-2 lg:col-span-1"
          index={2}
        />
        <StatCard
          label={t('admin.overview.dailyRevenue')}
          value={formatMoney(stats.dailyRevenue)}
          unit={t('common.currency')}
          hint={t('admin.overview.dailyRevenueSub')}
          icon={<Wallet className="h-5 w-5" />}
          tone="ok"
          className="col-span-2 lg:col-span-1"
          index={3}
        />
      </div>

      <SectionHeader title={t('admin.overview.revenueBreakdown')} />
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3">
        <RevenueGrid stats={stats} />
      </div>
    </div>
  );
};
