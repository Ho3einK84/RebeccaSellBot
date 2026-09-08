import React from 'react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type { TabType } from '@/shared/types/admin.js';

export interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
}

interface AdminBottomNavProps {
  tabs: TabConfig[];
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

export const AdminBottomNav: React.FC<AdminBottomNavProps> = ({ tabs, activeTab, onSelectTab }) => {
  const { isDark } = useThemeTokens();

  return (
    <nav
      aria-label="Mobile Navigation"
      className={`md:hidden fixed bottom-0 inset-x-0 z-40 backdrop-blur-2xl border-t px-2 pt-1 pb-[max(env(safe-area-inset-bottom,0px),0.4rem)] transition-colors duration-200 ${
        isDark
          ? 'bg-[#0a0c12]/92 border-white/[0.08] shadow-[0_-8px_32px_rgba(0,0,0,0.65)]'
          : 'bg-white/94 border-slate-200/90 shadow-[0_-4px_24px_rgba(0,0,0,0.06)]'
      }`}
    >
      <div className="grid grid-cols-5 gap-1 max-w-md mx-auto items-center">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className="flex flex-col items-center justify-center py-1 rounded-xl transition-all duration-150 relative select-none cursor-pointer active:scale-95 group"
            >
              <div
                className={`w-11 h-7 rounded-full flex items-center justify-center transition-all duration-200 relative ${
                  isActive
                    ? isDark
                      ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/35 shadow-[0_0_14px_rgba(99,102,241,0.25)]'
                      : 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200/80 shadow-xs'
                    : isDark
                      ? 'text-zinc-400 group-hover:text-zinc-200'
                      : 'text-slate-500 group-hover:text-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="absolute -top-1 -end-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-slate-950 font-bold text-[9px] flex items-center justify-center shadow-xs font-mono ring-2 ring-white dark:ring-[#0a0c12]">
                    {tab.count}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] leading-tight mt-1 truncate max-w-full text-center tracking-tight transition-colors ${
                  isActive
                    ? isDark
                      ? 'text-indigo-300 font-bold'
                      : 'text-indigo-600 font-bold'
                    : isDark
                      ? 'text-zinc-400 font-medium'
                      : 'text-slate-500 font-medium'
                }`}
              >
                {tab.label}
              </span>
              <span
                className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${
                  isActive
                    ? isDark
                      ? 'bg-indigo-400 scale-100 opacity-100'
                      : 'bg-indigo-600 scale-100 opacity-100'
                    : 'bg-transparent scale-0 opacity-0'
                }`}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
};
