import React from 'react';
import { Calendar } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n/LanguageContext.js';
import { toPersianDigits, formatBytes } from '../../../shared/lib/formatters.js';
import { normalizeDataLimit } from '../../../shared/lib/traffic.js';
import { Badge, type BadgeVariant } from '@/shared/components/ui/Badge.js';
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
 * Maps panelStatus to a standardized status object with label, dot color, and badge classes.
 * Pulsing green dot is only applied for 'active' status.
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
        badgeClass: 'bg-ok/10 text-ok border-ok/20',
        dotClass: 'bg-ok animate-pulse',
        isPulsing: true,
      };
    case 'limited':
      return {
        type: 'limited',
        label: t('user.services.statusLimited'),
        badgeClass: 'bg-warn/10 text-warn border-warn/20',
        dotClass: 'bg-warn',
        isPulsing: false,
      };
    case 'expired':
      return {
        type: 'expired',
        label: t('user.services.statusExpired'),
        badgeClass: 'bg-danger/10 text-danger border-danger/20',
        dotClass: 'bg-danger',
        isPulsing: false,
      };
    case 'disabled':
      return {
        type: 'disabled',
        label: t('user.services.statusDisabled'),
        badgeClass: 'bg-zinc-500/10 text-ink-muted border-zinc-500/20',
        dotClass: 'bg-zinc-400',
        isPulsing: false,
      };
    case 'on_hold':
      return {
        type: 'on_hold',
        label: t('user.services.statusOnHold'),
        badgeClass: 'bg-warn/10 text-warn border-warn/20',
        dotClass: 'bg-warn',
        isPulsing: false,
      };
    default:
      return {
        type: 'unknown',
        label: t('user.services.statusUnknown'),
        badgeClass: 'bg-zinc-500/10 text-ink-muted border-zinc-500/20',
        dotClass: 'bg-zinc-400',
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
  className?: string;
}> = ({ dataLimit, usedTraffic, compact = false, className = '' }) => {
  const { t, locale } = useLanguage();
  const info = getServiceTrafficInfo(dataLimit, usedTraffic, locale, t);

  const percentLabel =
    info.percentage !== null
      ? `(${locale === 'fa' ? `${toPersianDigits(info.percentage)}٪` : `${info.percentage}%`})`
      : '';

  return (
    <div className={`w-full flex flex-col ${compact ? 'gap-1' : 'gap-1.5'} ${className}`}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted">
        <span className="shrink-0">{t('user.services.trafficUsed')}</span>
        {/* LRM marks isolate the slash so "used / total" keeps its reading order in RTL */}
        <span className="tnum shrink-0 font-semibold">
          {info.isUnlimited
            ? `${info.formattedUsed} ‎/‎ ${info.formattedLimit}`
            : info.isUnknownLimit
              ? `${info.formattedUsed} / —`
              : `${info.formattedUsed} ‎/‎ ${info.formattedLimit} ${percentLabel}`}
        </span>
      </div>

      {!info.isUnlimited && !info.isUnknownLimit && info.percentage !== null && (
        <div
          className={`w-full ${compact ? 'h-1.5' : 'h-2'} rounded-full overflow-hidden bg-surface-3`}
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ${info.progressColorClass}`}
            style={{ width: `${info.percentage}%` }}
          />
        </div>
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
