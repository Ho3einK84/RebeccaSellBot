import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BetaHeader } from './components/BetaHeader.js';
import { BetaBottomNav } from './components/BetaBottomNav.js';
import { QrCodeModal } from './components/QrCodeModal.js';
import { CheckoutModal } from './components/CheckoutModal.js';
import { DashboardTab } from './tabs/DashboardTab.js';
import { ServicesTab } from './tabs/ServicesTab.js';
import { ShopTab } from './tabs/ShopTab.js';
import { WalletTab } from './tabs/WalletTab.js';
import { ReferralTab } from './tabs/ReferralTab.js';
import { Toast } from '@/shared/components/ui/Toast.js';
import { AmbientBackground } from '@/shared/components/layout/AmbientBackground.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import {
  useUserProfile,
  useUserConfigs,
  useUserPackages,
  useUserTransactions,
} from './hooks/useUserPortalData.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';
import type { UserTabType, UserPackageItem } from '@/shared/types/userPortal.js';

interface UserBetaPortalProps {
  user: TelegramWebAppUser;
  onExitBeta: () => void;
}

export const UserBetaPortal: React.FC<UserBetaPortalProps> = ({ user, onExitBeta }) => {
  const { triggerHaptic } = useHaptic();

  const [activeTab, setActiveTab] = useState<UserTabType>('dashboard');
  const [tabHistory, setTabHistory] = useState<UserTabType[]>(['dashboard']);
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  // Modals state
  const [qrModal, setQrModal] = useState<{
    isOpen: boolean;
    subUrl: string;
    configUsername: string;
  }>({ isOpen: false, subUrl: '', configUsername: '' });

  const [checkoutModal, setCheckoutModal] = useState<{
    isOpen: boolean;
    pkg: UserPackageItem | null;
  }>({ isOpen: false, pkg: null });

  // Data fetching
  const {
    data: profileData,
    refetch: refetchProfile,
    isRefetching: isRefetchingProfile,
  } = useUserProfile();

  const {
    data: configsData,
    refetch: refetchConfigs,
    isRefetching: isRefetchingConfigs,
  } = useUserConfigs();

  const {
    data: packagesData,
    refetch: refetchPackages,
    isRefetching: isRefetchingPackages,
  } = useUserPackages();

  const {
    data: transactionsData,
    refetch: refetchTransactions,
    isRefetching: isRefetchingTransactions,
  } = useUserTransactions();

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
    }, 3500);
  };

  const handleRefresh = () => {
    triggerHaptic('light');
    void refetchProfile();
    void refetchConfigs();
    void refetchPackages();
    void refetchTransactions();
  };

  const isRefreshing =
    isRefetchingProfile || isRefetchingConfigs || isRefetchingPackages || isRefetchingTransactions;

  const switchTab = (tab: UserTabType) => {
    if (tab === activeTab) return;
    triggerHaptic('selection');
    if (tab === 'dashboard') {
      setTabHistory(['dashboard']);
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

  // Back button handling: pop tab history, or go to dashboard, or exit beta mode
  const handleBack = () => {
    if (tabHistory.length > 1) {
      triggerHaptic('selection');
      const nextHistory = tabHistory.slice(0, -1);
      const prevTab = nextHistory[nextHistory.length - 1] ?? 'dashboard';
      setTabHistory(nextHistory);
      setActiveTab(prevTab);
    } else if (activeTab !== 'dashboard') {
      triggerHaptic('selection');
      setTabHistory(['dashboard']);
      setActiveTab('dashboard');
    } else {
      triggerHaptic('medium');
      onExitBeta();
    }
  };

  useTelegramBackButton(handleBack, true);

  const profile = profileData?.user ?? null;
  const settings = profileData?.settings ?? null;
  const configs = configsData?.configs ?? [];
  const packages = packagesData?.packages ?? [];
  const transactions = transactionsData?.transactions ?? [];

  return (
    <div className="w-full min-h-screen min-h-[100dvh] flex flex-col items-center justify-start safe-top relative">
      <AmbientBackground />

      <main className="w-full max-w-lg mx-auto flex flex-col px-4 pt-3 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] relative z-10 flex-1">
        <BetaHeader
          user={user}
          onRefresh={handleRefresh}
          onExitBeta={onExitBeta}
          balance={activeTab === 'dashboard' ? undefined : profile?.availableBalance}
          currency={settings?.currency}
          isRefreshing={isRefreshing}
        />

        {/* Global Toast Notification */}
        {notification &&
          createPortal(
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
          )}

        {/* Tab view with entrance animation */}
        <div key={activeTab} className="animate-tab-in flex-1 flex flex-col">
          {activeTab === 'dashboard' && (
            <DashboardTab
              profile={profile}
              settings={settings}
              configs={configs}
              transactions={transactions}
              onSwitchTab={(tab) => switchTab(tab)}
            />
          )}

          {activeTab === 'services' && (
            <ServicesTab
              configs={configs}
              onOpenQr={(subUrl, configUsername) =>
                setQrModal({ isOpen: true, subUrl, configUsername })
              }
              onGoToShop={() => switchTab('shop')}
              onNotify={(msg) => notify(msg, 'success')}
            />
          )}

          {activeTab === 'shop' && (
            <ShopTab
              packages={packages}
              currency={settings?.currency}
              onSelectPackage={(pkg) => setCheckoutModal({ isOpen: true, pkg })}
            />
          )}

          {activeTab === 'wallet' && (
            <WalletTab
              profile={profile}
              settings={settings}
              transactions={transactions}
              onNotify={(msg) => notify(msg, 'success')}
            />
          )}

          {activeTab === 'referral' && (
            <ReferralTab
              profile={profile}
              settings={settings}
              onNotify={(msg) => notify(msg, 'success')}
            />
          )}
        </div>
      </main>

      {/* Sticky Bottom Navigation Bar */}
      <BetaBottomNav
        activeTab={activeTab}
        onSelectTab={(tab) => switchTab(tab)}
        configsCount={configs.length}
      />

      {/* QR Code Modal */}
      <QrCodeModal
        isOpen={qrModal.isOpen}
        onClose={() => setQrModal({ isOpen: false, subUrl: '', configUsername: '' })}
        subUrl={qrModal.subUrl}
        configUsername={qrModal.configUsername}
      />

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={checkoutModal.isOpen}
        onClose={() => setCheckoutModal({ isOpen: false, pkg: null })}
        pkg={checkoutModal.pkg}
        availableBalance={profile?.availableBalance ?? 0}
        currency={settings?.currency}
        onGoToWallet={() => switchTab('wallet')}
        onSuccess={(msg) => notify(msg, 'success')}
      />
    </div>
  );
};
