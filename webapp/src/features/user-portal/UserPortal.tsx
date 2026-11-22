import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AlertCircle, ShieldAlert, LogOut, RefreshCw, MessageCircle, Send } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { UserPortalHeader } from './components/UserPortalHeader.js';
import { UserBottomNav } from './components/UserBottomNav.js';
import { QrCodeModal } from './components/QrCodeModal.js';
import { CheckoutModal } from './components/CheckoutModal.js';
import { DashboardTab } from './tabs/DashboardTab.js';
import { ServicesTab } from './tabs/ServicesTab.js';
import { ShopTab } from './tabs/ShopTab.js';
import { WalletTab } from './tabs/WalletTab.js';
import { ReferralTab } from './tabs/ReferralTab.js';
import { useToast } from '@/shared/components/ui/Toast.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Skeleton, SkeletonCard, SkeletonList } from '@/shared/components/ui/Skeleton.js';
import { AppShell } from '@/shared/components/layout/AppShell.js';
import { DesktopNav } from '@/shared/components/layout/DesktopNav.js';
import { useUserNavItems } from './hooks/useUserNavItems.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { ApiClientError } from '@/shared/lib/api.js';
import { minimizeOrCloseWebApp } from '@/shared/lib/telegramNavigation.js';
import {
  useUserProfile,
  useUserConfigs,
  useUserPackages,
  useUserTransactions,
} from './hooks/useUserPortalData.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';
import type {
  UserTabType,
  UserPackageItem,
  UserConfigRecord,
  WalletDeficitContext,
} from '@/shared/types/userPortal.js';

interface UserPortalProps {
  user: TelegramWebAppUser;
  isAdminView?: boolean;
  onSwitchToAdmin?: () => void;
}

const UserPortalSkeleton: React.FC = () => (
  <div className="flex w-full flex-col gap-4">
    <div className="flex w-full items-center justify-between gap-2 rounded-card border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Skeleton className="h-10 w-10 rounded-tile shrink-0" />
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-9 w-9 rounded-ctl" />
        <Skeleton className="h-9 w-9 rounded-ctl" />
      </div>
    </div>
    <SkeletonCard />
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      <Skeleton className="h-24 rounded-tile" />
      <Skeleton className="h-24 rounded-tile" />
      <Skeleton className="h-24 rounded-tile" />
      <Skeleton className="h-24 rounded-tile" />
    </div>
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
    <Card
      tone="danger"
      padding="lg"
      className="anim-fade my-4 flex flex-col items-center gap-3 text-center text-ink"
    >
      <IconTile tone="danger" size="lg">
        <AlertCircle />
      </IconTile>
      <div className="flex flex-col gap-1 max-w-sm">
        <h4 className="font-semibold text-sm text-ink m-0">{title || t('common.networkError')}</h4>
        <p className="text-xs text-ink-soft leading-relaxed m-0">{message || t('common.error')}</p>
      </div>
      <Button
        variant="danger"
        size="sm"
        onClick={onRetry}
        disabled={isRetrying}
        loading={isRetrying}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
        <span>{t('common.retry')}</span>
      </Button>
    </Card>
  );
};

