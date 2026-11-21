import React, { useState } from 'react';
import { LayoutDashboard, Receipt, Users, Server, Package, Layers } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { OverviewTab } from './overview/OverviewTab.js';
import { ReceiptsTab } from './receipts/ReceiptsTab.js';
import { UsersTab } from './users/UsersTab.js';
import { PanelsTab } from './panels/PanelsTab.js';
import { PackagesTab } from './packages/PackagesTab.js';
import { ModulesTab } from './modules/ModulesTab.js';
import { BankCardsModal } from './bankCards/BankCardsModal.js';
import { AdminHeader } from './components/AdminHeader.js';
import { AdminDesktopNav } from './components/AdminDesktopNav.js';
import { AdminBottomNav, type TabConfig } from './components/AdminBottomNav.js';
import { useAdminReceipts } from './receipts/hooks/useAdminReceipts.js';
import { useAdminStats } from './overview/hooks/useAdminStats.js';
import { useAdminPanels } from './panels/hooks/useAdminPanels.js';
import { AppShell } from '@/shared/components/layout/AppShell.js';
import { useToast } from '@/shared/components/ui/Toast.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import { minimizeOrCloseWebApp } from '@/shared/lib/telegramNavigation.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';
import type { TabType } from '@/shared/types/admin.js';

interface AdminLayoutProps {
  user: TelegramWebAppUser;
  onSwitchToUserPortal?: () => void;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ user, onSwitchToUserPortal }) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const { notify } = useToast();

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [tabHistory, setTabHistory] = useState<TabType[]>(['overview']);
  const [inspectingUserId, setInspectingUserId] = useState<number | null>(null);
  const [isBankCardsModalOpen, setIsBankCardsModalOpen] = useState(false);

  // Queries for badge count and refresh handling
  const { pendingCount, refetch: refetchReceipts } = useAdminReceipts();
  const { refetch: refetchStats } = useAdminStats();
  const { refetch: refetchPanels } = useAdminPanels();
  const queryClient = useQueryClient();
  const isFetchingAdmin = useIsFetching({ queryKey: ['admin'] }) > 0;

  const handleClose = () => {
    triggerHaptic('medium');
    minimizeOrCloseWebApp();
  };

  const switchTab = (tab: TabType) => {
    if (tab === activeTab) return;
    triggerHaptic('selection');
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (tab === 'overview') {
      setTabHistory(['overview']);
    } else {
      setTabHistory((prev) => {
        if (prev.length >= 2 && prev[prev.length - 2] === tab) {
          return prev.slice(0, -1);
        }
        return [...prev, tab];
      });
    }
    setActiveTab(tab);
  };

  // Native Telegram BackButton: navigate back across admin tabs to overview;
  // hide on root overview so Telegram shows its native Close affordance.
  const canNavigateBack = tabHistory.length > 1 || activeTab !== 'overview';

  const handleBack = () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (tabHistory.length > 1) {
      triggerHaptic('selection');
      const nextHistory = tabHistory.slice(0, -1);
      const prevTab = nextHistory[nextHistory.length - 1] ?? 'overview';
      setTabHistory(nextHistory);
      setActiveTab(prevTab);
    } else if (activeTab !== 'overview') {
      triggerHaptic('selection');
      setTabHistory(['overview']);
      setActiveTab('overview');
    }
  };

  useTelegramBackButton(handleBack, canNavigateBack);

  const handleInspectUserFromReceipts = (telegramId: number) => {
    setInspectingUserId(telegramId);
    switchTab('users');
  };

  const handleRefresh = () => {
    triggerHaptic('light');
    if (activeTab === 'overview') void refetchStats();
    if (activeTab === 'receipts') void refetchReceipts();
    if (activeTab === 'panels') void refetchPanels();
    if (activeTab === 'users') void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    if (activeTab === 'packages') {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'packages'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'pricing', 'custom'] });
    }
    if (activeTab === 'coming-soon') {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    }
  };

  const tabsConfig: TabConfig[] = [
    {
      id: 'overview',
      label: t('admin.tabs.overview'),
      mobileLabel: t('admin.tabs.overviewShort'),
      icon: LayoutDashboard,
    },
    {
      id: 'receipts',
      label: t('admin.tabs.receipts'),
      mobileLabel: t('admin.tabs.receiptsShort'),
      icon: Receipt,
      count: pendingCount,
      badgeTone: 'warn',
    },
    {
      id: 'users',
      label: t('admin.tabs.users'),
      mobileLabel: t('admin.tabs.usersShort'),
      icon: Users,
    },
    {
      id: 'panels',
      label: t('admin.tabs.panels'),
      mobileLabel: t('admin.tabs.panelsShort'),
      icon: Server,
    },
    {
      id: 'packages',
      label: t('admin.tabs.packages'),
      mobileLabel: t('admin.tabs.packagesShort'),
      icon: Package,
    },
    {
      id: 'coming-soon',
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
          isRefreshing={isFetchingAdmin}
          onClose={handleClose}
          onSwitchToUserPortal={onSwitchToUserPortal}
        />
      }
      desktopNav={
        <AdminDesktopNav tabs={tabsConfig} activeTab={activeTab} onSelectTab={switchTab} />
      }
      transitionKey={activeTab}
      bottomNav={<AdminBottomNav tabs={tabsConfig} activeTab={activeTab} onSelectTab={switchTab} />}
    >
      {activeTab === 'overview' && <OverviewTab onSwitchTab={switchTab} />}
      {activeTab === 'receipts' && (
        <ReceiptsTab
          onInspectUser={handleInspectUserFromReceipts}
          onNotify={(msg, type) => notify(msg, type ?? 'success')}
        />
      )}
      {activeTab === 'users' && (
        <UsersTab
          onNotify={(msg, type) => notify(msg, type ?? 'success')}
          inspectedUserId={inspectingUserId}
          onClearInspectedUser={() => setInspectingUserId(null)}
        />
      )}
      {activeTab === 'panels' && (
        <PanelsTab onNotify={(msg, type) => notify(msg, type ?? 'success')} />
      )}
      {activeTab === 'packages' && (
        <PackagesTab onNotify={(msg, type) => notify(msg, type ?? 'success')} />
      )}
      {activeTab === 'coming-soon' && (
        <ModulesTab onSwitchTab={switchTab} onOpenBankCards={() => setIsBankCardsModalOpen(true)} />
      )}
      <BankCardsModal
        isOpen={isBankCardsModalOpen}
        onClose={() => setIsBankCardsModalOpen(false)}
        onNotify={(msg, type) => notify(msg, type ?? 'success')}
      />
    </AppShell>
  );
};
