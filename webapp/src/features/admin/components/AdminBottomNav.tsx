import React from 'react';
import { BottomNav } from '@/shared/components/layout/BottomNav.js';
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

/** Admin mobile navigation — thin adapter over the shared `BottomNav`. */
export const AdminBottomNav: React.FC<AdminBottomNavProps> = ({ tabs, activeTab, onSelectTab }) => (
  <BottomNav
    items={tabs}
    activeId={activeTab}
    onSelect={onSelectTab}
    ariaLabel="ناوبری پنل مدیریت"
  />
);
