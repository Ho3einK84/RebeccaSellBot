import React from 'react';
import { BottomNav } from '@/shared/components/layout/BottomNav.js';
import { useUserNavItems } from '../hooks/useUserNavItems.js';
import type { UserTabType } from '@/shared/types/userPortal.js';

interface BetaBottomNavProps {
  activeTab: UserTabType;
  onSelectTab: (tab: UserTabType) => void;
  configsCount?: number;
  hasPendingReceipt?: boolean;
}

/**
 * User-portal navigation — the same shared `BottomNav` the admin panel uses.
 * The pending-receipt signal is a dot badge instead of a separate pulsing
 * element, so both panels share one badge language.
 */
export const BetaBottomNav: React.FC<BetaBottomNavProps> = ({
  activeTab,
  onSelectTab,
  configsCount = 0,
  hasPendingReceipt = false,
}) => {
  const items = useUserNavItems({ configsCount, hasPendingReceipt });

  return (
    <BottomNav
      items={items}
      activeId={activeTab}
      onSelect={onSelectTab}
      ariaLabel="ناوبری حساب کاربری"
    />
  );
};
