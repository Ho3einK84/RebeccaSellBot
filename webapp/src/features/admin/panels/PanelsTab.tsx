import React from 'react';
import { Server, RotateCw, Activity } from 'lucide-react';
import { useAdminPanels } from './hooks/useAdminPanels.js';
import { PanelCard } from './components/PanelCard.js';
import { Card } from '@/shared/components/ui/Card.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

interface PanelsTabProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const PanelsTab: React.FC<PanelsTabProps> = ({ onNotify }) => {
  const { t } = useLanguage();
  const { panels, isLoading, refetch, testPanel, testingPanelId } = useAdminPanels();
  const { isDark, textPrimary, textSecondary } = useThemeTokens();

  const handleTestPanel = async (panelId: string) => {
    try {
      const res = await testPanel(panelId);
      if (res.success && res.healthy) {
        onNotify(t('admin.notifications.panelTestSuccess', { ms: res.latencyMs ?? 0 }), 'success');
      } else {
        onNotify(res.error || t('admin.notifications.panelTestFailed'), 'error');
      }
    } catch {
      onNotify(t('admin.notifications.networkError'), 'error');
    }
  };

  const allHealthy = panels.length > 0 && panels.every((p) => p.healthy !== false);
  const healthyCount = panels.filter((p) => p.healthy !== false).length;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-indigo-500" />
          <h2 className={`text-base font-bold m-0 ${textPrimary}`}>
            {t('admin.panels.fleetTitle')}
          </h2>
        </div>
        <button
          type="button"
          className={`btn btn-ghost btn-xs text-xs gap-1 border rounded-lg cursor-pointer ${
            isDark
              ? 'border-white/10 text-slate-300 hover:bg-white/10'
              : 'border-slate-200 text-slate-700 hover:bg-slate-100'
          }`}
          onClick={() => refetch()}
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span>{t('common.refresh')}</span>
        </button>
      </div>

      {isLoading && (
        <div className={`flex items-center justify-center p-8 gap-3 ${textSecondary}`}>
          <RotateCw className="w-5 h-5 animate-spin text-indigo-500" />
          <span className="text-sm">{t('admin.panels.loading')}</span>
        </div>
      )}

      {/* Fleet Status Summary Card */}
      {!isLoading && panels.length > 0 && (
        <Card className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${
                allHealthy
                  ? isDark
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isDark
                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className={`text-sm font-bold m-0 ${textPrimary}`}>
                {allHealthy
                  ? t('admin.panels.fleetStatusOk')
                  : t('admin.panels.fleetStatusWarning')}
              </h3>
              <p className={`text-xs m-0 mt-0.5 ${textSecondary}`}>
                {t('common.panelsActiveCount', {
                  healthy: healthyCount,
                  total: panels.length,
                })}
              </p>
            </div>
          </div>
        </Card>
      )}

      {!isLoading && panels.length === 0 && (
        <Card className="p-8 text-center text-sm">{t('admin.panels.empty')}</Card>
      )}

      {/* Panels List */}
      {!isLoading && panels.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {panels.map((p) => (
            <PanelCard
              key={p.id}
              panel={p}
              onTest={handleTestPanel}
              isTesting={testingPanelId === p.id}
            />
          ))}
        </div>
      )}
    </div>
  );
};
