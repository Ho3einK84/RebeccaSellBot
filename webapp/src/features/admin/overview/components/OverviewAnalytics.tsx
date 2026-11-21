import React from 'react';
import { BarChart3, PieChart } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { DashboardStats } from '@/shared/types/admin.js';

interface OverviewAnalyticsProps {
  stats: DashboardStats;
}

export interface RevenueBarMetric {
  id: 'daily' | 'weekly' | 'monthly';
  value: number;
  ratio: number;
  opacity: number;
}

export interface SubscriptionSplitMetrics {
  active: number;
  inactive: number;
  total: number;
  activePercent: number;
  circumference: number;
  dashOffset: number;
}

export function computeRevenueBarMetrics(stats: DashboardStats): RevenueBarMetric[] {
  const maxVal = Math.max(stats.dailyRevenue, stats.weeklyRevenue, stats.monthlyRevenue, 1);
  return [
    {
      id: 'daily',
      value: stats.dailyRevenue,
      ratio: Math.max(0.06, Math.min(1, stats.dailyRevenue / maxVal)),
      opacity: 0.48,
    },
    {
      id: 'weekly',
      value: stats.weeklyRevenue,
      ratio: Math.max(0.06, Math.min(1, stats.weeklyRevenue / maxVal)),
      opacity: 0.74,
    },
    {
      id: 'monthly',
      value: stats.monthlyRevenue,
      ratio: Math.max(0.06, Math.min(1, stats.monthlyRevenue / maxVal)),
      opacity: 1,
    },
  ];
}

export function computeSubscriptionSplit(
  stats: DashboardStats,
  radius = 44
): SubscriptionSplitMetrics {
  const active = Math.max(0, stats.activeSubscriptions);
  const inactive = Math.max(0, stats.inactiveSubscriptions);
  const total = active + inactive;
  const activeFraction = total > 0 ? active / total : 0;
  const activePercent = Math.round(activeFraction * 100);
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - activeFraction);

  return {
    active,
    inactive,
    total,
    activePercent,
    circumference,
    dashOffset,
  };
}

/**
 * Custom responsive SVG analytics row driven exclusively by live `DashboardStats`.
 * Renders crisp geometric SVGs for proportional metrics and keeps the bar chart and
 * its readout columns in a shared LTR time-series frame so columns align 1:1 in RTL & LTR.
 */
