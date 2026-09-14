import React from 'react';
import {
  RotateCw,
  KeyRound,
  Settings,
  Layers,
  Star,
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
  const { isDark, subCardClass, textPrimary, textSecondary, textMuted } = useThemeTokens();
  const { copy, isCopied } = useCopy();

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
      className={`p-4 sm:p-5 space-y-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-white/20 group ${
        !isEnabled ? 'opacity-85' : ''
      }`}
    >
      {/* Top Header: Name, Status Badges, Test & Edit Buttons */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h3 className={`text-base font-bold m-0 tracking-tight ${textPrimary}`}>{panel.name}</h3>

          {panel.isDefault && (
            <Badge variant="warning" className="text-[10px]">
              <Star className="w-3 h-3 fill-current" />
              <span>{t('admin.panels.default')}</span>
            </Badge>
          )}

          {!isEnabled ? (
            <Badge variant="neutral" className="text-[10px]">
              {t('admin.panels.disabledBadge')}
            </Badge>
          ) : (
            <Badge
              variant={isHealthy ? 'success' : 'error'}
              dot
              pulse={isHealthy}
              className="text-[10px]"
            >
              {isHealthy ? t('admin.panels.online') : t('admin.panels.offline')}
            </Badge>
          )}

          {isEnabled && panel.latencyMs !== undefined && (
            <Badge variant={latencyVariant} className="text-[10px] font-mono">
              {t('admin.panels.latency', { ms: formatNumber(panel.latencyMs) })}
            </Badge>
          )}
        </div>

        {/* Header Action Buttons */}
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
            <RotateCw className="w-3.5 h-3.5" />
            <span>{t('admin.panels.testBtn')}</span>
          </Button>
        </div>
      </div>

      {/* Grid: Endpoint URL & Credentials + Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        {/* Endpoint URL */}
        <div className={`p-3 rounded-xl border space-y-1 sm:col-span-2 ${subCardClass}`}>
          <div className="flex items-center justify-between">
            <span className={`block text-[11px] font-medium ${textMuted}`}>
              {t('admin.panels.address')}
            </span>
            {panel.baseUrl && (
              <button
                type="button"
                className="p-1 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                onClick={() => copy(panel.baseUrl || '', `panel-url-${panel.id}`)}
                title={t('common.copy')}
              >
                {isCopied(`panel-url-${panel.id}`) ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            )}
          </div>
          <code
            dir="ltr"
            className="break-all font-mono text-[11px] text-indigo-500 block text-start"
          >
            {panel.baseUrl || '—'}
          </code>
        </div>

        {/* Auth & Credential Mode */}
        <div className={`p-3 rounded-xl border space-y-1 ${subCardClass}`}>
          <span className={`block text-[11px] font-medium ${textMuted}`}>
            {t('admin.panels.authMode')}
          </span>
          <div className="flex items-center gap-1.5 font-mono">
            <KeyRound className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span dir="ltr" className={textPrimary}>
              {panel.credentialMode}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-3 gap-2">
        <div
          className={`p-2.5 rounded-xl border text-center space-y-0.5 ${
            isDark ? 'bg-white/[0.02] border-white/[0.06]' : 'bg-slate-50 border-slate-200/70'
          }`}
        >
          <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500 dark:text-zinc-400">
            <Users className="w-3 h-3 text-emerald-500" />
            <span>{t('admin.panels.configsCountLabel')}</span>
          </div>
          <div className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">
            {formatNumber(panel.activeConfigsCount ?? 0)}
          </div>
        </div>

        <div
          className={`p-2.5 rounded-xl border text-center space-y-0.5 ${
            isDark ? 'bg-white/[0.02] border-white/[0.06]' : 'bg-slate-50 border-slate-200/70'
          }`}
        >
          <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500 dark:text-zinc-400">
            <Package className="w-3 h-3 text-indigo-500" />
            <span>{t('admin.panels.packagesCountLabel')}</span>
          </div>
          <div className="text-sm font-bold font-mono text-indigo-600 dark:text-indigo-400">
            {formatNumber(panel.packagesCount ?? 0)}
          </div>
        </div>

        <div
          className={`p-2.5 rounded-xl border text-center space-y-0.5 ${
            isDark ? 'bg-white/[0.02] border-white/[0.06]' : 'bg-slate-50 border-slate-200/70'
          }`}
        >
          <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500 dark:text-zinc-400">
            <Layers className="w-3 h-3 text-violet-500" />
            <span>{t('admin.panels.servicesCountLabel')}</span>
          </div>
          <div className="text-sm font-bold font-mono text-violet-600 dark:text-violet-400">
            {formatNumber(panel.services.length)}
          </div>
        </div>
      </div>

      {/* Services Section */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between">
          <span className={`text-xs font-medium ${textSecondary}`}>
            {t('admin.panels.connectedServices')}
          </span>
          <button
            type="button"
            className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-600 cursor-pointer flex items-center gap-1"
            onClick={() => onManageServices(panel)}
          >
            <Layers className="w-3 h-3" />
            <span>{t('admin.panels.manageServicesBtn')}</span>
          </button>
        </div>

        {panel.services.length > 0 ? (
          <div className="flex gap-2 flex-wrap">
            {panel.services.map((s) => (
              <span
                key={s.serviceId}
                className={`inline-flex items-center gap-1.5 text-xs py-1 px-2.5 rounded-lg border font-mono ${
                  isDark
                    ? 'bg-white/[0.03] border-white/10 text-zinc-300'
                    : 'bg-slate-100 border-slate-200/80 text-slate-700'
                }`}
              >
                <span className="font-sans font-medium">{s.name}</span>
                <span dir="ltr" className="text-[10px] text-slate-400 font-mono">
                  ({s.serviceId})
                </span>
                {s.isDefault && (
                  <span
                    className="inline-flex items-center text-[10px] text-amber-500 font-sans"
                    title={t('admin.panels.defaultService')}
                  >
                    ⭐
                  </span>
                )}
                {s.isCustomTarget && (
                  <span
                    className="inline-flex items-center text-[10px] text-sky-500 font-sans"
                    title={t('admin.panels.customTargetBadge')}
                  >
                    🎯
                  </span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className={`text-xs m-0 ${textMuted}`}>{t('admin.panels.noServices')}</p>
        )}
      </div>

      {/* Bottom Action Bar: Toggle, Set Default, Delete */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-white/[0.08] flex-wrap">
        <div className="flex items-center gap-2">
          {/* Enable / Disable Toggle */}
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

          {/* Set Default Panel */}
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

        {/* Delete Panel */}
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
