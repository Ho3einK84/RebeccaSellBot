import React from 'react';
import { Calendar } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { toPersianDigits, formatBytes } from '@/shared/lib/formatters.js';
import { normalizeDataLimit } from '@/shared/lib/traffic.js';
import { Badge, type BadgeVariant } from '@/shared/components/ui/Badge.js';
import { ProgressBar } from '@/shared/components/ui/ProgressBar.js';
import type { TileTone } from '@/shared/components/ui/IconTile.js';
import type { NestedTranslationKey } from '@/shared/i18n/types.js';

export { normalizeDataLimit };

type TranslateFn = (key: NestedTranslationKey) => string;

export type ServiceStatusType =
  'active' | 'limited' | 'expired' | 'disabled' | 'on_hold' | 'unknown';

export interface ServiceStatusInfo {
  type: ServiceStatusType;
  label: string;
  badgeClass: string;
  dotClass: string;
  isPulsing: boolean;
}

export interface ServiceTrafficInfo {
  isUnlimited: boolean;
  isUnknownLimit: boolean;
  formattedLimit: string;
  formattedUsed: string;
  percentage: number | null;
  progressColorClass: string;
}

export interface ServiceExpiryInfo {
  isExpired: boolean;
  remainingText: string;
  formattedDate: string;
  daysRemaining: number | null;
}

/**
 * Maps panelStatus to a standardized status object with label, dot color, and AA+ badge classes.
 */
export function getServiceStatusInfo(
  panelStatus: string | null | undefined,
  t: TranslateFn
): ServiceStatusInfo {
  const normalized = (panelStatus || '').trim().toLowerCase();

  switch (normalized) {
    case 'active':
      return {
        type: 'active',
        label: t('user.services.statusActive'),
        badgeClass: 'bg-ok-soft text-ok-fg border-ok/25',
        dotClass: 'bg-ok',
        isPulsing: false,
      };
    case 'limited':
      return {
        type: 'limited',
        label: t('user.services.statusLimited'),
        badgeClass: 'bg-warn-soft text-warn-fg border-warn/25',
        dotClass: 'bg-warn',
        isPulsing: false,
      };
    case 'expired':
      return {
        type: 'expired',
        label: t('user.services.statusExpired'),
        badgeClass: 'bg-danger-soft text-danger-fg border-danger/25',
        dotClass: 'bg-danger',
        isPulsing: false,
      };
    case 'disabled':
      return {
        type: 'disabled',
        label: t('user.services.statusDisabled'),
        badgeClass: 'bg-surface-2 text-ink-muted border-line',
        dotClass: 'bg-ink-muted',
        isPulsing: false,
      };
    case 'on_hold':
      return {
        type: 'on_hold',
        label: t('user.services.statusOnHold'),
        badgeClass: 'bg-warn-soft text-warn-fg border-warn/25',
        dotClass: 'bg-warn',
        isPulsing: false,
      };
    default:
      return {
        type: 'unknown',
        label: t('user.services.statusUnknown'),
        badgeClass: 'bg-surface-2 text-ink-muted border-line',
        dotClass: 'bg-ink-muted',
        isPulsing: false,
      };
  }
}

/**
 * Calculates traffic usage metrics.
 * Limits under 0.5 GB do NOT round down to 0 or display as unlimited.
 */
export function getServiceTrafficInfo(
  panelDataLimit: number | null | undefined,
  panelUsedTraffic: number | null | undefined,
  locale: string = 'fa',
  t: TranslateFn
): ServiceTrafficInfo {
  const formattedUsed = formatBytes(panelUsedTraffic ?? 0, locale);
  const normalized = normalizeDataLimit(panelDataLimit);

  if (normalized === undefined) {
    return {
      isUnlimited: false,
      isUnknownLimit: true,
      formattedLimit: '—',
      formattedUsed,
      percentage: null,
      progressColorClass: 'bg-brand',
    };
  }

  if (normalized === null) {
    return {
      isUnlimited: true,
      isUnknownLimit: false,
      formattedLimit: t('user.services.unlimited'),
      formattedUsed,
      percentage: null,
      progressColorClass: 'bg-brand',
    };
  }

  const limit = Math.max(0, normalized);
  const used = Math.max(0, panelUsedTraffic ?? 0);
  const percentage = Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
  const formattedLimit = formatBytes(limit, locale);

  const progressColorClass =
    percentage > 90 ? 'bg-danger' : percentage > 75 ? 'bg-warn' : 'bg-brand';

  return {
    isUnlimited: false,
    isUnknownLimit: false,
    formattedLimit,
    formattedUsed,
    percentage,
    progressColorClass,
  };
}

/**
 * Calculates expiry info including remaining days and formatted localized expiry date.
 */