export const UserPortal: React.FC<UserPortalProps> = ({
  user,
  isAdminView = false,
  onSwitchToAdmin,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<UserTabType>('dashboard');
  const [tabHistory, setTabHistory] = useState<UserTabType[]>(['dashboard']);
  const [focusedConfigId, setFocusedConfigId] = useState<string | null>(null);

  // Modals state
  const [qrModal, setQrModal] = useState<{
    isOpen: boolean;
    subUrl: string;
    configUsername: string;
  }>({ isOpen: false, subUrl: '', configUsername: '' });

  const [checkoutModal, setCheckoutModal] = useState<{
    isOpen: boolean;
    mode: 'purchase' | 'renewal';
    pkg: UserPackageItem | null;
    targetConfig: UserConfigRecord | null;
  }>({ isOpen: false, mode: 'purchase', pkg: null, targetConfig: null });

  const [walletDeficit, setWalletDeficit] = useState<WalletDeficitContext | null>(null);

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

  // Notify on transient API errors once per distinct message
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
  }, [allErrors, is401, isBanned, notify, t]);

  const handleRefresh = () => {
    triggerHaptic('light');
    void queryClient.invalidateQueries({ queryKey: ['user'] });
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

  const handleOpenServiceFromDashboard = (configId: string) => {
    setFocusedConfigId(configId);
    switchTab('services');
  };

  // Native Telegram BackButton: navigate back across tabs, or return to Admin Console when in admin view.
  // On root dashboard for standard users, hide BackButton so Telegram displays its native Close affordance.
  const canNavigateBack =
    tabHistory.length > 1 || activeTab !== 'dashboard' || Boolean(isAdminView && onSwitchToAdmin);

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
    } else if (isAdminView && onSwitchToAdmin) {
      triggerHaptic('medium');
      onSwitchToAdmin();
    }
  };

  useTelegramBackButton(handleBack, canNavigateBack);

  const profile = profileData?.user ?? null;
  const settings = profileData?.settings ?? null;
  const pendingReceipt = profileData?.pendingReceipt ?? null;
  const configs = configsData?.configs ?? [];
  const packages = packagesData?.packages ?? [];
  const categories = packagesData?.categories ?? [];
  const transactions = transactionsData?.transactions ?? [];

  const handleOpenRenewalModal = (config: UserConfigRecord) => {
    setCheckoutModal({
      isOpen: true,
      mode: 'renewal',
      pkg: null,
      targetConfig: config,
    });
  };

  const navItems = useUserNavItems({
    configsCount: configs.length,
    hasPendingReceipt: Boolean(pendingReceipt),
  });

  // Dedicated 401 Session Expired Screen
  if (is401) {
    return (
      <div className="safe-top safe-bottom relative flex min-h-[100dvh] w-full flex-col items-center justify-center bg-canvas p-4 text-ink">
        <Card
          padding="lg"
          className="anim-rise relative z-10 flex w-full max-w-sm flex-col items-center gap-4 text-center"
        >
          <IconTile tone="warn" size="lg">
            <LogOut />
          </IconTile>
          <div className="flex flex-col gap-1.5">
            <h2 className="m-0 text-base font-semibold sm:text-lg leading-[1.4]">
              {t('user.sessionExpiredTitle')}
            </h2>
            <p className="m-0 text-xs leading-relaxed text-ink-muted">
              {t('user.sessionExpiredDesc')}
            </p>
          </div>
          <div className="w-full flex flex-col gap-2 pt-2 border-t border-line">
            <Button variant="primary" size="md" block onClick={() => window.location.reload()}>
              <RefreshCw className="w-4 h-4" />
              <span>{t('user.reloadApp')}</span>
            </Button>
            {isAdminView && onSwitchToAdmin ? (
              <Button variant="secondary" size="md" block onClick={onSwitchToAdmin}>
                <span>{t('user.backToAdmin')}</span>
              </Button>
            ) : (
              <Button variant="secondary" size="md" block onClick={minimizeOrCloseWebApp}>
                <Send className="w-3.5 h-3.5" />
                <span>{t('user.backToBot')}</span>
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  // Dedicated 403 / Account Suspended Screen
  if (isBanned) {
    const supportUsername = (settings?.supportUsername || '').replace(/^@/, '').trim();
    return (
      <div className="safe-top safe-bottom relative flex min-h-[100dvh] w-full flex-col items-center justify-center bg-canvas p-4 text-ink">
        <Card
          padding="lg"
          className="anim-rise relative z-10 flex w-full max-w-sm flex-col items-center gap-4 border-danger/30 text-center"
        >
          <IconTile tone="danger" size="lg">
            <ShieldAlert />
          </IconTile>
          <div className="flex flex-col gap-1.5">
            <h2 className="m-0 text-base font-semibold text-danger-fg sm:text-lg leading-[1.4]">
              {t('user.accountBannedTitle')}
            </h2>
            <p className="m-0 text-xs leading-relaxed text-ink-muted">
              {t('user.accountBannedDesc')}
            </p>
          </div>
          <div className="w-full flex flex-col gap-2 pt-2 border-t border-line">
            {supportUsername && (
              <a
                href={`https://t.me/${supportUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                className="press rs-focus flex min-h-11 w-full items-center justify-center gap-2 rounded-ctl bg-brand hover:bg-brand-hover px-4 text-xs font-medium text-brand-ink no-underline sm:text-sm"
              >
                <MessageCircle className="w-4 h-4 shrink-0" />
                <span>
                  {t('user.contactSupport')} (<bdi dir="ltr">@{supportUsername}</bdi>)
                </span>
              </a>
            )}
            <Button variant="secondary" size="md" block onClick={minimizeOrCloseWebApp}>
              <Send className="w-3.5 h-3.5 shrink-0" />
              <span>{t('user.backToBot')}</span>
            </Button>
          </div>
        </Card>
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
          <UserBottomNav
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
        <UserPortalHeader
          user={user}
          onRefresh={handleRefresh}
          isAdminView={isAdminView}
          onSwitchToAdmin={onSwitchToAdmin}
          balance={activeTab === 'dashboard' ? undefined : profile?.availableBalance}
          currency={settings?.currency}
          onOpenWallet={() => switchTab('wallet')}
          isRefreshing={isRefreshing}
        />
      }
      desktopNav={
        <DesktopNav
          items={navItems}
          activeId={activeTab}
          onSelect={switchTab}
          ariaLabel={t('user.navAriaLabel')}
        />
      }
      bottomNav={
        <UserBottomNav
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
              onOpenService={handleOpenServiceFromDashboard}
              onRenewConfig={handleOpenRenewalModal}
            />
          ))}

        {activeTab === 'services' &&
          (isConfigsError && (!configsData || configs.length === 0) ? (
            <SectionErrorCard onRetry={refetchConfigs} isRetrying={isRefetchingConfigs} />
          ) : (
            <ServicesTab
              configs={configs}
              botUsername={settings?.botUsername}
              currency={settings?.currency}
              initialConfigId={focusedConfigId}
              onClearInitialConfig={() => setFocusedConfigId(null)}
              onOpenQr={(subUrl, configUsername) =>
                setQrModal({ isOpen: true, subUrl, configUsername })
              }
              onGoToShop={() => switchTab('shop')}
              onRenewConfig={handleOpenRenewalModal}
              onNotify={(msg, type) => notify(msg, type ?? 'success')}
            />
          ))}

        {activeTab === 'shop' &&
          (isPackagesError && (!packagesData || packages.length === 0) ? (
            <SectionErrorCard onRetry={refetchPackages} isRetrying={isRefetchingPackages} />
          ) : (
            <ShopTab
              packages={packages}
              categories={categories}
              currency={settings?.currency}
              customVolumeSettings={settings?.customVolume}
              botUsername={settings?.botUsername}
              onSelectPackage={(pkg) =>
                setCheckoutModal({ isOpen: true, mode: 'purchase', pkg, targetConfig: null })
              }
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
              deficitContext={walletDeficit}
              onClearDeficit={() => setWalletDeficit(null)}
              onNotify={(msg, type) => notify(msg, type ?? 'success')}
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

      {/* Checkout & Native Renewal Modal */}
      <CheckoutModal
        isOpen={checkoutModal.isOpen}
        onClose={() =>
          setCheckoutModal({ isOpen: false, mode: 'purchase', pkg: null, targetConfig: null })
        }
        mode={checkoutModal.mode}
        pkg={checkoutModal.pkg}
        targetConfig={checkoutModal.targetConfig}
        availableBalance={profile?.availableBalance ?? 0}
        currency={settings?.currency}
        customServiceNameEnabled={settings?.customServiceNameEnabled}
        botUsername={settings?.botUsername}
        customVolumeSettings={settings?.customVolume}
        onGoToWallet={() => switchTab('wallet')}
        onGoToWalletWithDeficit={(deficit) => {
          setWalletDeficit(deficit);
          switchTab('wallet');
        }}
        onGoToServices={() => switchTab('services')}
        onSuccess={(msg) => {
          setWalletDeficit(null);
          notify(msg, 'success');
        }}
      />
    </AppShell>
  );
};
