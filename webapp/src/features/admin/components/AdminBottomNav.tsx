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
      className={`md:hidden fixed bottom-0 inset-x-0 z-40 backdrop-blur-2xl border-t px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] transition-colors ${
        isDark
          ? 'bg-[#090a0f]/90 border-white/[0.08] shadow-[0_-8px_32px_rgba(0,0,0,0.7)]'
          : 'bg-white/90 border-slate-200/80 shadow-[0_-8px_32px_rgba(0,0,0,0.06)]'
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
              className={`flex flex-col items-center justify-center py-1 rounded-xl transition-all duration-150 relative select-none cursor-pointer active:scale-95 ${
                isActive
                  ? isDark
                    ? 'text-indigo-300 font-semibold'
                    : 'text-indigo-600 font-semibold'
                  : isDark
                    ? 'text-zinc-400 hover:text-zinc-200'
                    : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <div
                className={`p-1.5 rounded-xl transition-all relative ${
                  isActive
                    ? isDark
                      ? 'bg-indigo-500/15 border border-indigo-500/25 shadow-xs'
                      : 'bg-indigo-50 border border-indigo-200/70 shadow-xs'
                    : 'hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon
                  className={`w-5 h-5 ${
                    isActive
                      ? isDark
                        ? 'text-indigo-300'
                        : 'text-indigo-600'
                      : isDark
                        ? 'text-zinc-400'
                        : 'text-slate-500'
                  }`}
                />
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="absolute -top-1 -end-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-slate-950 font-bold text-[9px] flex items-center justify-center shadow-xs font-mono">
                    {tab.count}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] leading-tight mt-1 truncate max-w-full text-center tracking-tight ${
                  isActive
                    ? isDark
                      ? 'text-indigo-300 font-semibold'
                      : 'text-indigo-600 font-semibold'
                    : isDark
                      ? 'text-zinc-400 font-medium'
                      : 'text-slate-500 font-medium'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
