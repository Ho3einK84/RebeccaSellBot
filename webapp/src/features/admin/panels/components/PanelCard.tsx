import React from 'react';
import { RotateCw, KeyRound } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Card } from '@/shared/components/ui/Card.js';
import type { PanelSummary } from '@/shared/types/admin.js';

interface PanelCardProps {
  panel: PanelSummary;
  onTest: (id: string) => void;
  isTesting: boolean;
}

export const PanelCard: React.FC<PanelCardProps> = ({ panel, onTest, isTesting }) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();
  const { isDark, subCardClass, textPrimary, textSecondary, textMuted } = useThemeTokens();

  const isHealthy = panel.healthy !== false;

  return (
    <Card className="p-4 sm:p-5 space-y-4 transition-all hover:border-indigo-500/40">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full shrink-0 ${
                isHealthy ? 'bg-emerald-500 status-pulse' : 'bg-rose-500'
              }`}
            />
            <h3 className={`text-base font-bold m-0 ${textPrimary}`}>{panel.name}</h3>
          </div>

          {panel.isDefault && (
            <span className="badge badge-warning badge-sm text-[10px] font-medium">
              {t('admin.panels.default')}
            </span>
          )}

          <span
            className={`badge badge-sm text-[10px] font-medium ${
              isHealthy ? 'badge-success text-white' : 'badge-error text-white'
            }`}
          >
            {isHealthy ? t('admin.panels.online') : t('admin.panels.offline')}
          </span>

          {panel.latencyMs !== undefined && (
            <span
              className={`badge badge-sm text-[10px] font-mono border ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 text-indigo-300'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-700'
              }`}
            >
              {t('admin.panels.latency', { ms: panel.latencyMs })}
            </span>
          )}
        </div>

        <button
          type="button"
          className={`btn btn-ghost btn-sm text-xs gap-1.5 border rounded-xl cursor-pointer ${
            isDark
              ? 'border-white/10 hover:bg-white/10 text-slate-300'
              : 'border-slate-200 hover:bg-slate-100 text-slate-700 shadow-2xs'
          }`}
          disabled={isTesting}
          onClick={() => onTest(panel.id)}
        >
          <RotateCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-indigo-500' : ''}`} />
          <span>{isTesting ? t('admin.panels.testing') : t('admin.panels.testBtn')}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        {panel.baseUrl && (
          <div className={`p-2.5 rounded-xl border space-y-1 ${subCardClass}`}>
            <span className={`block ${textMuted}`}>{t('admin.panels.address')}</span>
            <code className="break-all font-mono text-[11px] text-indigo-500">{panel.baseUrl}</code>
          </div>
        )}

        <div className={`p-2.5 rounded-xl border space-y-1 ${subCardClass}`}>
          <span className={`block ${textMuted}`}>{t('admin.panels.authMode')}</span>
          <div className="flex items-center gap-1.5 font-mono">
            <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
            <span className={textPrimary}>{panel.credentialMode}</span>
            <span className={textMuted}>·</span>
            <span
              className={
                isDark ? 'text-emerald-400 font-semibold' : 'text-emerald-600 font-semibold'
              }
            >
              {t('admin.panels.configsCount', {
                count: formatNumber(panel.activeConfigsCount ?? 0),
              })}
            </span>
          </div>
        </div>
      </div>

      {panel.services.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <span className={`text-xs font-medium block ${textSecondary}`}>
            {t('admin.panels.connectedServices')}
          </span>
          <div className="flex gap-2 flex-wrap">
            {panel.services.map((s) => (
              <span
                key={s.serviceId}
                className={`text-xs py-1 px-2.5 rounded-lg border font-mono ${
                  isDark
                    ? 'bg-white/[0.03] border-white/10 text-zinc-300'
                    : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                <span className="font-sans">{s.name}</span> (ID: {s.serviceId}){' '}
                {s.isDefault ? `· ${t('admin.panels.defaultService')}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};
