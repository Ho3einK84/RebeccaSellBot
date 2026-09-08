import React from 'react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type { TabConfig } from './AdminBottomNav.js';
import type { TabType } from '@/shared/types/admin.js';

interface AdminDesktopNavProps {
  tabs: TabConfig[];
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

export const AdminDesktopNav: React.FC<AdminDesktopNavProps> = ({
  tabs,
  activeTab,
  onSelectTab,
}) => {
  const { isDark } = useThemeTokens();

  return (
    <nav className="hidden md:flex items-center gap-1 p-1 mb-5 rounded-2xl border backdrop-blur-md bg-white/70 dark:bg-white/[0.025] border-slate-200/80 dark:border-white/[0.06] shadow-xs">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all duration-150 select-none cursor-pointer ${
              isActive
                ? isDark
                  ? 'bg-white/10 text-white shadow-xs border border-white/10'
                  : 'bg-white text-slate-950 shadow-xs border border-slate-200/80 font-semibold'
                : isDark
                  ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 border border-transparent'
            }`}
            onClick={() => onSelectTab(tab.id)}
          >
            <Icon
              className={`w-4 h-4 ${isActive ? (isDark ? 'text-indigo-400' : 'text-indigo-600') : 'opacity-70'}`}
            />
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold font-mono border ${
                  isDark
                    ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                    : 'bg-amber-100 border-amber-300 text-amber-800'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};
