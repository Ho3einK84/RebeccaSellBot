import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AlertCircle, ShieldAlert, LogOut, RotateCw, MessageCircle, Send } from 'lucide-react';
import { BetaHeader } from './components/BetaHeader.js';
import { BetaBottomNav } from './components/BetaBottomNav.js';
import { QrCodeModal } from './components/QrCodeModal.js';
import { CheckoutModal } from './components/CheckoutModal.js';
import { DashboardTab } from './tabs/DashboardTab.js';
import { ServicesTab } from './tabs/ServicesTab.js';
import { ShopTab } from './tabs/ShopTab.js';
import { WalletTab } from './tabs/WalletTab.js';
import { ReferralTab } from './tabs/ReferralTab.js';
import { ToastContainer, useToastQueue } from '@/shared/components/ui/Toast.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Skeleton, SkeletonCard, SkeletonList } from '@/shared/components/ui/Skeleton.js';
import { AmbientBackground } from '@/shared/components/layout/AmbientBackground.js';
import { AppShell } from '@/shared/components/layout/AppShell.js';
import { DesktopNav } from '@/shared/components/layout/DesktopNav.js';
import { useUserNavItems } from './hooks/useUserNavItems.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { ApiClientError } from '@/shared/lib/api.js';
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
  isAdminPreview?: boolean;
  onSwitchToAdmin?: () => void;
}

const UserPortalSkeleton: React.FC = () => (
  <div className="flex w-full flex-col gap-3">
    {/* Header skeleton */}
    <div className="mb-1 flex w-full items-center justify-between gap-2">
      <Skeleton className="h-[68px] flex-1 rounded-card" />
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-9 w-9 rounded-ctl" />
        <Skeleton className="h-9 w-9 rounded-ctl" />
      </div>
    </div>
    {/* Balance card skeleton */}
    <SkeletonCard />
    {/* Two column action cards */}
    <div className="grid grid-cols-2 gap-3">
      <Skeleton className="h-24 rounded-card" />
      <Skeleton className="h-24 rounded-card" />
    </div>
    {/* List items skeleton */}
    <SkeletonList count={2} />
  </div>
);

const SectionErrorCard: React.FC<{
  title?: string;
  message?: string;
  onRetry: () => void;
  isRetrying?: boolean;
}> = ({ title, message, onRetry, isRetrying = false }) => {
  const { t } = useLanguage();
  return (
    <div className="anim-fade my-4 flex flex-col items-center gap-3 rounded-card border border-danger/25 bg-danger-soft p-5 text-center text-ink">
      <AlertCircle className="h-8 w-8 shrink-0 text-danger" />
      <div className="flex flex-col gap-1 max-w-sm">
        <h4 className="font-bold text-sm m-0">{title || t('common.networkError')}</h4>
        <p className="text-xs opacity-80 leading-relaxed m-0">{message || t('common.error')}</p>
      </div>
      <Button
        variant="danger"
        size="sm"
        onClick={onRetry}
        disabled={isRetrying}
        loading={isRetrying}
        className="min-h-[40px] px-4"
      >
        <RotateCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
        <span>{t('common.retry')}</span>
      </Button>
    </div>
  );
};

