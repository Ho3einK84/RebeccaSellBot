import React from 'react';
import { Clock, Users, TrendingUp, Wallet, Receipt, Package, Settings2 } from 'lucide-react';
import { useAdminStats } from './hooks/useAdminStats.js';
import { HealthBanner } from './components/HealthBanner.js';
import { OverviewAnalytics } from './components/OverviewAnalytics.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { StatCard } from '@/shared/components/ui/StatCard.js';
import { Button } from '@/shared/components/ui/Button.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { IconTile, type TileTone } from '@/shared/components/ui/IconTile.js';
import { SkeletonStatsGrid } from '@/shared/components/ui/Skeleton.js';
import type { TabType } from '@/shared/types/admin.js';

interface OverviewTabProps {
  onSwitchTab: (tab: TabType) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ onSwitchTab }) => {
  const { t } = useLanguage();
  const { stats, panelHealth, fleetCapacity, dbLatencyMs, isLoading, error, forceRefresh } =
    useAdminStats();
  const { formatMoney, formatNumber } = useFormatters();

  if (isLoading && !stats) {
    return <SkeletonStatsGrid count={4} />;
  }

  if (error && !stats) {
    return (
      <EmptyState
        icon={<Clock className="h-5 w-5" />}
        tone="danger"
        title={t('common.error')}
        description={error instanceof Error ? error.message : t('common.networkError')}
        action={
          <Button variant="primary" size="sm" onClick={() => void forceRefresh()}>
            {t('common.refresh')}
          </Button>
        }
      />
    );
  }

  if (!stats) return null;

  const quickActions: Array<{
    tab: TabType;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: TileTone;
    badge?: string;
  }> = [
    {
      tab: 'receipts',
      label: t('admin.overview.quickReceipts'),
      icon: Receipt,
      tone: 'warn',
      badge: stats.pendingReceipts > 0 ? formatNumber(stats.pendingReceipts) : undefined,
    },
    {
      tab: 'users',
      label: t('admin.overview.quickUsers'),
      icon: Users,
      tone: 'brand',
    },
    {
      tab: 'packages',
      label: t('admin.overview.quickSales'),
      icon: Package,
      tone: 'ok',
    },
    {
      tab: 'coming-soon',
      label: t('admin.overview.quickMore'),
      icon: Settings2,
      tone: 'neutral',
    },
  ];

  return (
    <div className="space-y-4 pb-6">
      <HealthBanner
        panelHealth={panelHealth}
        dbLatencyMs={dbLatencyMs}
        onSwitchToPanels={() => onSwitchTab('panels')}
      />

      {fleetCapacity &&
        (fleetCapacity.fullPanelsCount > 0 ||
          fleetCapacity.pausedServicesCount > 0 ||
          fleetCapacity.fullServicesCount > 0) && (
          <AlertBanner
            tone="warn"
            action={
              <Button variant="secondary" size="xs" onClick={() => onSwitchTab('panels')}>
                {t('admin.overview.managePanelsCta')}
              </Button>
            }
          >
            <span className="font-semibold">{t('admin.overview.fleetCapacityAlertTitle')}: </span>
            <span>
              {t('admin.overview.fleetCapacityAlertDesc', {
                fullPanels: formatNumber(fleetCapacity.fullPanelsCount),
                pausedServices: formatNumber(fleetCapacity.pausedServicesCount),
                fullServices: formatNumber(fleetCapacity.fullServicesCount),
              })}
            </span>
          </AlertBanner>
        )}

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

      {/* Live Visual Analytics (non-duplicated revenue horizons + subscription share + rewards) */}
      <OverviewAnalytics stats={stats} />

      {/* 1-Tap Command Center Shortcuts (aligned with Telegram adm:home) */}
      <div className="space-y-2.5">
        <SectionHeader title={t('admin.overview.quickActionsTitle')} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {quickActions.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.tab}
                type="button"
                onClick={() => onSwitchTab(item.tab)}
                className="rs-card-interactive press rs-focus flex items-center gap-2.5 rounded-card border border-line bg-surface px-3 py-2.5 text-start cursor-pointer hover:bg-surface-2 shadow-[var(--shadow-card)]"
              >
                <IconTile tone={item.tone} size="sm">
                  <Icon />
                </IconTile>
                <span className="text-xs font-semibold text-ink truncate flex-1">{item.label}</span>
                {item.badge ? (
                  <span className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warn-soft border border-warn/30 px-1.5 text-[11px] font-bold text-warn-fg">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
