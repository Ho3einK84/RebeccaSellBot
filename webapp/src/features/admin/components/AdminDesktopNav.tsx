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
    <nav className="hidden md:flex gap-2 mb-5 overflow-x-auto pb-1">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            className={`btn btn-sm text-xs gap-2 font-semibold rounded-xl transition-all cursor-pointer ${
              isActive
                ? isDark
                  ? 'bg-white text-black hover:bg-zinc-200 shadow-md border-transparent'
                  : 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm border-transparent'
                : isDark
                  ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 shadow-2xs'
            }`}
            onClick={() => onSelectTab(tab.id)}
          >
            <Icon className="w-4 h-4" />
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className="badge badge-warning badge-xs px-1.5 py-0.5 text-[10px] font-bold">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};
