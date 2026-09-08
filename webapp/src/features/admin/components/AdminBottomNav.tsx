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
      className={`md:hidden fixed bottom-0 inset-x-0 z-40 backdrop-blur-2xl border-t px-1.5 pt-1.5 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] transition-colors ${
        isDark
          ? 'bg-[#090a0f]/95 border-white/[0.08] shadow-[0_-8px_30px_rgba(0,0,0,0.6)]'
          : 'bg-white/95 border-slate-200/90 shadow-[0_-8px_30px_rgba(0,0,0,0.08)]'
      }`}
    >
      <div className="grid grid-cols-5 gap-0.5 max-w-md mx-auto items-center">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition-all duration-150 relative min-w-0 select-none cursor-pointer ${
                isActive
                  ? isDark
                    ? 'text-indigo-400 font-bold'
                    : 'text-indigo-600 font-bold'
                  : isDark
                    ? 'text-zinc-400 hover:text-zinc-200 active:scale-95'
                    : 'text-slate-500 hover:text-slate-800 active:scale-95'
              }`}
            >
              <div
                className={`p-1.5 rounded-xl transition-all relative ${
                  isActive
                    ? isDark
                      ? 'bg-white/[0.06]'
                      : 'bg-indigo-50'
                    : 'hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <Icon
                  className={`w-5 h-5 ${
                    isActive
                      ? isDark
                        ? 'text-indigo-400'
                        : 'text-indigo-600'
                      : isDark
                        ? 'text-zinc-400'
                        : 'text-slate-500'
                  }`}
                />
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-slate-950 font-black text-[9px] flex items-center justify-center shadow-xs">
                    {tab.count}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] leading-tight mt-1 truncate max-w-full text-center tracking-tight ${
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
              {isActive && (
                <span
                  className={`w-1.5 h-1.5 rounded-full mt-0.5 shadow-xs ${
                    isDark
                      ? 'bg-indigo-400 shadow-indigo-400/50'
                      : 'bg-indigo-600 shadow-indigo-600/30'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
