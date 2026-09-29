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
import { AmbientBackground } from '@/shared/components/layout/AmbientBackground.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
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

const UserPortalSkeleton: React.FC<{ isDark: boolean }> = ({ isDark }) => (
  <div className="w-full flex flex-col gap-3.5 animate-pulse">
    {/* Header skeleton */}
    <div className="w-full flex items-center justify-between gap-2 mb-1">
      <div className={`h-11 w-24 rounded-xl ${isDark ? 'bg-white/5' : 'bg-slate-200'}`} />
      <div className="flex items-center gap-1.5">
        <div className={`w-11 h-11 rounded-xl ${isDark ? 'bg-white/5' : 'bg-slate-200'}`} />
        <div className={`w-11 h-11 rounded-xl ${isDark ? 'bg-white/5' : 'bg-slate-200'}`} />
      </div>
    </div>
    {/* Profile row skeleton */}
    <div
      className={`w-full px-3 py-2.5 rounded-xl border flex items-center gap-2.5 ${
        isDark ? 'bg-white/[0.03] border-white/5' : 'bg-slate-100 border-slate-200'
      }`}
    >
      <div className={`w-8 h-8 rounded-full ${isDark ? 'bg-white/10' : 'bg-slate-300'}`} />
      <div className="flex-1 flex flex-col gap-1.5">
        <div className={`h-3.5 w-32 rounded ${isDark ? 'bg-white/10' : 'bg-slate-300'}`} />
        <div className={`h-2.5 w-16 rounded ${isDark ? 'bg-white/5' : 'bg-slate-200'}`} />
      </div>
    </div>
    {/* Balance card skeleton */}
    <div
      className={`w-full p-5 rounded-2xl border flex items-center justify-between gap-3.5 ${
        isDark ? 'bg-white/[0.03] border-white/5' : 'bg-white border-slate-200/80 shadow-2xs'
      }`}
    >
      <div className="flex items-center gap-3.5">
        <div className={`w-12 h-12 rounded-2xl ${isDark ? 'bg-white/10' : 'bg-slate-200'}`} />
        <div className="flex flex-col gap-2">
          <div className={`h-3 w-20 rounded ${isDark ? 'bg-white/5' : 'bg-slate-200'}`} />
          <div className={`h-6 w-32 rounded ${isDark ? 'bg-white/10' : 'bg-slate-300'}`} />
        </div>
      </div>
    </div>
    {/* Two column action cards */}
    <div className="grid grid-cols-2 gap-3">
      <div
        className={`h-24 rounded-2xl border ${
          isDark ? 'bg-white/[0.02] border-white/5' : 'bg-slate-100 border-slate-200'
        }`}
      />
      <div
        className={`h-24 rounded-2xl border ${
          isDark ? 'bg-white/[0.02] border-white/5' : 'bg-slate-100 border-slate-200'
        }`}
      />
    </div>
    {/* List items skeleton */}
    <div className="flex flex-col gap-2.5 mt-1">
      <div
        className={`h-16 rounded-2xl border ${
          isDark ? 'bg-white/[0.02] border-white/5' : 'bg-slate-100 border-slate-200'
        }`}
      />
      <div
        className={`h-16 rounded-2xl border ${
          isDark ? 'bg-white/[0.02] border-white/5' : 'bg-slate-100 border-slate-200'
        }`}
      />
    </div>
  </div>
);

