import React, { useState } from 'react';
import { LayoutDashboard, Receipt, Users, Server, Package, Settings2 } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { OverviewTab } from './overview/OverviewTab.js';
import { ReceiptsTab } from './receipts/ReceiptsTab.js';
import { UsersTab } from './users/UsersTab.js';
import { PanelsTab } from './panels/PanelsTab.js';
import { PackagesTab } from './packages/PackagesTab.js';
import { ModulesTab } from './modules/ModulesTab.js';
import { BankCardsModal } from './bankCards/BankCardsModal.js';
import { PaymentGatewaysModal } from './paymentGateways/PaymentGatewaysModal.js';
import { ReceiptSettingsModal } from './receipts/components/ReceiptSettingsModal.js';
import { ForcedJoinModal } from './forcedJoin/ForcedJoinModal.js';
import { BulkGiftModal } from './bulkGift/BulkGiftModal.js';
import { UserGroupsModal } from './userGroups/UserGroupsModal.js';
import { AdminHeader } from './components/AdminHeader.js';
import { AdminDesktopNav } from './components/AdminDesktopNav.js';
import { AdminBottomNav, type TabConfig } from './components/AdminBottomNav.js';
import { useAdminStats } from './overview/hooks/useAdminStats.js';
import { AppShell } from '@/shared/components/layout/AppShell.js';
import { AppVersionFooter } from '@/shared/components/ui/VersionBadge.js';
import { useToast } from '@/shared/components/ui/Toast.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import { resolveClientAppVersion } from '@/shared/lib/appVersion.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';
import type { TabType } from '@/shared/types/admin.js';
import type { AppVersionInfo } from '@/shared/types/api.js';

interface AdminLayoutProps {
  user: TelegramWebAppUser;
  botUsername?: string;
  appVersion?: AppVersionInfo;
  onSwitchToUserPortal?: () => void;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  user,
  botUsername,
  appVersion,
  onSwitchToUserPortal,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const { notify } = useToast();

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [tabHistory, setTabHistory] = useState<TabType[]>(['overview']);
  const [inspectingUserId, setInspectingUserId] = useState<number | null>(null);
  const [isBankCardsModalOpen, setIsBankCardsModalOpen] = useState(false);
  const [isPaymentGatewaysModalOpen, setIsPaymentGatewaysModalOpen] = useState(false);
  const [isReceiptSettingsModalOpen, setIsReceiptSettingsModalOpen] = useState(false);
  const [isForcedJoinModalOpen, setIsForcedJoinModalOpen] = useState(false);
  const [isBulkGiftModalOpen, setIsBulkGiftModalOpen] = useState(false);
  const [isUserGroupsModalOpen, setIsUserGroupsModalOpen] = useState(false);

  // Single lightweight query drives both dashboard stats, pending badge count, and panel health indicator.
  const {
    stats,
    panelHealth,
    appVersion: statsAppVersion,
    forceRefresh: forceRefreshStats,
  } = useAdminStats();
  const resolvedAppVersion = resolveClientAppVersion(statsAppVersion ?? appVersion);
  const pendingCount = stats?.pendingReceipts ?? 0;
  const hasConfiguredPanels = Boolean(panelHealth && panelHealth.configured > 0);
  const allPanelsHealthy = Boolean(
    panelHealth && panelHealth.configured > 0 && panelHealth.healthy === panelHealth.configured
  );

