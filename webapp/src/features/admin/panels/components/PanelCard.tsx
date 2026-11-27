import React from 'react';
import {
  RefreshCw,
  KeyRound,
  Settings,
  Layers,
  Star,
  Target,
  Power,
  Trash2,
  Copy,
  Check,
  Package,
  Users,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useToast } from '@/shared/components/ui/Toast.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import type { PanelSummary } from '@/shared/types/admin.js';

interface PanelCardProps {
  panel: PanelSummary;
  onTest: (id: string) => void;
  onEdit: (panel: PanelSummary) => void;
  onManageServices: (panel: PanelSummary) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onSetDefault: (id: string) => void;
  onDelete: (panel: PanelSummary) => void;
  isTesting: boolean;
  isToggling?: boolean;
  isSettingDefault?: boolean;
}

export const PanelCard: React.FC<PanelCardProps> = ({
  panel,
  onTest,
  onEdit,
  onManageServices,
  onToggle,
  onSetDefault,
  onDelete,
  isTesting,
  isToggling = false,
  isSettingDefault = false,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();
  const { textPrimary, textSecondary, textMuted } = useThemeTokens();
  const { copy, isCopied } = useCopy();
  const { notify } = useToast();

  const isHealthy = panel.healthy !== false;
  const isEnabled = panel.enabled;

  const latencyVariant =
    panel.latencyMs === undefined
      ? 'neutral'
      : panel.latencyMs < 200
        ? 'success'
        : panel.latencyMs < 500
          ? 'warning'
          : 'error';

  return (
    <Card
      padding="md"
      className={`space-y-4 hover:border-line-strong text-start ${!isEnabled ? 'opacity-85' : ''}`}
    >
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className={`text-base font-semibold m-0 ${textPrimary}`}>{panel.name}</h3>

          {panel.isDefault && (
            <Badge variant="warning" size="xs">
              <Star className="w-3 h-3 fill-current" />
              <span>{t('admin.panels.default')}</span>
            </Badge>
          )}

          {!isEnabled ? (
            <Badge variant="neutral" size="xs">
              {t('admin.panels.disabledBadge')}
            </Badge>
          ) : (
            <Badge variant={isHealthy ? 'success' : 'error'} dot size="xs">
              {isHealthy ? t('admin.panels.online') : t('admin.panels.offline')}
            </Badge>
          )}

          {isEnabled && panel.latencyMs !== undefined && (
            <Badge variant={latencyVariant} size="xs" className="tnum">
              {t('admin.panels.latency', { ms: formatNumber(panel.latencyMs) })}
            </Badge>
          )}

          {isEnabled && panel.isAvailableForCreate === false && (
            <Badge variant="error" size="xs">
              {t('admin.panels.capacityFullBadge')}
            </Badge>
          )}

          {isEnabled &&
            panel.isAvailableForCreate !== false &&
            typeof panel.utilizationPercent === 'number' &&
            panel.utilizationPercent >= 80 && (
              <Badge variant="warning" size="xs" className="tnum">
                {t('admin.panels.lowCapacityBadge')} ({formatNumber(panel.utilizationPercent)}%)
              </Badge>
            )}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onEdit(panel)}
            title={t('admin.panels.editBtn')}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>{t('admin.panels.editBtn')}</span>
          </Button>

          <Button
            type="button"
            size="xs"
            variant="secondary"
            loading={isTesting}
            disabled={!isEnabled}
            onClick={() => onTest(panel.id)}
            title={t('admin.panels.testBtn')}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t('admin.panels.testBtn')}</span>
          </Button>
        </div>
      </div>

      {/* Endpoint & Auth */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <Card subCard padding="sm" className="space-y-1 sm:col-span-2">
          <div className="flex items-center justify-between">
            <span className={`block text-[11px] font-medium ${textMuted}`}>
              {t('admin.panels.address')}
            </span>
            {panel.baseUrl && (
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center rounded-ctl hover:bg-surface-3 text-ink-muted hover:text-ink cursor-pointer rs-focus"
                onClick={async () => {
                  const ok = await copy(panel.baseUrl || '', `panel-url-${panel.id}`);
                  if (ok) notify(t('common.copied'), 'success');
                }}
                title={t('common.copy')}
                aria-label={t('common.copy')}
              >
                {isCopied(`panel-url-${panel.id}`) ? (
                  <Check className="w-3.5 h-3.5 text-ok-fg" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
          <code dir="ltr" className="break-all tnum text-xs text-brand-fg block text-start">
            {panel.baseUrl || '—'}
          </code>
        </Card>

        <Card subCard padding="sm" className="space-y-1">
          <span className={`block text-[11px] font-medium ${textMuted}`}>
            {t('admin.panels.authMode')}
          </span>
          <div className="flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-brand-fg shrink-0" />
            <span className={`font-medium ${textPrimary}`}>
              {panel.credentialMode === 'api_key'
                ? t('admin.panels.authModeApiKey')
                : panel.credentialMode === 'password'
                  ? t('admin.panels.authModePassword')
                  : t('admin.panels.authModeNone')}
            </span>
          </div>
        </Card>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-3 gap-2">
        <Card subCard padding="sm" className="text-center space-y-0.5">
          <div className="flex items-center justify-center gap-1 text-[11px] text-ink-muted">
            <Users className="w-3 h-3 text-ok-fg" />
            <span>{t('admin.panels.configsCountLabel')}</span>
          </div>
          <div className="text-sm font-semibold tnum text-ok-fg">
            {formatNumber(panel.activeConfigsCount ?? 0)}
          </div>
        </Card>

        <Card subCard padding="sm" className="text-center space-y-0.5">
          <div className="flex items-center justify-center gap-1 text-[11px] text-ink-muted">
            <Package className="w-3 h-3 text-brand-fg" />
            <span>{t('admin.panels.packagesCountLabel')}</span>
          </div>
          <div className="text-sm font-semibold tnum text-brand-fg">
            {formatNumber(panel.packagesCount ?? 0)}
          </div>
        </Card>

        <Card subCard padding="sm" className="text-center space-y-0.5">
          <div className="flex items-center justify-center gap-1 text-[11px] text-ink-muted">
            <Layers className="w-3 h-3 text-brand-fg" />
            <span>{t('admin.panels.servicesCountLabel')}</span>
          </div>
          <div className="text-sm font-semibold tnum text-brand-fg">
            {formatNumber(panel.services.length)}
          </div>
        </Card>
      </div>

      {/* Capacity & Limits Strip (when any limit is configured) */}
      {(panel.maxConfigs != null ||
        panel.stockRemaining != null ||
        panel.dailyCreateLimit != null) && (
        <Card subCard padding="sm" className="space-y-2">
          {panel.maxConfigs != null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px] tnum">
                <span className="font-medium text-ink-soft">
                  {t('admin.panels.maxConfigsField')}
                </span>
                <span className="font-semibold text-ink">
                  {t('admin.panels.capacityUsageLabel', {
                    used: formatNumber(
                      (panel.activeConfigsCount ?? 0) + (panel.reservedCount ?? 0)
                    ),
                    max: formatNumber(panel.maxConfigs),
                  })}
                  {(panel.reservedCount ?? 0) > 0 && (
                    <span className="text-ink-muted ms-1">
                      (
                      {t('admin.panels.reservedHint', {
                        count: formatNumber(panel.reservedCount!),
                      })}
                      )
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    (panel.utilizationPercent ?? 0) >= 95
                      ? 'bg-danger'
                      : (panel.utilizationPercent ?? 0) >= 75
                        ? 'bg-warn'
                        : 'bg-ok'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, panel.utilizationPercent ?? 0))}%`,
                  }}
                />
              </div>
            </div>
          )}

          {(panel.stockRemaining != null || panel.dailyCreateLimit != null) && (
            <div className="flex items-center gap-2 flex-wrap">
              {panel.stockRemaining != null && (
                <Badge
                  variant={
                    panel.stockRemaining <= 0
                      ? 'error'
                      : panel.stockRemaining <= 5
                        ? 'warning'
                        : 'success'
                  }
                  size="xs"
                  className="tnum"
                >
                  {t('admin.panels.stockLabel', { count: formatNumber(panel.stockRemaining) })}
                </Badge>
              )}
              {panel.dailyCreateLimit != null && (
                <Badge
                  variant={
                    (panel.todayCreatedCount ?? 0) >= panel.dailyCreateLimit ? 'error' : 'info'
                  }
                  size="xs"
                  className="tnum"
                >
                  {t('admin.panels.dailyUsageLabel', {
                    today: formatNumber(panel.todayCreatedCount ?? 0),
                    limit: formatNumber(panel.dailyCreateLimit),
                  })}
                </Badge>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Services Section */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between">
          <span className={`text-xs font-medium ${textSecondary}`}>
            {t('admin.panels.connectedServices')}
          </span>
          <button
            type="button"
            className="text-xs font-medium text-brand-fg hover:underline cursor-pointer flex items-center gap-1 rs-focus rounded-ctl px-1.5 py-0.5"
            onClick={() => onManageServices(panel)}
          >
            <Layers className="w-3 h-3" />
            <span>{t('admin.panels.manageServicesBtn')}</span>
          </button>
        </div>

        {panel.services.length > 0 ? (
          <div className="flex gap-2 flex-wrap">
            {panel.services.map((s) => {
              const svcPaused = s.enabled === false;
              const svcFull = !svcPaused && s.isAvailableForCreate === false;
              return (
                <span
                  key={s.serviceId}
                  className={`inline-flex items-center gap-1.5 text-xs py-1 px-2.5 rounded-ctl border tnum ${
                    svcPaused
                      ? 'bg-surface-2/60 border-line text-ink-muted opacity-70'
                      : svcFull
                        ? 'bg-danger-soft/60 border-danger/30 text-danger-fg'
                        : 'bg-surface-2 border-line text-ink-soft'
                  }`}
                >
                  <span
                    className={`font-medium ${svcPaused ? 'line-through text-ink-muted' : 'text-ink'}`}
                  >
                    {s.name}
                  </span>
                  <bdi dir="ltr" className="text-[11px] font-mono text-ink-muted tnum">
                    ({s.serviceId})
                  </bdi>
                  {svcPaused && (
                    <Badge variant="neutral" size="xs">
                      {t('admin.panels.servicePausedBadge')}
                    </Badge>
                  )}
                  {svcFull && (
                    <Badge variant="error" size="xs">
                      {t('admin.panels.capacityFullBadge')}
                    </Badge>
                  )}
                  {!svcPaused && !svcFull && s.remainingCapacity != null && (
                    <span className="text-[10px] text-ink-muted tnum">
                      ({formatNumber(s.remainingCapacity)})
                    </span>
                  )}
                  {s.isDefault && (
                    <span
                      className="inline-flex items-center text-warn-fg"
                      title={t('admin.panels.defaultService')}
                    >
                      <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                    </span>
                  )}
                  {s.isCustomTarget && (
                    <span
                      className="inline-flex items-center text-info-fg"
                      title={t('admin.panels.customTargetBadge')}
                    >
                      <Target className="w-3 h-3" aria-hidden="true" />
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        ) : (
          <p className={`text-xs m-0 ${textMuted}`}>{t('admin.panels.noServices')}</p>
        )}
      </div>

      {/* Bottom Action Bar */}
      <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-line flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="xs"
            variant={isEnabled ? 'outline' : 'success'}
            loading={isToggling}
            onClick={() => onToggle(panel.id, !isEnabled)}
            title={isEnabled ? t('admin.panels.disableBtn') : t('admin.panels.enableBtn')}
          >
            <Power className="w-3 h-3" />
            <span>{isEnabled ? t('admin.panels.disableBtn') : t('admin.panels.enableBtn')}</span>
          </Button>

          {!panel.isDefault && isEnabled && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              loading={isSettingDefault}
              onClick={() => onSetDefault(panel.id)}
              title={t('admin.panels.makeDefaultBtn')}
            >
              <Star className="w-3 h-3" />
              <span>{t('admin.panels.makeDefaultBtn')}</span>
            </Button>
          )}
        </div>

        {!panel.isDefault && (
          <Button
            type="button"
            size="xs"
            variant="danger"
            onClick={() => onDelete(panel)}
            title={t('admin.panels.deleteBtn')}
          >
            <Trash2 className="w-3 h-3" />
            <span>{t('common.delete')}</span>
          </Button>
        )}
      </div>
    </Card>
  );
};
