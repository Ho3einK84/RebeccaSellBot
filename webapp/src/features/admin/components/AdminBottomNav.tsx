import React from 'react';
import { BottomNav } from '@/shared/components/layout/BottomNav.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import type { TabType } from '@/shared/types/admin.js';

export interface TabConfig {
  id: TabType;
  label: string;
  mobileLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  badgeTone?: 'brand' | 'warn' | 'danger';
}

interface AdminBottomNavProps {
  tabs: TabConfig[];
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

/** Admin mobile navigation — thin adapter over the shared `BottomNav`. */
export const AdminBottomNav: React.FC<AdminBottomNavProps> = ({ tabs, activeTab, onSelectTab }) => {
  const { t } = useLanguage();
  const mobileItems = tabs.map(({ id, label, mobileLabel, icon, count }) => ({
    id,
    label: mobileLabel ?? label,
    icon,
    count,
  }));

  return (
    <BottomNav
      items={mobileItems}
      activeId={activeTab}
      onSelect={onSelectTab}
      ariaLabel={t('admin.navAriaLabel')}
    />
  );
};
