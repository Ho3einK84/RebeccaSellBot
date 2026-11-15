import React from 'react';
import { BottomNav } from '@/shared/components/layout/BottomNav.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useUserNavItems } from '../hooks/useUserNavItems.js';
import type { UserTabType } from '@/shared/types/userPortal.js';

interface BetaBottomNavProps {
  activeTab: UserTabType;
  onSelectTab: (tab: UserTabType) => void;
  configsCount?: number;
  hasPendingReceipt?: boolean;
}

export const BetaBottomNav: React.FC<BetaBottomNavProps> = ({
  activeTab,
  onSelectTab,
  configsCount = 0,
  hasPendingReceipt = false,
}) => {
  const { t } = useLanguage();
  const items = useUserNavItems({ configsCount, hasPendingReceipt });

  return (
    <BottomNav
      items={items}
      activeId={activeTab}
      onSelect={onSelectTab}
      ariaLabel={t('user.navAriaLabel')}
    />
  );
};
