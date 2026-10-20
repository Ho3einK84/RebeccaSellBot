import React from 'react';
import { DesktopNav } from '@/shared/components/layout/DesktopNav.js';
import type { TabConfig } from './AdminBottomNav.js';
import type { TabType } from '@/shared/types/admin.js';

interface AdminDesktopNavProps {
  tabs: TabConfig[];
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

/** Admin desktop tab rail — thin adapter over the shared `DesktopNav`. */
export const AdminDesktopNav: React.FC<AdminDesktopNavProps> = ({
  tabs,
  activeTab,
  onSelectTab,
}) => (
  <DesktopNav
    items={tabs}
    activeId={activeTab}
    onSelect={onSelectTab}
    ariaLabel="ناوبری پنل مدیریت"
  />
);
