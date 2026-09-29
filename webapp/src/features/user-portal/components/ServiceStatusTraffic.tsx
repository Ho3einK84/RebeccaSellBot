import React from 'react';
import { Calendar } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n/LanguageContext.js';
import { toPersianDigits, formatBytes } from '../../../shared/lib/formatters.js';

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
  t: (key: string) => string
): ServiceStatusInfo {
  const normalized = (panelStatus || '').trim().toLowerCase();

  switch (normalized) {
    case 'active':
      return {
        type: 'active',
        label: t('user.services.statusActive'),
        badgeClass:
          'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20',
        dotClass: 'bg-emerald-500 animate-pulse',
        isPulsing: true,
      };
    case 'limited':
      return {
        type: 'limited',
        label: t('user.services.statusLimited'),
        badgeClass: 'bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20',
        dotClass: 'bg-amber-500',
        isPulsing: false,
      };
    case 'expired':
      return {
        type: 'expired',
        label: t('user.services.statusExpired'),
        badgeClass: 'bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/20',
        dotClass: 'bg-rose-500',
        isPulsing: false,
      };
    case 'disabled':
      return {
        type: 'disabled',
        label: t('user.services.statusDisabled'),
        badgeClass: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20',
        dotClass: 'bg-zinc-400 dark:bg-zinc-500',
        isPulsing: false,
      };
    case 'on_hold':
      return {
        type: 'on_hold',
        label: t('user.services.statusOnHold'),
        badgeClass: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
        dotClass: 'bg-yellow-500',
        isPulsing: false,
      };
    default:
      return {
        type: 'unknown',
        label: t('user.services.statusUnknown'),
        badgeClass: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20',
        dotClass: 'bg-zinc-400 dark:bg-zinc-500',
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
  t: (key: string) => string
): ServiceTrafficInfo {
  const formattedUsed = formatBytes(panelUsedTraffic ?? 0, locale);

  if (panelDataLimit === null || panelDataLimit === undefined) {
    return {
      isUnlimited: false,
      isUnknownLimit: true,
      formattedLimit: '—',
      formattedUsed,
      percentage: null,
      progressColorClass: 'bg-indigo-500',
    };
  }

  if (panelDataLimit === 0) {
    return {
      isUnlimited: true,
      isUnknownLimit: false,
      formattedLimit: t('user.services.unlimited'),
      formattedUsed,
      percentage: null,
      progressColorClass: 'bg-indigo-500',
    };
  }

  const limit = Math.max(0, panelDataLimit);
  const used = Math.max(0, panelUsedTraffic ?? 0);
  const percentage = Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
  const formattedLimit = formatBytes(limit, locale);

  const progressColorClass =
    percentage > 90 ? 'bg-rose-500' : percentage > 75 ? 'bg-amber-500' : 'bg-indigo-500';

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
  t: (key: string) => string,
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
  t: (key: string) => string
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

export const ServiceStatusBadge: React.FC<{
  status: string | null | undefined;
  showDot?: boolean;
  className?: string;
}> = ({ status, showDot = false, className = '' }) => {
  const { t } = useLanguage();
  const info = getServiceStatusInfo(status, t);

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${info.badgeClass} ${className}`}
    >
      {showDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${info.dotClass}`} />}
      <span>{info.label}</span>
    </span>
  );
};

export const ServiceAutoRenewBadge: React.FC<{
  enabled: boolean | null | undefined;
  className?: string;
}> = ({ enabled, className = '' }) => {
  const { t } = useLanguage();
  if (!enabled) return null;

  return (
    <span
      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 shrink-0 ${className}`}
    >
      {t('user.services.autoRenewEnabled')}
    </span>
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
      ? `(${locale === 'fa' ? toPersianDigits(info.percentage) : info.percentage}%)`
      : '';

  return (
    <div className={`w-full flex flex-col ${compact ? 'gap-1' : 'gap-1.5'} ${className}`}>
      <div className="flex justify-between items-center text-[11px] text-slate-500 dark:text-zinc-400">
        <span>{t('user.services.trafficUsed')}</span>
        <span className="font-mono font-semibold">
          {info.isUnlimited
            ? `${info.formattedUsed} / ${info.formattedLimit}`
            : info.isUnknownLimit
              ? `${info.formattedUsed} / —`
              : `${info.formattedUsed} / ${info.formattedLimit} ${percentLabel}`}
        </span>
      </div>

      {!info.isUnlimited && !info.isUnknownLimit && info.percentage !== null && (
        <div
          className={`w-full ${
            compact ? 'h-1.5' : 'h-2'
          } rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden`}
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
    <div
      className={`flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400 ${className}`}
    >
      <Calendar className="w-3.5 h-3.5 shrink-0" />
      <span>{info.remainingText}</span>
      {info.formattedDate !== '—' && (
        <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">
          ({info.formattedDate})
        </span>
      )}
    </div>
  );
};