export const UserBetaPortal: React.FC<UserBetaPortalProps> = ({
  user,
  onExitBeta,
  isAdminPreview = false,
  onSwitchToAdmin,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const { toasts, addToast, removeToast } = useToastQueue();

  const [activeTab, setActiveTab] = useState<UserTabType>('dashboard');
  const [tabHistory, setTabHistory] = useState<UserTabType[]>(['dashboard']);

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
    isLoading: isProfileLoading,
    isError: isProfileError,
    error: profileError,
  } = useUserProfile();

  const {
    data: configsData,
    refetch: refetchConfigs,
    isRefetching: isRefetchingConfigs,
    isError: isConfigsError,
    error: configsError,
  } = useUserConfigs();

  const {
    data: packagesData,
    refetch: refetchPackages,
    isRefetching: isRefetchingPackages,
    isError: isPackagesError,
    error: packagesError,
  } = useUserPackages();

  const {
    data: transactionsData,
    refetch: refetchTransactions,
    isRefetching: isRefetchingTransactions,
    error: transactionsError,
  } = useUserTransactions();

  const allErrors = useMemo(
    () => [profileError, configsError, packagesError, transactionsError].filter(Boolean),
    [profileError, configsError, packagesError, transactionsError]
  );

  const is401 = allErrors.some((err) => err instanceof ApiClientError && err.status === 401);

  const isBanned = allErrors.some(
    (err) => err instanceof ApiClientError && (err.status === 403 || err.code === 'USER_BANNED')
  );

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    addToast(message, type);
    triggerHaptic(type === 'success' ? 'success' : 'error');
  };

  // Notify on errors
  const lastNotifiedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (is401 || isBanned) return;
    const activeError = allErrors[0];
    if (activeError) {
      const msg = activeError instanceof Error ? activeError.message : t('common.networkError');
      if (lastNotifiedErrorRef.current !== msg) {
        lastNotifiedErrorRef.current = msg;
        notify(msg, 'error');
      }
    } else {
      lastNotifiedErrorRef.current = null;
    }
  }, [allErrors, is401, isBanned, t]);

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
    window.scrollTo({ top: 0, behavior: 'instant' });
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
    window.scrollTo({ top: 0, behavior: 'instant' });
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
      if (isAdminPreview && onSwitchToAdmin) {
        onSwitchToAdmin();
      } else {
        onExitBeta();
      }
    }
  };

  useTelegramBackButton(handleBack, true);

  const profile = profileData?.user ?? null;
  const settings = profileData?.settings ?? null;
  const pendingReceipt = profileData?.pendingReceipt ?? null;
  const configs = configsData?.configs ?? [];
  const packages = packagesData?.packages ?? [];
  const transactions = transactionsData?.transactions ?? [];

  const navItems = useUserNavItems({
    configsCount: configs.length,
    hasPendingReceipt: Boolean(pendingReceipt),
  });

  // Dedicated 401 Session Expired Screen
  if (is401) {
    return (
      <div className="safe-top relative flex min-h-[100dvh] w-full flex-col items-center justify-center bg-canvas p-4 text-ink">
        <AmbientBackground />
        <div className="anim-rise relative z-10 flex w-full max-w-sm flex-col items-center gap-4 rounded-card border border-line bg-surface p-6 text-center shadow-e3">
          <IconTile tone="warn" size="lg">
            <LogOut />
          </IconTile>
          <div className="flex flex-col gap-1.5">
            <h2 className="m-0 text-base font-bold sm:text-lg">{t('user.sessionExpiredTitle')}</h2>
            <p className="m-0 text-xs leading-relaxed text-ink-muted">
              {t('user.sessionExpiredDesc')}
            </p>
          </div>
          <div className="w-full flex flex-col gap-2 mt-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] font-bold text-xs sm:text-sm"
            >
              <RotateCw className="w-4 h-4" />
              <span>{t('user.reloadApp')}</span>
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={onExitBeta}
              className="w-full min-h-[44px] font-semibold text-xs"
            >
              <span>{t('common.back')}</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Dedicated 403 / Account Suspended Screen
  if (isBanned) {
    const supportUsername = settings?.supportUsername || '';
    return (
      <div className="safe-top relative flex min-h-[100dvh] w-full flex-col items-center justify-center bg-canvas p-4 text-ink">
        <AmbientBackground />
        <div className="anim-rise relative z-10 flex w-full max-w-sm flex-col items-center gap-4 rounded-card border border-danger/25 bg-surface p-6 text-center shadow-e3">
          <IconTile tone="danger" size="lg">
            <ShieldAlert />
          </IconTile>
          <div className="flex flex-col gap-1.5">
            <h2 className="m-0 text-base font-bold text-danger sm:text-lg">
              {t('user.accountBannedTitle')}
            </h2>
            <p className="m-0 text-xs leading-relaxed text-ink-muted">
              {t('user.accountBannedDesc')}
            </p>
          </div>
          <div className="w-full flex flex-col gap-2 mt-2">
            {supportUsername && (
              <a
                href={`https://t.me/${supportUsername.replace(/^@/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="press rs-focus flex min-h-[44px] w-full items-center justify-center gap-2 rounded-ctl bg-brand px-4 py-2.5 text-xs font-bold text-brand-ink no-underline shadow-e2 sm:text-sm"
              >
                <MessageCircle className="w-4 h-4" />
                <span>
                  {t('user.contactSupport')} (@{supportUsername.replace(/^@/, '')})
                </span>
              </a>
            )}
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                if (window.Telegram?.WebApp?.close) {
                  window.Telegram.WebApp.close();
                } else {
                  window.close();
                }
              }}
              className="w-full min-h-[44px] font-semibold text-xs"
            >
              <Send className="w-3.5 h-3.5 rtl:rotate-180" />
              <span>{t('user.backToBot')}</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // First-load Skeleton Placeholder
  if (isProfileLoading && !profileData) {
    return (
      <AppShell
        width="narrow"
        transitionKey="skeleton"
        bottomNav={
          <BetaBottomNav
            activeTab={activeTab}
            onSelectTab={(tab) => switchTab(tab)}
            configsCount={0}
            hasPendingReceipt={false}
          />
        }
      >
        <UserPortalSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell
      width="narrow"
      transitionKey={activeTab}
      header={
        <BetaHeader
          user={user}
          onRefresh={handleRefresh}
          onExitBeta={onExitBeta}
          isAdminPreview={isAdminPreview}
          onSwitchToAdmin={onSwitchToAdmin}
          balance={activeTab === 'dashboard' ? undefined : profile?.availableBalance}
          currency={settings?.currency}
          isRefreshing={isRefreshing}
        />
      }
      desktopNav={
        <DesktopNav
          items={navItems}
          activeId={activeTab}
          onSelect={switchTab}
          ariaLabel="ناوبری حساب کاربری"
        />
      }
      overlay={<ToastContainer toasts={toasts} onDismiss={removeToast} />}
      bottomNav={
        <BetaBottomNav
          activeTab={activeTab}
          onSelectTab={(tab) => switchTab(tab)}
          configsCount={configs.length}
          hasPendingReceipt={Boolean(pendingReceipt)}
        />
      }
    >
      <div className="flex flex-1 flex-col">
        {activeTab === 'dashboard' &&
          (isProfileError && !profileData ? (
            <SectionErrorCard onRetry={refetchProfile} isRetrying={isRefetchingProfile} />
          ) : (
            <DashboardTab
              profile={profile}
              settings={settings}
              configs={configs}
              transactions={transactions}
              onSwitchTab={(tab) => switchTab(tab)}
            />
          ))}

        {activeTab === 'services' &&
          (isConfigsError && (!configsData || configs.length === 0) ? (
            <SectionErrorCard onRetry={refetchConfigs} isRetrying={isRefetchingConfigs} />
          ) : (
            <ServicesTab
              configs={configs}
              botUsername={settings?.botUsername}
              onOpenQr={(subUrl, configUsername) =>
                setQrModal({ isOpen: true, subUrl, configUsername })
              }
              onGoToShop={() => switchTab('shop')}
              onNotify={(msg, type) => notify(msg, type ?? 'success')}
            />
          ))}

        {activeTab === 'shop' &&
          (isPackagesError && (!packagesData || packages.length === 0) ? (
            <SectionErrorCard onRetry={refetchPackages} isRetrying={isRefetchingPackages} />
          ) : (
            <ShopTab
              packages={packages}
              currency={settings?.currency}
              customVolumeSettings={settings?.customVolume}
              botUsername={settings?.botUsername}
              onSelectPackage={(pkg) => setCheckoutModal({ isOpen: true, pkg })}
            />
          ))}

        {activeTab === 'wallet' &&
          (isProfileError && !profileData ? (
            <SectionErrorCard onRetry={refetchProfile} isRetrying={isRefetchingProfile} />
          ) : (
            <WalletTab
              profile={profile}
              settings={settings}
              transactions={transactions}
              pendingReceipt={pendingReceipt}
              onNotify={(msg) => notify(msg, 'success')}
            />
          ))}

        {activeTab === 'referral' && (
          <ReferralTab
            profile={profile}
            settings={settings}
            onNotify={(msg) => notify(msg, 'success')}
          />
        )}
      </div>

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
        onGoToServices={() => switchTab('services')}
        onSuccess={(msg) => notify(msg, 'success')}
      />
    </AppShell>
  );
};
