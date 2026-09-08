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
  const { t, isRtl } = useLanguage();
  const { cardClass, isDark, textPrimary, textMuted } = useThemeTokens();

  if (!panelHealth) return null;

  const isHealthOk = panelHealth.healthy === panelHealth.configured;

  return (
    <div
      className={`rounded-2xl p-4 flex items-center justify-between cursor-pointer border transition-all duration-200 active:scale-[0.99] hover:border-slate-300 dark:hover:border-white/20 hover:shadow-xs group ${cardClass}`}
      onClick={onSwitchToPanels}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 shadow-xs ${
            isHealthOk
              ? isDark
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : isDark
                ? 'bg-rose-500/10 border-rose-500/25 text-rose-400'
                : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <Activity className="w-5 h-5" />
        </div>
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isHealthOk ? 'bg-emerald-500 status-pulse' : 'bg-rose-500'
              }`}
            />
            <span className={`text-xs font-semibold ${textPrimary}`}>
              {t('admin.overview.panelHealthTitle')}
            </span>
          </div>
          <div
            className={`text-sm font-bold ${
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
      </div>
      <div
        className={`text-xs font-medium px-2.5 py-1 rounded-xl border transition-colors ${
          isDark
            ? 'bg-white/[0.03] border-white/10 text-zinc-400 group-hover:border-white/20 group-hover:text-zinc-200'
            : 'bg-slate-100 border-slate-200/80 text-slate-600 group-hover:border-slate-300 group-hover:text-slate-900'
        }`}
      >
        <span>
          {t('admin.tabs.panels')} {isRtl ? '←' : '→'}
        </span>
      </div>
    </div>
  );
};
