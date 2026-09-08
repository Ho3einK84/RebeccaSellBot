import React from 'react';
import { Activity } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type { PanelHealth } from '@/shared/types/admin.js';

interface HealthBannerProps {
  panelHealth: PanelHealth | null;
  onSwitchToPanels: () => void;
}

export const HealthBanner: React.FC<HealthBannerProps> = ({ panelHealth, onSwitchToPanels }) => {
  const { t } = useLanguage();
  const { cardClass, isDark, textPrimary, textSecondary, textMuted } = useThemeTokens();

  if (!panelHealth) return null;

  const isHealthOk = panelHealth.healthy === panelHealth.configured;

  return (
    <div
      className={`rounded-2xl p-4 flex items-center justify-between cursor-pointer border transition-all active:scale-[0.99] ${cardClass} hover:border-indigo-500/50`}
      onClick={onSwitchToPanels}
    >
      <div className="space-y-1">
        <span className={`text-xs block ${textSecondary}`}>
          {t('admin.overview.panelHealthTitle')}
        </span>
        <div
          className={`text-lg font-bold ${
            isHealthOk
              ? isDark
                ? 'text-emerald-400'
                : 'text-emerald-600'
              : isDark
                ? 'text-rose-400'
                : 'text-rose-600'
          }`}
        >
          {isHealthOk ? t('admin.overview.panelHealthOk') : t('admin.overview.panelHealthError')}
        </div>
        <span className={`text-[11px] block ${textMuted}`}>
          {t('admin.overview.panelHealthSub', {
            healthy: panelHealth.healthy,
            configured: panelHealth.configured,
          })}
        </span>
      </div>
      <div
        className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
          isHealthOk
            ? isDark
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : isDark
              ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
              : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}
      >
        <Activity className="w-4 h-4" />
      </div>
    </div>
  );
};
