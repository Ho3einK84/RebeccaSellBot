import React from 'react';
import { LayoutDashboard, Wifi, ShoppingBag, Wallet, Users } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import type { UserTabType } from '@/shared/types/userPortal.js';

interface BetaBottomNavProps {
  activeTab: UserTabType;
  onSelectTab: (tab: UserTabType) => void;
  configsCount?: number;
}

export const BetaBottomNav: React.FC<BetaBottomNavProps> = ({
  activeTab,
  onSelectTab,
  configsCount = 0,
}) => {
  const { t } = useLanguage();
  const { isDark } = useThemeTokens();
  const { triggerHaptic } = useHaptic();

  const navItems = [
    { id: 'dashboard' as const, label: t('user.tabs.dashboard'), icon: LayoutDashboard },
    {
      id: 'services' as const,
      label: t('user.tabs.services'),
      icon: Wifi,
      badge: configsCount > 0 ? configsCount : undefined,
    },
    { id: 'shop' as const, label: t('user.tabs.shop'), icon: ShoppingBag },
    { id: 'wallet' as const, label: t('user.tabs.wallet'), icon: Wallet },
    { id: 'referral' as const, label: t('user.tabs.referral'), icon: Users },
  ];

  const handleSelect = (id: UserTabType) => {
    triggerHaptic('selection');
    onSelectTab(id);
  };

  return (
    <nav
      className={`fixed bottom-0 inset-x-0 z-40 border-t backdrop-blur-xl transition-colors pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] ${
        isDark
          ? 'bg-[#090a0f]/90 border-white/[0.08]'
          : 'bg-white/95 border-slate-200/90 shadow-lg shadow-slate-200/50'
      }`}
    >
      <div className="w-full max-w-lg mx-auto flex items-center justify-around px-2 pt-1.5 pb-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item.id)}
              className={`flex-1 py-1 px-1 flex flex-col items-center justify-center gap-1 relative transition-all active:scale-95 cursor-pointer rounded-xl ${
                isActive
                  ? isDark
                    ? 'text-indigo-400 font-bold'
                    : 'text-indigo-600 font-bold'
                  : isDark
                    ? 'text-zinc-500 hover:text-zinc-300'
                    : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Icon
                  className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform ${isActive ? 'scale-110' : ''}`}
                />
                {item.badge !== undefined && (
                  <span className="absolute -top-1 -end-2 min-w-[15px] h-[15px] px-1 rounded-full bg-indigo-600 text-white text-[9px] font-bold flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] leading-tight tracking-tight select-none">
                {item.label}
              </span>
              {isActive && (
                <span className="w-1.5 h-1 rounded-full bg-indigo-500 absolute bottom-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
