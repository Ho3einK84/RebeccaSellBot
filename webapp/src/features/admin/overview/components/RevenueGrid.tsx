import React from 'react';
import { CalendarDays, CalendarRange, CheckCircle2, XCircle, Gift, Coins } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { StatCard } from '@/shared/components/ui/StatCard.js';
import type { DashboardStats } from '@/shared/types/admin.js';

interface RevenueGridProps {
  stats: DashboardStats;
}

/** Revenue / subscription breakdown — same StatCard shell as the overview KPIs. */
export const RevenueGrid: React.FC<RevenueGridProps> = ({ stats }) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber } = useFormatters();

  return (
    <>
      <StatCard
        label={t('admin.overview.weeklyRevenue')}
        value={formatMoney(stats.weeklyRevenue)}
        className="col-span-2 lg:col-span-1"
        unit={t('common.currency')}
        hint={t('admin.overview.weeklyRevenueSub')}
        icon={<CalendarDays className="h-4.5 w-4.5" />}
        tone="ok"
        index={0}
      />
      <StatCard
        label={t('admin.overview.monthlyRevenue')}
        value={formatMoney(stats.monthlyRevenue)}
        className="col-span-2 lg:col-span-1"
        unit={t('common.currency')}
        hint={t('admin.overview.monthlyRevenueSub')}
        icon={<CalendarRange className="h-4.5 w-4.5" />}
        tone="ok"
        index={1}
      />
      <StatCard
        label={t('admin.overview.activeSubs')}
        value={formatNumber(stats.activeSubscriptions)}
        hint={t('admin.overview.activeSubsSub')}
        icon={<CheckCircle2 className="h-4.5 w-4.5" />}
        tone="ok"
        index={2}
      />
      <StatCard
        label={t('admin.overview.inactiveSubs')}
        value={formatNumber(stats.inactiveSubscriptions)}
        hint={t('admin.overview.inactiveSubsSub')}
        icon={<XCircle className="h-4.5 w-4.5" />}
        tone="neutral"
        index={3}
      />
      <StatCard
        label={t('admin.overview.referralBonus')}
        value={formatMoney(stats.totalReferralBonus)}
        className="col-span-2 lg:col-span-1"
        unit={t('common.currency')}
        hint={t('admin.overview.referralBonusSub')}
        icon={<Gift className="h-4.5 w-4.5" />}
        tone="warn"
        index={4}
      />
      <StatCard
        label={t('admin.overview.cashback')}
        value={formatMoney(stats.totalCashback)}
        className="col-span-2 lg:col-span-1"
        unit={t('common.currency')}
        hint={t('admin.overview.cashbackSub')}
        icon={<Coins className="h-4.5 w-4.5" />}
        tone="info"
        index={5}
      />
    </>
  );
};
