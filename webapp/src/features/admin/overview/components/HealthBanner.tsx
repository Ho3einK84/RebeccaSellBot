import React from 'react';
import { Activity, ChevronLeft } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { PanelHealth } from '@/shared/types/admin.js';

interface HealthBannerProps {
  panelHealth: PanelHealth | null;
  onSwitchToPanels: () => void;
}

/**
 * Compact alert strip. Previously a full card with an unlabeled link-sized
 * "پنل‌ها" chip (below the 44px tap target) — now the whole strip is the target
 * and the trailing affordance is a chevron, not a fake link.
 */
export const HealthBanner: React.FC<HealthBannerProps> = ({ panelHealth, onSwitchToPanels }) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();

  if (!panelHealth) return null;

  const isHealthOk = panelHealth.configured > 0 && panelHealth.healthy === panelHealth.configured;

  return (
    <button
      type="button"
      onClick={onSwitchToPanels}
      className={`press rs-focus flex w-full items-center gap-3 rounded-card border px-3.5 py-3 text-start transition-colors ${
        isHealthOk
          ? 'border-line bg-surface/70 hover:border-line-strong'
          : 'border-danger/30 bg-danger-soft hover:border-danger/50'
      }`}
      aria-label={t('admin.overview.panelHealthTitle')}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-tile border ${
          isHealthOk
            ? 'border-ok/25 bg-ok-soft text-ok'
            : 'border-danger/30 bg-danger-soft text-danger'
        }`}
        aria-hidden="true"
      >
        <Activity className="h-4.5 w-4.5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              isHealthOk ? 'bg-ok status-pulse' : 'bg-danger anim-breathe'
            }`}
            aria-hidden="true"
          />
          <span
            className={`truncate text-[12.5px] font-semibold ${isHealthOk ? 'text-ink' : 'text-danger'}`}
          >
            {isHealthOk ? t('admin.overview.panelHealthOk') : t('admin.overview.panelHealthError')}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
          {t('admin.overview.panelHealthSub', {
            healthy: formatNumber(panelHealth.healthy),
            configured: formatNumber(panelHealth.configured),
          })}
        </span>
      </span>

      <ChevronLeft
        className="h-4 w-4 shrink-0 text-ink-muted rtl:rotate-0 ltr:rotate-180"
        aria-hidden="true"
      />
    </button>
  );
};
