import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LayoutDashboard, Receipt, Users, Server, Package, Layers } from 'lucide-react';
import { OverviewTab } from './overview/OverviewTab.js';
import { ReceiptsTab } from './receipts/ReceiptsTab.js';
import { UsersTab } from './users/UsersTab.js';
import { PanelsTab } from './panels/PanelsTab.js';
import { PackagesTab } from './packages/PackagesTab.js';
import { ModulesTab } from './modules/ModulesTab.js';
import { AdminHeader } from './components/AdminHeader.js';
import { AdminDesktopNav } from './components/AdminDesktopNav.js';
import { AdminBottomNav } from './components/AdminBottomNav.js';
import { useAdminReceipts } from './receipts/hooks/useAdminReceipts.js';
import { useAdminStats } from './overview/hooks/useAdminStats.js';
import { useAdminPanels } from './panels/hooks/useAdminPanels.js';
import { useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/shared/components/layout/AppShell.js';
import { Toast } from '@/shared/components/ui/Toast.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';
import type { TabType } from '@/shared/types/admin.js';

interface AdminLayoutProps {
  user: TelegramWebAppUser;
  onSwitchToUserPortal?: () => void;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ user, onSwitchToUserPortal }) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [inspectingUserId, setInspectingUserId] = useState<number | null>(null);

  // Queries for badge count and refresh handling
  const { pendingCount, refetch: refetchReceipts } = useAdminReceipts();
  const { refetch: refetchStats } = useAdminStats();
  const { refetch: refetchPanels } = useAdminPanels();
  const queryClient = useQueryClient();
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setNotification({ message, type });
    triggerHaptic(type === 'success' ? 'success' : 'error');
    toastTimerRef.current = setTimeout(() => {
      setNotification(null);
      toastTimerRef.current = null;
    }, 4000);
  };

  const handleClose = () => {
    triggerHaptic('medium');
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  };

  // Base BackButton handler when at the root layout
  useTelegramBackButton(handleClose, true);

  const switchTab = (tab: TabType) => {
    triggerHaptic('selection');
    setActiveTab(tab);
  };

  const handleInspectUserFromReceipts = (telegramId: number) => {
    setInspectingUserId(telegramId);
    setActiveTab('users');
  };

  const handleRefresh = () => {
    triggerHaptic('light');
    if (activeTab === 'overview') refetchStats();
    if (activeTab === 'receipts') refetchReceipts();
    if (activeTab === 'panels') refetchPanels();
    if (activeTab === 'users') void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    if (activeTab === 'packages') {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'packages'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'pricing', 'custom'] });
    }
  };

  const tabsConfig = [
    {
      id: 'overview' as const,
      label: t('admin.tabs.overview'),
      mobileLabel: t('admin.tabs.overviewShort'),
      icon: LayoutDashboard,
    },
    {
      id: 'receipts' as const,
      label: t('admin.tabs.receipts'),
      mobileLabel: t('admin.tabs.receiptsShort'),
      icon: Receipt,
      count: pendingCount,
    },
    {
      id: 'users' as const,
      label: t('admin.tabs.users'),
      mobileLabel: t('admin.tabs.usersShort'),
      icon: Users,
    },
    {
      id: 'panels' as const,
      label: t('admin.tabs.panels'),
      mobileLabel: t('admin.tabs.panelsShort'),
      icon: Server,
    },
    {
      id: 'packages' as const,
      label: t('admin.tabs.packages'),
      mobileLabel: t('admin.tabs.packagesShort'),
      icon: Package,
    },
    {
      id: 'coming-soon' as const,
      label: t('admin.tabs.comingSoon'),
      mobileLabel: t('admin.tabs.comingSoonShort'),
      icon: Layers,
    },
  ];

  return (
    <AppShell
      width="wide"
      header={
        <AdminHeader
          user={user}
          onRefresh={handleRefresh}
          onClose={handleClose}
          onNotify={notify}
          onSwitchToUserPortal={onSwitchToUserPortal}
        />
      }
      desktopNav={
        <AdminDesktopNav tabs={tabsConfig} activeTab={activeTab} onSelectTab={switchTab} />
      }
      transitionKey={activeTab}
      bottomNav={<AdminBottomNav tabs={tabsConfig} activeTab={activeTab} onSelectTab={switchTab} />}
      overlay={
        notification
          ? createPortal(
              <aside
                aria-live="polite"
                className="fixed top-4 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-md z-[100000] pointer-events-auto"
              >
                <Toast
                  message={notification.message}
                  type={notification.type}
                  onDismiss={() => setNotification(null)}
                />
              </aside>,
              document.body
            )
          : null
      }
    >
      {activeTab === 'overview' && <OverviewTab onSwitchTab={switchTab} />}
      {activeTab === 'receipts' && (
        <ReceiptsTab onInspectUser={handleInspectUserFromReceipts} onNotify={notify} />
      )}
      {activeTab === 'users' && (
        <UsersTab
          onNotify={notify}
          inspectedUserId={inspectingUserId}
          onClearInspectedUser={() => setInspectingUserId(null)}
        />
      )}
      {activeTab === 'panels' && <PanelsTab onNotify={notify} />}
      {activeTab === 'packages' && <PackagesTab onNotify={notify} />}
      {activeTab === 'coming-soon' && <ModulesTab onSwitchTab={switchTab} />}
    </AppShell>
  );
};
