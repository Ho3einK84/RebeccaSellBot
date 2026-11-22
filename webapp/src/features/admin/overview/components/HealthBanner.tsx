import React from 'react';
import { Activity, ChevronLeft } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import type { PanelHealth } from '@/shared/types/admin.js';

interface HealthBannerProps {
  panelHealth: PanelHealth | null;
  dbLatencyMs?: number;
  onSwitchToPanels: () => void;
}

/** Compact matte health status bar that links directly to the Panels view. */
export const HealthBanner: React.FC<HealthBannerProps> = ({
  panelHealth,
  dbLatencyMs,
  onSwitchToPanels,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();

  if (!panelHealth) return null;

  const isUnconfigured = panelHealth.configured === 0;
  const isHealthOk = !isUnconfigured && panelHealth.healthy === panelHealth.configured;

  const tone = isUnconfigured ? 'neutral' : isHealthOk ? 'ok' : 'danger';
  const hasPanelLatency = typeof panelHealth.latencyMs === 'number' && panelHealth.latencyMs >= 0;
  const hasDbLatency = typeof dbLatencyMs === 'number' && dbLatencyMs >= 0;
  const latencyText = hasPanelLatency
    ? hasDbLatency
      ? t('admin.overview.latencyInfo', {
          panelMs: formatNumber(panelHealth.latencyMs!),
          dbMs: formatNumber(dbLatencyMs!),
        })
      : t('admin.overview.latencyPanelOnly', {
          panelMs: formatNumber(panelHealth.latencyMs!),
        })
    : null;

  return (
    <button
      type="button"
      onClick={onSwitchToPanels}
      className={`group rs-card-interactive press rs-focus flex w-full items-center gap-3 rounded-card border px-3.5 py-3 text-start cursor-pointer shadow-[var(--shadow-card)] ${
        isUnconfigured || isHealthOk
          ? 'border-line bg-surface hover:bg-surface-2'
          : 'border-danger/30 bg-danger-soft hover:border-danger/50'
      }`}
      aria-label={t('admin.overview.panelHealthTitle')}
    >
      <IconTile tone={tone} size="md">
        <Activity />
      </IconTile>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              isUnconfigured
                ? 'bg-ink-muted'
                : isHealthOk
                  ? 'bg-ok ring-2 ring-ok/25'
                  : 'bg-danger ring-2 ring-danger/25'
            }`}
            aria-hidden="true"
          />
          <span
            className={`truncate text-[13px] font-semibold ${
              isUnconfigured ? 'text-ink-soft' : isHealthOk ? 'text-ink' : 'text-danger-fg'
            }`}
          >
            {isUnconfigured
              ? t('admin.overview.panelHealthEmpty')
              : isHealthOk
                ? t('admin.overview.panelHealthOk')
                : t('admin.overview.panelHealthError')}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 flex-wrap text-xs text-ink-muted tnum">
          <span className="truncate">
            {t('admin.overview.panelHealthSub', {
              healthy: formatNumber(panelHealth.healthy),
              configured: formatNumber(panelHealth.configured),
            })}
          </span>
          {latencyText ? (
            <>
              <span className="opacity-40">·</span>
              <span className="text-[11px] text-ink-muted/90">{latencyText}</span>
            </>
          ) : null}
        </span>
      </span>

      <ChevronLeft
        className="h-4 w-4 shrink-0 text-ink-muted rtl:rotate-0 ltr:rotate-180 transition-transform duration-200 group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
};