  const queryClient = useQueryClient();
  const isFetchingAdmin = useIsFetching({ queryKey: ['admin'] }) > 0;

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
    if (activeTab === 'overview') void forceRefreshStats();
    if (activeTab === 'receipts') {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'receipts'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    }
    if (activeTab === 'panels') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
      void forceRefreshStats();
    }
    if (activeTab === 'users') {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.userGroups });
    }
    if (activeTab === 'packages') {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'packages'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'pricing', 'custom'] });
    }
    if (activeTab === 'coming-soon') {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    }
  };

  // 5 primary operational tabs in mobile dock (matching UserPortal comfort);
  // "More & Settings" lives cleanly in the mobile header icon & as the 6th desktop tab.
  const primaryTabs: TabConfig[] = [
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
      id: 'packages',
      label: t('admin.tabs.packages'),
      mobileLabel: t('admin.tabs.packagesShort'),
      icon: Package,
    },
    {
      id: 'panels',
      label: t('admin.tabs.panels'),
      mobileLabel: t('admin.tabs.panelsShort'),
      icon: Server,
      dot: hasConfiguredPanels,
      dotTone: allPanelsHealthy ? 'ok' : 'danger',
    },
  ];

  const desktopTabs: TabConfig[] = [
    ...primaryTabs,
    {
      id: 'coming-soon',
      label: t('admin.tabs.comingSoon'),
      mobileLabel: t('admin.tabs.comingSoonShort'),
      icon: Settings2,
    },
  ];

  return (
    <AppShell
      width="wide"
      header={
        <AdminHeader
          user={user}
          appVersion={resolvedAppVersion}
          onRefresh={handleRefresh}
          isRefreshing={isFetchingAdmin}
          onSwitchToUserPortal={onSwitchToUserPortal}
          onOpenMore={() => switchTab('coming-soon')}
          isMoreActive={activeTab === 'coming-soon'}
        />
      }
      desktopNav={
        <AdminDesktopNav tabs={desktopTabs} activeTab={activeTab} onSelectTab={switchTab} />
      }
      transitionKey={activeTab}
      footer={<AppVersionFooter version={resolvedAppVersion} detailed />}
      bottomNav={
        <AdminBottomNav tabs={primaryTabs} activeTab={activeTab} onSelectTab={switchTab} />
      }
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
          onOpenUserGroups={() => setIsUserGroupsModalOpen(true)}
        />
      )}
      {activeTab === 'panels' && (
        <PanelsTab onNotify={(msg, type) => notify(msg, type ?? 'success')} />
      )}
      {activeTab === 'packages' && (
        <PackagesTab onNotify={(msg, type) => notify(msg, type ?? 'success')} />
      )}
      {activeTab === 'coming-soon' && (
        <ModulesTab
          botUsername={botUsername}
          appVersion={resolvedAppVersion}
          onOpenUserGroups={() => setIsUserGroupsModalOpen(true)}
          onOpenBankCards={() => setIsBankCardsModalOpen(true)}
          onOpenPaymentGateways={() => setIsPaymentGatewaysModalOpen(true)}
          onOpenReceiptSettings={() => setIsReceiptSettingsModalOpen(true)}
          onOpenForcedJoin={() => setIsForcedJoinModalOpen(true)}
          onOpenBulkGift={() => setIsBulkGiftModalOpen(true)}
        />
      )}
      <UserGroupsModal
        isOpen={isUserGroupsModalOpen}
        onClose={() => setIsUserGroupsModalOpen(false)}
        onNotify={(msg, type) => notify(msg, type ?? 'success')}
      />
      <ForcedJoinModal
        isOpen={isForcedJoinModalOpen}
        onClose={() => setIsForcedJoinModalOpen(false)}
        onNotify={(msg, type) => notify(msg, type ?? 'success')}
      />
      <BulkGiftModal
        isOpen={isBulkGiftModalOpen}
        onClose={() => setIsBulkGiftModalOpen(false)}
        onNotify={(msg, type) => notify(msg, type ?? 'success')}
      />
      <BankCardsModal
        isOpen={isBankCardsModalOpen}
        onClose={() => setIsBankCardsModalOpen(false)}
        onNotify={(msg, type) => notify(msg, type ?? 'success')}
      />
      <PaymentGatewaysModal
        isOpen={isPaymentGatewaysModalOpen}
        onClose={() => setIsPaymentGatewaysModalOpen(false)}
        onNotify={(msg, type) => notify(msg, type ?? 'success')}
      />
      <ReceiptSettingsModal
        isOpen={isReceiptSettingsModalOpen}
        onClose={() => setIsReceiptSettingsModalOpen(false)}
        onNotify={(msg, type) => notify(msg, type ?? 'success')}
      />
    </AppShell>
  );
};
