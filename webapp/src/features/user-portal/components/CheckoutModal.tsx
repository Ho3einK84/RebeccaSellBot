import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  ShoppingCart,
  CheckCircle2,
  AlertCircle,
  Wallet,
  ArrowRight,
  ShieldCheck,
  Clock,
  RefreshCw,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Skeleton } from '@/shared/components/ui/Skeleton.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import type { UserPackageItem, UserCheckoutResponse } from '@/shared/types/userPortal.js';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  pkg: UserPackageItem | null;
  availableBalance: number;
  currency?: string;
  onGoToWallet: () => void;
  onGoToServices?: () => void;
  onSuccess: (message: string) => void;
}

type CheckoutStep =
  | 'loading'
  | 'review'
  | 'insufficient_balance'
  | 'creation_error'
  | 'expired'
  | 'verifying'
  | 'confirm_error'
  | 'success';

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  pkg,
  availableBalance,
  currency,
  onGoToWallet,
  onGoToServices,
  onSuccess,
}) => {
  const { t } = useLanguage();
  const { isDark } = useThemeTokens();
  const { triggerHaptic } = useHaptic();
  const { formatToman } = useFormatters();
  const { copy, isCopied } = useCopy();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<CheckoutStep>('loading');
  const [checkout, setCheckout] = useState<UserCheckoutResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [deficitAmount, setDeficitAmount] = useState<number>(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [successData, setSuccessData] = useState<{
    configUsername: string;
    subUrl?: string;
  } | null>(null);
  const [qrSrc, setQrSrc] = useState<string>('');

  const displayCurrency = currency || t('common.currency');

  const createCheckoutSession = useCallback(async () => {
    if (!pkg) return;
    setStep('loading');
    setErrorMessage('');
    setCheckout(null);

    try {
      const isCustom = pkg.id === 'custom' || pkg.id.startsWith('custom');
      const res = isCustom
        ? await api.createCheckout({
            custom: {
              gb: pkg.gbAmount,
              days: pkg.durationDays,
            },
          })
        : await api.createCheckout({
            packageId: pkg.id,
          });

      setCheckout(res);
      setStep('review');
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        const errData = err.data as
          | { code?: string; deficit?: number; availableBalance?: number; price?: number }
          | undefined;

        if (
          err.status === 409 &&
          (err.code === 'INSUFFICIENT_BALANCE' || errData?.code === 'INSUFFICIENT_BALANCE')
        ) {
          const deficit =
            errData?.deficit ??
            Math.max(
              0,
              (errData?.price ?? pkg.price) - (errData?.availableBalance ?? availableBalance)
            );
          setDeficitAmount(deficit);
          setStep('insufficient_balance');
          return;
        }
        setErrorMessage(err.message || t('user.shop.checkoutErrorGeneric'));
      } else if (err instanceof Error) {
        setErrorMessage(err.message || t('user.shop.checkoutErrorGeneric'));
      } else {
        setErrorMessage(t('user.shop.checkoutErrorGeneric'));
      }
      setStep('creation_error');
    }
  }, [pkg, availableBalance, t]);

  // Trigger createCheckoutSession when modal opens with a valid package
  useEffect(() => {
    if (isOpen && pkg) {
      setSuccessData(null);
      setQrSrc('');
      setIsProcessing(false);
      void createCheckoutSession();
    } else if (!isOpen) {
      setStep('loading');
      setCheckout(null);
      setSuccessData(null);
      setQrSrc('');
      setIsProcessing(false);
      setErrorMessage('');
      setDeficitAmount(0);
      setRemainingSeconds(0);
    }
  }, [isOpen, pkg?.id, pkg?.gbAmount, pkg?.durationDays, createCheckoutSession]);

  // Live countdown timer for checkout expiry
  useEffect(() => {
    if (step !== 'review' || !checkout?.expiresAt) return;

    const calculateRemaining = () => {
      const expiresMs = new Date(checkout.expiresAt).getTime();
      const nowMs = Date.now();
      const diffSec = Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
      setRemainingSeconds(diffSec);
      if (diffSec <= 0) {
        setStep('expired');
      }
    };

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 1000);
    return () => clearInterval(interval);
  }, [step, checkout?.expiresAt]);

  const handleConfirmCheckout = async () => {
    if (!checkout || isProcessing) return;
    setIsProcessing(true);
    setErrorMessage('');
    triggerHaptic('medium');

    try {
      const res = await api.confirmCheckout(checkout.checkoutId);
      if (res.success) {
        triggerHaptic('success');

        // Invalidate queries for user data
        void queryClient.invalidateQueries({ queryKey: ['user-profile'] });
        void queryClient.invalidateQueries({ queryKey: ['user-configs'] });
        void queryClient.invalidateQueries({ queryKey: ['user-transactions'] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
        void queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
        void queryClient.invalidateQueries({ queryKey: ['user'] });

        setSuccessData({
          configUsername: res.configUsername,
          subUrl: res.subUrl,
        });

        if (res.subUrl) {
          QRCode.toDataURL(res.subUrl, {
            width: 220,
            margin: 1.5,
            color: { dark: '#000000', light: '#ffffff' },
          })
            .then((url) => setQrSrc(url))
            .catch(() => setQrSrc(''));
        }

        setStep('success');
        onSuccess(t('user.shop.orderSuccess'));
      }
    } catch (err: unknown) {
      triggerHaptic('error');
      if (err instanceof ApiClientError) {
        const errData = err.data as { code?: string; deficit?: number } | undefined;

        if (
          err.status === 202 ||
          err.code === 'PURCHASE_OUTCOME_PENDING' ||
          errData?.code === 'PURCHASE_OUTCOME_PENDING'
        ) {
          // Funds reserved, verifying outcome
          void queryClient.invalidateQueries({ queryKey: ['user-profile'] });
          void queryClient.invalidateQueries({ queryKey: ['user-configs'] });
          void queryClient.invalidateQueries({ queryKey: ['user-transactions'] });
          void queryClient.invalidateQueries({ queryKey: ['user'] });
          setStep('verifying');
          return;
        }

        if (
          err.status === 409 &&
          (err.code === 'PURCHASE_IN_PROGRESS' || errData?.code === 'PURCHASE_IN_PROGRESS')
        ) {
          setErrorMessage(t('user.shop.purchaseInProgress'));
          setStep('confirm_error');
          return;
        }

        if (
          err.status === 410 ||
          err.code === 'CHECKOUT_EXPIRED' ||
          errData?.code === 'CHECKOUT_EXPIRED'
        ) {
          setStep('expired');
          return;
        }

        if (err.status === 503 || err.code === 'PANEL_DOWN' || errData?.code === 'PANEL_DOWN') {
          setErrorMessage(t('user.shop.panelDownError'));
          setStep('confirm_error');
          return;
        }

        if (
          err.status === 409 &&
          (err.code === 'INSUFFICIENT_BALANCE' || errData?.code === 'INSUFFICIENT_BALANCE')
        ) {
          setDeficitAmount(
            errData?.deficit ?? Math.max(0, (checkout?.price ?? pkg?.price ?? 0) - availableBalance)
          );
          setStep('insufficient_balance');
          return;
        }

        setErrorMessage(err.message || t('user.shop.checkoutErrorGeneric'));
        setStep('confirm_error');
      } else if (err instanceof Error) {
        setErrorMessage(err.message || t('user.shop.checkoutErrorGeneric'));
        setStep('confirm_error');
      } else {
        setErrorMessage(t('user.shop.checkoutErrorGeneric'));
        setStep('confirm_error');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (isProcessing) return;
    onClose();
  };

  const handleGoToServices = () => {
    if (isProcessing) return;
    onClose();
    onGoToServices?.();
  };

  const handleGoToWallet = () => {
    if (isProcessing) return;
    onClose();
    onGoToWallet();
  };

  if (!pkg) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('user.shop.orderModalTitle')}
      icon={<ShoppingCart className="w-5 h-5 text-indigo-400" />}
      maxWidth="md"
      closeOnBackdrop={!isProcessing}
      hideCloseButton={isProcessing}
    >
      <div className="flex flex-col gap-4 text-start pt-1">
        {/* Step 1: Loading Skeleton */}
        {step === 'loading' && (
          <div className="flex flex-col gap-4">
            <div
              className={`p-4 rounded-2xl border flex flex-col gap-3 ${
                isDark ? 'bg-white/[0.03] border-white/[0.08]' : 'bg-slate-50 border-slate-200/80'
              }`}
            >
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-36 rounded-lg" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="pt-2 border-t border-slate-200/50 dark:border-white/[0.05] flex items-center justify-between">
                <Skeleton className="h-4 w-20 rounded-md" />
                <Skeleton className="h-5 w-24 rounded-md" />
              </div>
            </div>

            <div className="flex items-center justify-center py-6 gap-2 text-indigo-500 dark:text-indigo-400 text-xs font-medium">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{t('common.loading')}</span>
            </div>
          </div>
        )}

        {/* Step 2: Review & Confirm */}
        {step === 'review' && checkout && (
          <>
            {/* Expiry countdown banner */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-slate-500 dark:text-zinc-400">
                {t('user.shop.orderModalTitle')}
              </span>
              <div className="flex items-center gap-1.5 text-xs text-amber-500 dark:text-amber-400 font-mono font-semibold px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {t('user.shop.expiresIn').replace('{time}', formatCountdown(remainingSeconds))}
                </span>
              </div>
            </div>

            {/* Server-confirmed package card */}
            <div
              className={`p-4 rounded-2xl border ${
                isDark
                  ? 'bg-white/[0.03] border-white/[0.08]'
                  : 'bg-slate-50 border-slate-200/80 shadow-2xs'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`font-bold text-sm sm:text-base ${isDark ? 'text-white' : 'text-slate-900'}`}
                >
                  {checkout.name}
                </span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  {t('user.shop.trafficUnit').replace('{gb}', String(checkout.gb))}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400 pt-2 border-t border-slate-200/50 dark:border-white/[0.05]">
                <span>{t('user.shop.daysUnit').replace('{days}', String(checkout.days))}</span>
                <span className="font-bold text-sm text-indigo-500 dark:text-indigo-400">
                  {formatToman(checkout.price)} {displayCurrency}
                </span>
              </div>
            </div>

            {/* Feature points */}
            <div className="flex flex-col gap-1.5 px-1 text-[11px] text-slate-500 dark:text-zinc-400">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>{t('user.shop.fastConnectionFeature')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>{t('user.shop.allPlatformsFeature')}</span>
              </div>
            </div>

            {/* Wallet Balance Status */}
            <div
              className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                isDark
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 shrink-0" />
                <span>{t('user.dashboard.availableBalance')}</span>
              </div>
              <span className="font-mono font-bold">
                {formatToman(checkout.availableBalance)} {displayCurrency}
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 mt-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleConfirmCheckout}
                className="w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer shadow-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('common.loading')}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{t('user.shop.confirmOrder')}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={handleClose}
                className={`w-full py-2.5 rounded-xl border text-xs font-medium transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                  isDark
                    ? 'bg-white/[0.04] border-white/10 text-zinc-400 hover:text-white'
                    : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}

        {/* Step 3: Insufficient Balance */}
        {step === 'insufficient_balance' && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="flex flex-col gap-1">
              <h3
                className={`text-sm sm:text-base font-bold ${
                  isDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                {t('user.shop.insufficientBalance')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 m-0">
                {t('user.shop.chargeNeeded').replace('{amount}', formatToman(deficitAmount))}
              </p>
            </div>

            {/* Breakdown card */}
            <div
              className={`w-full p-3.5 rounded-xl border flex flex-col gap-2 text-xs text-start ${
                isDark ? 'bg-white/[0.03] border-white/[0.08]' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-zinc-400">{t('common.amount')}:</span>
                <span className="font-mono font-bold">
                  {formatToman(checkout?.price ?? pkg.price)} {displayCurrency}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-zinc-400">
                  {t('user.dashboard.availableBalance')}:
                </span>
                <span className="font-mono font-bold">
                  {formatToman(checkout?.availableBalance ?? availableBalance)} {displayCurrency}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60 dark:border-white/[0.08] text-rose-500 font-semibold">
                <span>{t('user.shop.chargeNeeded').split(':')[0]}:</span>
                <span className="font-mono font-bold">
                  {formatToman(deficitAmount)} {displayCurrency}
                </span>
              </div>
            </div>

            <div className="w-full flex flex-col gap-2 mt-1">
              <button
                type="button"
                onClick={handleGoToWallet}
                className="w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-slate-950 transition-all active:scale-[0.98] cursor-pointer shadow-md"
              >
                <Wallet className="w-4 h-4" />
                <span>{t('user.shop.goToWallet')}</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </button>

              <button
                type="button"
                onClick={handleClose}
                className={`w-full py-2.5 rounded-xl border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                  isDark
                    ? 'bg-white/[0.04] border-white/10 text-zinc-400 hover:text-white'
                    : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Checkout Expired */}
        {step === 'expired' && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
              <Clock className="w-6 h-6" />
            </div>

            <div className="flex flex-col gap-1">
              <h3
                className={`text-sm sm:text-base font-bold ${
                  isDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                {t('user.shop.checkoutExpiredTitle')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 m-0 max-w-xs">
                {t('user.shop.checkoutExpiredDesc')}
              </p>
            </div>

            <div className="w-full flex flex-col gap-2 mt-1">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('medium');
                  void createCheckoutSession();
                }}
                className="w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white transition-all active:scale-[0.98] cursor-pointer shadow-md"
              >
                <RefreshCw className="w-4 h-4" />
                <span>{t('user.shop.recreateCheckout')}</span>
              </button>

              <button
                type="button"
                onClick={handleClose}
                className={`w-full py-2.5 rounded-xl border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                  isDark
                    ? 'bg-white/[0.04] border-white/10 text-zinc-400 hover:text-white'
                    : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Verifying Screen (Outcome Pending) */}
        {step === 'verifying' && (
          <div className="flex flex-col items-center text-center gap-4 py-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>

            <div className="flex flex-col gap-1.5 max-w-sm">
              <h3
                className={`text-sm sm:text-base font-bold ${
                  isDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                {t('user.shop.orderVerifyingTitle')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 m-0 leading-relaxed">
                {t('user.shop.orderVerifyingDesc')}
              </p>
            </div>

            <div className="w-full flex flex-col gap-2 mt-2">
              <button
                type="button"
                onClick={handleGoToServices}
                className="w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white transition-all active:scale-[0.98] cursor-pointer shadow-md"
              >
                <span>{t('user.shop.goToServices')}</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </button>

              <button
                type="button"
                onClick={handleClose}
                className={`w-full py-2.5 rounded-xl border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                  isDark
                    ? 'bg-white/[0.04] border-white/10 text-zinc-400 hover:text-white'
                    : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}

        {/* Step 6: Creation Error or Confirm Error */}
        {(step === 'creation_error' || step === 'confirm_error') && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="flex flex-col gap-1 max-w-xs">
              <h3
                className={`text-sm sm:text-base font-bold ${
                  isDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                {t('user.shop.checkoutErrorTitle')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 m-0">
                {errorMessage || t('user.shop.checkoutErrorGeneric')}
              </p>
            </div>

            <div className="w-full flex flex-col gap-2 mt-1">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('medium');
                  if (step === 'creation_error') {
                    void createCheckoutSession();
                  } else {
                    void handleConfirmCheckout();
                  }
                }}
                className="w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white transition-all active:scale-[0.98] cursor-pointer shadow-md"
              >
                <RefreshCw className="w-4 h-4" />
                <span>{t('user.shop.retry')}</span>
              </button>

              <button
                type="button"
                onClick={handleClose}
                className={`w-full py-2.5 rounded-xl border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                  isDark
                    ? 'bg-white/[0.04] border-white/10 text-zinc-400 hover:text-white'
                    : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Step 7: Success Screen */}
        {step === 'success' && successData && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
              <CheckCircle2 className="w-6 h-6" />
            </div>

            <div className="flex flex-col gap-1">
              <h3
                className={`text-sm sm:text-base font-bold ${
                  isDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                {t('user.shop.orderSuccess')}
              </h3>
            </div>

            {/* Service Username */}
            <div
              className={`w-full p-3 rounded-xl border flex items-center justify-between text-xs ${
                isDark ? 'bg-white/[0.03] border-white/[0.08]' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <span className="text-slate-500 dark:text-zinc-400">
                {t('user.shop.configUsername')}:
              </span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">
                {successData.configUsername}
              </span>
            </div>

            {/* Subscription URL with Copy feedback */}
            {successData.subUrl && (
              <div className="w-full flex flex-col gap-1.5 text-start">
                <span className="text-xs text-slate-500 dark:text-zinc-400 font-medium">
                  {t('user.shop.subUrl')}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={successData.subUrl}
                    className="flex-1 py-2 px-3 rounded-xl border text-xs font-mono bg-slate-50 dark:bg-white/[0.03] border-slate-200 dark:border-white/10 select-all truncate text-slate-700 dark:text-zinc-300"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      copy(successData.subUrl!, 'checkout-sub-url');
                    }}
                    className={`py-2 px-3.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                      isCopied('checkout-sub-url')
                        ? 'bg-emerald-600 text-white'
                        : isDark
                          ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
                    }`}
                  >
                    {isCopied('checkout-sub-url') ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>{t('common.copied')}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>{t('common.copy')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* QR Code */}
            {qrSrc && (
              <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-center my-1">
                <img
                  src={qrSrc}
                  alt={t('user.services.qrTitle')}
                  className="w-[160px] h-[160px] sm:w-[180px] sm:h-[180px] select-none pointer-events-none"
                />
              </div>
            )}

            {/* Action Button: Go to My Services */}
            <div className="w-full flex flex-col gap-2 mt-2">
              <button
                type="button"
                onClick={handleGoToServices}
                className="w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white transition-all active:scale-[0.98] cursor-pointer shadow-md"
              >
                <span>{t('user.shop.goToServices')}</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </button>

              <button
                type="button"
                onClick={handleClose}
                className={`w-full py-2.5 rounded-xl border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                  isDark
                    ? 'bg-white/[0.04] border-white/10 text-zinc-400 hover:text-white'
                    : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