export const OverviewAnalytics: React.FC<OverviewAnalyticsProps> = ({ stats }) => {
  const { t, locale } = useLanguage();
  const { formatMoney, formatNumber } = useFormatters();

  const currency = t('common.currency');
  const bars = computeRevenueBarMetrics(stats);
  const split = computeSubscriptionSplit(stats, 44);
  const netRewards = stats.totalReferralBonus + stats.totalCashback;
  const percentSign = locale === 'fa' ? '٪' : '%';

  const barLabels: Record<RevenueBarMetric['id'], string> = {
    daily: t('admin.overview.dailyShort'),
    weekly: t('admin.overview.weeklyShort'),
    monthly: t('admin.overview.monthlyShort'),
  };

  // Fixed SVG chart geometry (bars sit cleanly inside y=16..108)
  const svgWidth = 360;
  const svgHeight = 120;
  const maxBarHeight = 92;
  const baselineY = 108;
  const slotWidth = svgWidth / bars.length;
  const barWidth = 52;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
      {/* Revenue Horizons Chart */}
      <Card padding="lg" className="lg:col-span-7 flex flex-col justify-between gap-4 text-start">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <IconTile tone="brand" size="md">
              <BarChart3 />
            </IconTile>
            <div className="flex flex-col min-w-0">
              <h3 className="text-sm font-semibold text-ink truncate m-0">
                {t('admin.overview.revenueOverviewTitle')}
              </h3>
              <p className="text-xs text-ink-muted truncate m-0">
                {t('admin.overview.revenueOverviewSub')}
              </p>
            </div>
          </div>
          <span className="text-xs text-ink-muted shrink-0">{currency}</span>
        </div>

        {/* SVG Proportional Column Visualization + 1:1 Aligned Readout Strip (LTR chart axis) */}
        <div dir="ltr" className="w-full">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-32 overflow-visible"
            role="img"
            aria-label={t('admin.overview.revenueOverviewTitle')}
          >
            <defs>
              <linearGradient id="rs-rev-bar-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--rs-brand)" stopOpacity="1" />
                <stop offset="100%" stopColor="var(--rs-accent)" stopOpacity="0.82" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75, 1].map((tick) => {
              const y = baselineY - tick * maxBarHeight;
              return (
                <line
                  key={tick}
                  x1={12}
                  y1={y}
                  x2={svgWidth - 12}
                  y2={y}
                  stroke="var(--rs-line)"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
              );
            })}
            <line
              x1={12}
              y1={baselineY}
              x2={svgWidth - 12}
              y2={baselineY}
              stroke="var(--rs-line-strong)"
              strokeWidth={1}
            />

            {bars.map((bar, idx) => {
              const h = bar.value === 0 ? 4 : Math.max(8, bar.ratio * maxBarHeight);
              const x = idx * slotWidth + (slotWidth - barWidth) / 2;
              const y = baselineY - h;
              return (
                <g key={bar.id}>
                  <rect
                    x={x}
                    y={16}
                    width={barWidth}
                    height={maxBarHeight}
                    rx={6}
                    fill="var(--rs-surface-2)"
                  />
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={h}
                    rx={6}
                    fill="url(#rs-rev-bar-grad)"
                    fillOpacity={bar.value === 0 ? 0.18 : bar.opacity}
                    className="anim-bar-grow"
                    style={{ animationDelay: `${idx * 70}ms` }}
                  />
                </g>
              );
            })}
          </svg>

          {/* Aligned Readout Strip — strictly shares LTR column order with the SVG bars above */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-line text-center">
            {bars.map((bar) => (
              <div key={bar.id} className="flex flex-col items-center gap-0.5 min-w-0">
                <span dir="auto" className="text-[11px] text-ink-muted truncate max-w-full">
                  {barLabels[bar.id]}
                </span>
                <bdi dir="ltr" className="text-xs sm:text-sm font-semibold tnum text-ink truncate">
                  {formatMoney(bar.value)}
                </bdi>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Subscription Health Ring + Rewards Readout */}
      <Card padding="lg" className="lg:col-span-5 flex flex-col justify-between gap-4 text-start">
        <div className="flex items-center gap-2.5 min-w-0">
          <IconTile tone="ok" size="md">
            <PieChart />
          </IconTile>
          <div className="flex flex-col min-w-0">
            <h3 className="text-sm font-semibold text-ink truncate m-0">
              {t('admin.overview.subHealthTitle')}
            </h3>
            <p className="text-xs text-ink-muted truncate m-0">
              {t('admin.overview.subHealthSub')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* SVG Donut Ring */}
          <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
            <svg
              viewBox="0 0 112 112"
              className="w-24 h-24 -rotate-90"
              role="img"
              aria-label={t('admin.overview.activeRatioLabel')}
            >
              <defs>
                <linearGradient id="rs-sub-ring-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="var(--rs-ok)" />
                  <stop offset="100%" stopColor="var(--rs-info)" />
                </linearGradient>
              </defs>
              <circle
                cx={56}
                cy={56}
                r={44}
                fill="none"
                stroke="var(--rs-surface-3)"
                strokeWidth={10}
              />
              <circle
                cx={56}
                cy={56}
                r={44}
                fill="none"
                stroke="url(#rs-sub-ring-grad)"
                strokeWidth={10}
                strokeLinecap="round"
                strokeDasharray={split.circumference}
                strokeDashoffset={split.dashOffset}
                className="transition-[stroke-dashoffset] duration-700 ease-[var(--ease-out-calm)]"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <bdi dir="ltr" className="text-base font-semibold tnum text-ink leading-none">
                {formatNumber(split.activePercent)}
                {percentSign}
              </bdi>
            </div>
          </div>

          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <span className="text-xs text-ink-muted">{t('admin.overview.activeRatioLabel')}</span>

            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-ink-soft min-w-0 truncate">
                <span className="w-2 h-2 rounded-full bg-ok shrink-0" aria-hidden="true" />
                <span className="truncate">{t('admin.overview.activeSubs')}</span>
              </span>
              <span className="font-semibold tnum text-ink shrink-0">
                {formatNumber(split.active)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-ink-muted min-w-0 truncate">
                <span
                  className="w-2 h-2 rounded-full bg-ink-muted/40 shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">{t('admin.overview.inactiveSubs')}</span>
              </span>
              <span className="font-semibold tnum text-ink-soft shrink-0">
                {formatNumber(split.inactive)}
              </span>
            </div>
          </div>
        </div>

        {/* Cumulative Incentives Strip */}
        <div className="pt-3 border-t border-line flex items-center justify-between gap-2 flex-wrap text-xs">
          <div className="flex flex-col min-w-0">
            <span className="font-medium text-ink">{t('admin.overview.rewardsTitle')}</span>
            <span className="text-[11px] text-ink-muted">
              {t('admin.overview.rewardsNetLabel')}
            </span>
          </div>
          <div className="flex items-baseline gap-1 tnum">
            <bdi dir="ltr" className="text-sm font-semibold text-ink">
              {formatMoney(netRewards)}
            </bdi>
            <span className="text-[11px] text-ink-muted">{currency}</span>
          </div>
        </div>
      </Card>
    </div>
  );
};