export function getServiceExpiryInfo(
  panelExpire: number | null | undefined,
  locale: string = 'fa',
  t: TranslateFn,
  nowSec?: number
): ServiceExpiryInfo {
  if (panelExpire === null || panelExpire === undefined) {
    return {
      isExpired: false,
      remainingText: '—',
      formattedDate: '—',
      daysRemaining: null,
    };
  }

  const currentSec = nowSec ?? Math.floor(Date.now() / 1000);
  const diffSec = panelExpire - currentSec;

  const expireDate = new Date(panelExpire * 1000);
  const formattedDate = !isNaN(expireDate.getTime())
    ? expireDate.toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-US')
    : '—';

  if (diffSec <= 0) {
    return {
      isExpired: true,
      remainingText: t('user.services.expired'),
      formattedDate,
      daysRemaining: 0,
    };
  }

  if (diffSec < 86400) {
    return {
      isExpired: false,
      remainingText: t('user.services.lessThanOneDay'),
      formattedDate,
      daysRemaining: 1,
    };
  }

  const days = Math.ceil(diffSec / 86400);
  const daysStr = locale === 'fa' ? toPersianDigits(days) : String(days);
  const remainingText = t('user.services.remainingDays').replace('{days}', daysStr);

  return {
    isExpired: false,
    remainingText,
    formattedDate,
    daysRemaining: days,
  };
}

/**
 * Formats service creation date with localized label.
 */
export function formatServiceCreatedDate(
  createdAt: string | null | undefined,
  locale: string = 'fa',
  t: TranslateFn
): string {
  if (!createdAt) return '—';
  const date = new Date(createdAt);
  const dateStr = !isNaN(date.getTime())
    ? date.toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-US')
    : createdAt;
  return t('user.services.createdAtLabel').replace('{date}', dateStr);
}

/**
 * Checks whether auto renew is active.
 */
export function isAutoRenewActive(autoRenewEnabled: boolean | null | undefined): boolean {
  return Boolean(autoRenewEnabled);
}

export const ServiceStatusDot: React.FC<{
  status: string | null | undefined;
  className?: string;
}> = ({ status, className = '' }) => {
  const { t } = useLanguage();
  const info = getServiceStatusInfo(status, t);
  return <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${info.dotClass} ${className}`} />;
};

const statusVariantMap: Record<ServiceStatusType, BadgeVariant> = {
  active: 'success',
  limited: 'warning',
  expired: 'error',
  disabled: 'neutral',
  on_hold: 'warning',
  unknown: 'neutral',
};

export const ServiceStatusBadge: React.FC<{
  status: string | null | undefined;
  showDot?: boolean;
  className?: string;
}> = ({ status, showDot = false, className = '' }) => {
  const { t } = useLanguage();
  const info = getServiceStatusInfo(status, t);

  return (
    <Badge
      variant={statusVariantMap[info.type] ?? 'neutral'}
      size="xs"
      dot={showDot}
      pulse={info.isPulsing}
      className={className}
    >
      {info.label}
    </Badge>
  );
};

export const ServiceAutoRenewBadge: React.FC<{
  enabled: boolean | null | undefined;
  className?: string;
}> = ({ enabled, className = '' }) => {
  const { t } = useLanguage();
  if (!enabled) return null;

  return (
    <Badge variant="primary" size="xs" className={className}>
      {t('user.services.autoRenewEnabled')}
    </Badge>
  );
};

export const ServiceTrafficBar: React.FC<{
  dataLimit: number | null | undefined;
  usedTraffic: number | null | undefined;
  compact?: boolean;
  hideLabel?: boolean;
  className?: string;
}> = ({ dataLimit, usedTraffic, compact = false, hideLabel = false, className = '' }) => {
  const { t, locale } = useLanguage();
  const info = getServiceTrafficInfo(dataLimit, usedTraffic, locale, t);

  const percentLabel =
    info.percentage !== null
      ? `(${locale === 'fa' ? `${toPersianDigits(info.percentage)}٪` : `${info.percentage}%`})`
      : '';

  const barTone: TileTone =
    info.percentage !== null && info.percentage > 90
      ? 'danger'
      : info.percentage !== null && info.percentage > 75
        ? 'warn'
        : 'brand';

  return (
    <div className={`w-full flex flex-col ${compact ? 'gap-1' : 'gap-1.5'} ${className}`}>
      <div
        className={`flex items-center ${hideLabel ? 'justify-end' : 'justify-between'} gap-2 text-[11px] text-ink-muted`}
      >
        {!hideLabel ? <span className="shrink-0">{t('user.services.trafficUsed')}</span> : null}
        {/* LRM marks isolate the slash so "used / total" keeps its reading order in RTL */}
        <span className="tnum shrink-0 font-semibold text-ink-soft">
          {info.isUnlimited
            ? `${info.formattedUsed} ‎/‎ ${info.formattedLimit}`
            : info.isUnknownLimit
              ? `${info.formattedUsed} / —`
              : `${info.formattedUsed} ‎/‎ ${info.formattedLimit} ${percentLabel}`}
        </span>
      </div>

      {!info.isUnlimited && !info.isUnknownLimit && info.percentage !== null && (
        <ProgressBar
          value={info.percentage}
          tone={barTone}
          size={compact ? 'sm' : 'md'}
          label={t('user.services.trafficUsed')}
        />
      )}
    </div>
  );
};

export const ServiceExpiryView: React.FC<{
  expireTimestampSec: number | null | undefined;
  className?: string;
}> = ({ expireTimestampSec, className = '' }) => {
  const { t, locale } = useLanguage();
  const info = getServiceExpiryInfo(expireTimestampSec, locale, t);

  return (
    <div className={`flex items-center gap-1.5 text-[11px] text-ink-muted ${className}`}>
      <Calendar className="w-3.5 h-3.5 shrink-0" />
      <span>{info.remainingText}</span>
      {info.formattedDate !== '—' && (
        <span className="tnum text-[10px] text-ink-soft">({info.formattedDate})</span>
      )}
    </div>
  );
};
