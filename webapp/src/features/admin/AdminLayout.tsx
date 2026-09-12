import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutDashboard, Receipt, Users, Server, Layers } from 'lucide-react';
import { OverviewTab } from './overview/OverviewTab.js';
import { ReceiptsTab } from './receipts/ReceiptsTab.js';
import { UsersTab } from './users/UsersTab.js';
import { PanelsTab } from './panels/PanelsTab.js';
import { ModulesTab } from './modules/ModulesTab.js';
import { AdminHeader } from './components/AdminHeader.js';
import { AdminDesktopNav } from './components/AdminDesktopNav.js';
import { AdminBottomNav } from './components/AdminBottomNav.js';
import { useAdminReceipts } from './receipts/hooks/useAdminReceipts.js';
import { useAdminStats } from './overview/hooks/useAdminStats.js';
import { useAdminPanels } from './panels/hooks/useAdminPanels.js';
import { useQueryClient } from '@tanstack/react-query';
import { AmbientBackground } from '@/shared/components/layout/AmbientBackground.js';
import { Toast } from '@/shared/components/ui/Toast.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';
import type { TabType } from '@/shared/types/admin.js';

interface AdminLayoutProps {
  user: TelegramWebAppUser;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ user }) => {
  const { t } = useLanguage();
  const { isDark } = useThemeTokens();
  const { triggerHaptic } = useHaptic();

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [inspectingUserId, setInspectingUserId] = useState<number | null>(null);

  // Queries for badge count and refresh handling
  const { receipts, refetch: refetchReceipts } = useAdminReceipts();
  const { refetch: refetchStats } = useAdminStats();
  const { refetch: refetchPanels } = useAdminPanels();
  const queryClient = useQueryClient();

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    triggerHaptic(type === 'success' ? 'success' : 'error');
    setTimeout(() => setNotification(null), 4000);
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
  };

  const tabsConfig = [
    { id: 'overview' as const, label: t('admin.tabs.overview'), icon: LayoutDashboard },
    {
      id: 'receipts' as const,
      label: t('admin.tabs.receipts'),
      icon: Receipt,
      count: receipts.length,
    },
    { id: 'users' as const, label: t('admin.tabs.users'), icon: Users },
    { id: 'panels' as const, label: t('admin.tabs.panels'), icon: Server },
    { id: 'coming-soon' as const, label: t('admin.tabs.comingSoon'), icon: Layers },
  ];

  return (
    <div
      className={`w-full min-h-screen min-h-[100dvh] flex flex-col relative transition-colors duration-200 safe-top ${
        isDark ? 'bg-[#090a0f] text-slate-100' : 'bg-[#f8fafc] text-slate-900'
      }`}
    >
      <AmbientBackground />

      {/* Main Container */}
      <main className="w-full max-w-6xl mx-auto p-3 sm:p-5 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] relative z-10 flex-1 flex flex-col">
        <AdminHeader
          user={user}
          onRefresh={handleRefresh}
          onClose={handleClose}
          onNotify={notify}
        />

        {/* Global Floating Toast Notification (Portaled above all modals) */}
        {notification &&
          createPortal(
            <aside
              aria-live="polite"
              className="fixed top-4 left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-md z-[100000] pointer-events-auto"
            >
              <Toast
                message={notification.message}
                type={notification.type}
                onDismiss={() => setNotification(null)}
              />
            </aside>,
            document.body
          )}

        {/* Desktop Navigation Tabs (Hidden on mobile) */}
        <AdminDesktopNav tabs={tabsConfig} activeTab={activeTab} onSelectTab={switchTab} />

        {/* Tab Routing */}
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
        {activeTab === 'coming-soon' && <ModulesTab />}
      </main>

      {/* Mobile Bottom Navigation Bar (< md) */}
      <AdminBottomNav tabs={tabsConfig} activeTab={activeTab} onSelectTab={switchTab} />
    </div>
  );
};