const SectionErrorCard: React.FC<{
  title?: string;
  message?: string;
  onRetry: () => void;
  isRetrying?: boolean;
}> = ({ title, message, onRetry, isRetrying = false }) => {
  const { t } = useLanguage();
  const { isDark } = useThemeTokens();
  return (
    <div
      className={`p-5 rounded-2xl border text-center flex flex-col items-center gap-3 my-4 ${
        isDark
          ? 'bg-rose-950/20 border-rose-500/30 text-rose-200'
          : 'bg-rose-50 border-rose-200 text-rose-900'
      }`}
    >
      <AlertCircle className="w-8 h-8 text-rose-500 shrink-0" />
      <div className="flex flex-col gap-1 max-w-sm">
        <h4 className="font-bold text-sm m-0">{title || t('common.networkError')}</h4>
        <p className="text-xs opacity-80 leading-relaxed m-0">{message || t('common.error')}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white cursor-pointer active:scale-95 transition-all disabled:opacity-50 shadow-xs"
      >
        <RotateCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
        <span>{t('common.retry')}</span>
      </button>
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
  const { isDark } = useThemeTokens();
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

  // Dedicated 401 Session Expired Screen
  if (is401) {
    return (
      <div
        className={`w-full min-h-screen min-h-[100dvh] flex flex-col items-center justify-center p-4 safe-top relative ${
          isDark ? 'bg-[#090a0f] text-slate-100' : 'bg-[#f8fafc] text-slate-900'
        }`}
      >
        <AmbientBackground />
        <div
          className={`w-full max-w-sm p-6 rounded-2xl border text-center flex flex-col items-center gap-4 relative z-10 ${
            isDark
              ? 'bg-zinc-900/90 border-white/10 shadow-2xl'
              : 'bg-white border-slate-200 shadow-lg'
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center border border-amber-500/25">
            <LogOut className="w-7 h-7" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-base sm:text-lg font-bold m-0">{t('user.sessionExpiredTitle')}</h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed m-0">
              {t('user.sessionExpiredDesc')}
            </p>
          </div>
          <div className="w-full flex flex-col gap-2 mt-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer active:scale-95 transition-all shadow-md"
            >
              <RotateCw className="w-4 h-4" />
              <span>{t('user.reloadApp')}</span>
            </button>
            <button
              type="button"
              onClick={onExitBeta}
              className={`w-full min-h-[44px] py-2.5 px-4 rounded-xl font-semibold text-xs border flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all ${
                isDark
                  ? 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <span>{t('common.back')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Dedicated 403 / Account Suspended Screen
  if (isBanned) {
    const supportUsername = settings?.supportUsername || '';
    return (
      <div
        className={`w-full min-h-screen min-h-[100dvh] flex flex-col items-center justify-center p-4 safe-top relative ${
          isDark ? 'bg-[#090a0f] text-slate-100' : 'bg-[#f8fafc] text-slate-900'
        }`}
      >
        <AmbientBackground />
        <div
          className={`w-full max-w-sm p-6 rounded-2xl border text-center flex flex-col items-center gap-4 relative z-10 ${
            isDark
              ? 'bg-zinc-900/90 border-rose-500/25 shadow-2xl'
              : 'bg-white border-rose-200 shadow-lg'
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-rose-500/15 text-rose-500 flex items-center justify-center border border-rose-500/30">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-base sm:text-lg font-bold text-rose-500 m-0">
              {t('user.accountBannedTitle')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed m-0">
              {t('user.accountBannedDesc')}
            </p>
          </div>
          <div className="w-full flex flex-col gap-2 mt-2">
            {supportUsername && (
              <a
                href={`https://t.me/${supportUsername.replace(/^@/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer active:scale-95 transition-all shadow-md no-underline"
              >
                <MessageCircle className="w-4 h-4" />
                <span>
                  {t('user.contactSupport')} (@{supportUsername.replace(/^@/, '')})
                </span>
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                if (window.Telegram?.WebApp?.close) {
                  window.Telegram.WebApp.close();
                } else {
                  window.close();
                }
              }}
              className={`w-full min-h-[44px] py-2.5 px-4 rounded-xl font-semibold text-xs border flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all ${
                isDark
                  ? 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Send className="w-3.5 h-3.5 rtl:rotate-180" />
              <span>{t('user.backToBot')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // First-load Skeleton Placeholder
  if (isProfileLoading && !profileData) {
    return (
      <div className="w-full min-h-screen min-h-[100dvh] flex flex-col items-center justify-start safe-top relative">
        <AmbientBackground />
        <main className="w-full max-w-lg mx-auto flex flex-col px-4 pt-3 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] relative z-10 flex-1">
          <UserPortalSkeleton isDark={isDark} />
        </main>
        <BetaBottomNav
          activeTab={activeTab}
          onSelectTab={(tab) => switchTab(tab)}
          configsCount={0}
          hasPendingReceipt={false}
        />
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen min-h-[100dvh] flex flex-col items-center justify-start safe-top relative">
      <AmbientBackground />

      <main className="w-full max-w-lg mx-auto flex flex-col px-4 pt-3 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] relative z-10 flex-1">
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

        {/* Global Toast Notification Queue */}
        <ToastContainer toasts={toasts} onDismiss={removeToast} />

        {/* Tab view with entrance animation */}
        <div key={activeTab} className="animate-tab-in flex-1 flex flex-col">
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
                onOpenQr={(subUrl, configUsername) =>
                  setQrModal({ isOpen: true, subUrl, configUsername })
                }
                onGoToShop={() => switchTab('shop')}
                onNotify={(msg) => notify(msg, 'success')}
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
      </main>

      {/* Sticky Bottom Navigation Bar */}
      <BetaBottomNav
        activeTab={activeTab}
        onSelectTab={(tab) => switchTab(tab)}
        configsCount={configs.length}
        hasPendingReceipt={Boolean(pendingReceipt)}
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
