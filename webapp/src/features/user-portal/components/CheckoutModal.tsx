import React, { useReducer, useEffect, useCallback, useRef } from 'react';
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
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import type { UserPackageItem } from '@/shared/types/userPortal.js';
import {
  INITIAL_CHECKOUT_STATE,
  buildPackageKey,
  checkoutReducer,
  formatCountdown,
  resolveRetryAction,
} from './checkoutState.js';

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
  const { triggerHaptic } = useHaptic();
  const { formatToman, formatNumber } = useFormatters();
  const { copy, isCopied } = useCopy();
  const queryClient = useQueryClient();

  const [state, dispatch] = useReducer(checkoutReducer, INITIAL_CHECKOUT_STATE);
  const {
    step,
    checkout,
    isProcessing,
    errorMessage,
    deficitAmount,
    remainingSeconds,
    successData,
    qrSrc,
  } = state;

  const displayCurrency = currency || t('common.currency');

  // Stable ref for availableBalance so createCheckoutSession does not depend on balance changes
  const availableBalanceRef = useRef<number>(availableBalance);
  availableBalanceRef.current = availableBalance;

  // Track active step and processing status via refs to freeze async continuations
  const stepRef = useRef(step);
  stepRef.current = step;

  /**
   * Live success check. The success transition may land while a request is
   * still in flight, so read through a call (not an inline comparison) to avoid
   * TypeScript narrowing `stepRef.current` with a stale union.
   */
  const reachedSuccess = (): boolean => stepRef.current === 'success';

  const isProcessingRef = useRef<boolean>(isProcessing);
  isProcessingRef.current = isProcessing;

  // Track session creation per open cycle & package key to prevent duplicate calls
  const sessionPkgKeyRef = useRef<string | null>(null);

  const createCheckoutSession = useCallback(async () => {
    const pkgKey = buildPackageKey(pkg);
    if (!pkg || !pkgKey) return;
    // Freeze: Never recreate checkout session if already in success or currently processing
    if (reachedSuccess() || isProcessingRef.current) return;

    dispatch({ type: 'CREATE_START', pkgKey });

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

      // If state transitioned to success during network latency, do not overwrite
      if (reachedSuccess()) return;

      dispatch({ type: 'CREATE_SUCCESS', checkout: res });
    } catch (err: unknown) {
      if (reachedSuccess()) return;

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
              (errData?.price ?? pkg.price) -
                (errData?.availableBalance ?? availableBalanceRef.current)
            );
          dispatch({ type: 'CREATE_INSUFFICIENT_BALANCE', deficit });
          return;
        }
        dispatch({
          type: 'CREATE_ERROR',
          message: err.message || t('user.shop.checkoutErrorGeneric'),
        });
      } else if (err instanceof Error) {
        dispatch({
          type: 'CREATE_ERROR',
          message: err.message || t('user.shop.checkoutErrorGeneric'),
        });
      } else {
        dispatch({
          type: 'CREATE_ERROR',
          message: t('user.shop.checkoutErrorGeneric'),
        });
      }
    }
  }, [pkg, t]);

  // Trigger createCheckoutSession when modal opens with a valid package or switches packages
  useEffect(() => {
    const currentPkgKey = buildPackageKey(pkg);
    if (isOpen && pkg && currentPkgKey) {
      if (sessionPkgKeyRef.current === currentPkgKey) {
        // Freeze modal state for the active open cycle of the same package
        return;
      }
      if (sessionPkgKeyRef.current !== null && !reachedSuccess() && !isProcessingRef.current) {
        // Package changed while modal stayed open: reset before initiating the new session
        dispatch({ type: 'RESET' });
      }
      if (reachedSuccess() || isProcessingRef.current) {
        return;
      }
      sessionPkgKeyRef.current = currentPkgKey;
      void createCheckoutSession();
    } else if (!isOpen) {
      sessionPkgKeyRef.current = null;
      dispatch({ type: 'RESET' });
    }
  }, [isOpen, pkg, createCheckoutSession]);

  // Live countdown timer for checkout expiry
  useEffect(() => {
    if (step !== 'review' || !checkout?.expiresAt) return;

    const tick = () => {
      dispatch({ type: 'TICK_EXPIRY', nowMs: Date.now() });
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [step, checkout?.expiresAt]);

  const handleConfirmCheckout = async () => {
    if (!checkout || isProcessing) return;
    dispatch({ type: 'CONFIRM_START' });
    triggerHaptic('medium');

    try {
      const res = await api.confirmCheckout(checkout.checkoutId);
      if (res.success) {
        triggerHaptic('success');

        // Invalidate queries for user data
        void queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
        void queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
        void queryClient.invalidateQueries({ queryKey: ['user', 'transactions'] });
        void queryClient.invalidateQueries({ queryKey: ['user'] });

        dispatch({
          type: 'CONFIRM_SUCCESS',
          data: {
            configUsername: res.configUsername,
            subUrl: res.subUrl,
          },
        });

        if (res.subUrl) {
          QRCode.toDataURL(res.subUrl, {
            width: 220,
            margin: 1.5,
            color: { dark: '#000000', light: '#ffffff' },
          })
            .then((url) => dispatch({ type: 'SET_QR', qrSrc: url }))
            .catch(() => dispatch({ type: 'SET_QR', qrSrc: '' }));
        }

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
          void queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
          void queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
          void queryClient.invalidateQueries({ queryKey: ['user', 'transactions'] });
          void queryClient.invalidateQueries({ queryKey: ['user'] });
          dispatch({ type: 'CONFIRM_VERIFYING' });
          return;
        }

        if (
          err.status === 409 &&
          (err.code === 'PURCHASE_IN_PROGRESS' || errData?.code === 'PURCHASE_IN_PROGRESS')
        ) {
          dispatch({ type: 'CONFIRM_ERROR', message: t('user.shop.purchaseInProgress') });
          return;
        }

        if (
          err.status === 410 ||
          err.code === 'CHECKOUT_EXPIRED' ||
          errData?.code === 'CHECKOUT_EXPIRED'
        ) {
          dispatch({ type: 'CONFIRM_EXPIRED' });
          return;
        }

        if (err.status === 503 || err.code === 'PANEL_DOWN' || errData?.code === 'PANEL_DOWN') {
          dispatch({ type: 'CONFIRM_ERROR', message: t('user.shop.panelDownError') });
          return;
        }

        if (
          err.status === 409 &&
          (err.code === 'INSUFFICIENT_BALANCE' || errData?.code === 'INSUFFICIENT_BALANCE')
        ) {
          dispatch({
            type: 'CONFIRM_INSUFFICIENT_BALANCE',
            deficit:
              errData?.deficit ??
              Math.max(0, (checkout?.price ?? pkg?.price ?? 0) - availableBalanceRef.current),
          });
          return;
        }

        dispatch({
          type: 'CONFIRM_ERROR',
          message: err.message || t('user.shop.checkoutErrorGeneric'),
        });
      } else if (err instanceof Error) {
        dispatch({
          type: 'CONFIRM_ERROR',
          message: err.message || t('user.shop.checkoutErrorGeneric'),
        });
      } else {
        dispatch({
          type: 'CONFIRM_ERROR',
          message: t('user.shop.checkoutErrorGeneric'),
        });
      }
    }
  };

  const handleClose = () => {
    if (isProcessing) return;
    triggerHaptic('light');
    onClose();
  };

  const handleGoToServices = () => {
    if (isProcessing) return;
    triggerHaptic('selection');
    onClose();
    onGoToServices?.();
  };

  const handleGoToWallet = () => {
    if (isProcessing) return;
    triggerHaptic('selection');
    onClose();
    onGoToWallet();
  };

  if (!pkg) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={step === 'success' ? t('user.shop.orderSuccess') : t('user.shop.orderModalTitle')}
      icon={
        <IconTile tone={step === 'success' ? 'ok' : 'brand'} size="sm">
          {step === 'success' ? <CheckCircle2 /> : <ShoppingCart />}
        </IconTile>
      }
      maxWidth="md"
      closeOnBackdrop={!isProcessing}
      hideCloseButton={isProcessing}
    >
      <div className="flex flex-col gap-4 text-start pt-1">
        {/* Step 1: Loading Skeleton */}
        {step === 'loading' && (
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-tile border flex flex-col gap-3 bg-surface-2 border-line">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-36 rounded-ctl" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="pt-2 border-t border-line flex items-center justify-between">
                <Skeleton className="h-4 w-20 rounded-ctl" />
                <Skeleton className="h-5 w-24 rounded-ctl" />
              </div>
            </div>

            <div className="flex items-center justify-center py-6 gap-2 text-brand-fg text-xs font-medium">
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
              <span className="text-xs text-ink-muted">{t('user.shop.orderModalTitle')}</span>
              <div className="flex items-center gap-1.5 text-xs text-warn-fg tnum font-semibold px-2.5 py-1 rounded-ctl bg-warn-soft border border-warn/25">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {t('user.shop.expiresIn').replace('{time}', formatCountdown(remainingSeconds))}
                </span>
              </div>
            </div>

            {/* Server-confirmed package card */}
            <div className="p-4 rounded-tile border bg-surface-2 border-line">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm sm:text-base text-ink">{checkout.name}</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-brand-soft text-brand-fg border border-brand/25">
                  {t('user.shop.trafficUnit').replace('{gb}', formatNumber(checkout.gb))}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs text-ink-muted pt-2 border-t border-line">
                <span>
                  {t('user.shop.daysUnit').replace('{days}', formatNumber(checkout.days))}
                </span>
                <span className="font-semibold text-sm text-brand-fg tnum">
                  {formatToman(checkout.price)} {displayCurrency}
                </span>
              </div>
            </div>

            {/* Feature points */}
            <div className="flex flex-col gap-1.5 px-1 text-[11px] text-ink-muted">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-ok-fg shrink-0" />
                <span>{t('user.shop.fastConnectionFeature')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-ok-fg shrink-0" />
                <span>{t('user.shop.allPlatformsFeature')}</span>
              </div>
            </div>

            {/* Wallet Balance Status */}
            <div className="p-3 rounded-tile border flex items-center justify-between text-xs bg-ok-soft border-ok/25 text-ok-fg">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 shrink-0" />
                <span>{t('user.dashboard.availableBalance')}</span>
              </div>
              <span className="tnum font-semibold">
                {formatToman(checkout.availableBalance)} {displayCurrency}
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 mt-2">
              <Button
                type="button"
                variant="primary"
                size="md"
                block
                disabled={isProcessing}
                loading={isProcessing}
                onClick={handleConfirmCheckout}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{t('user.shop.confirmOrder')}</span>
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={isProcessing}
                onClick={handleClose}
                className="w-full"
              >
                {t('common.cancel')}
              </Button>
            </div>
          </>
        )}

        {/* Step 3: Insufficient Balance */}
        {step === 'insufficient_balance' && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <div className="w-12 h-12 rounded-tile bg-warn-soft border border-warn/25 flex items-center justify-center text-warn-fg">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="text-sm sm:text-base font-semibold text-ink">
                {t('user.shop.insufficientBalance')}
              </h3>
              <p className="text-xs text-ink-muted m-0">
                {t('user.shop.chargeNeeded').replace('{amount}', formatToman(deficitAmount))}
              </p>
            </div>

            {/* Breakdown card */}
            <div className="w-full p-3.5 rounded-tile border flex flex-col gap-2 text-xs text-start bg-surface-2 border-line">
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">{t('common.amount')}:</span>
                <span className="tnum font-semibold">
                  {formatToman(checkout?.price ?? pkg.price)} {displayCurrency}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">{t('user.dashboard.availableBalance')}:</span>
                <span className="tnum font-semibold">
                  {formatToman(checkout?.availableBalance ?? availableBalance)} {displayCurrency}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-line text-danger-fg font-semibold">
                <span>{t('user.shop.chargeNeeded').split(':')[0]}:</span>
                <span className="tnum font-semibold">
                  {formatToman(deficitAmount)} {displayCurrency}
                </span>
              </div>
            </div>

            <div className="w-full flex flex-col gap-2 mt-1">
              <Button type="button" variant="primary" size="md" block onClick={handleGoToWallet}>
                <Wallet className="w-4 h-4" />
                <span>{t('user.shop.goToWallet')}</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </Button>

              <Button type="button" variant="secondary" size="md" block onClick={handleClose}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Checkout Expired */}
        {step === 'expired' && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <div className="w-12 h-12 rounded-tile bg-warn-soft border border-warn/25 flex items-center justify-center text-warn-fg">
              <Clock className="w-6 h-6" />
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="text-sm sm:text-base font-semibold text-ink">
                {t('user.shop.checkoutExpiredTitle')}
              </h3>
              <p className="text-xs text-ink-muted m-0 max-w-xs">
                {t('user.shop.checkoutExpiredDesc')}
              </p>
            </div>

            <div className="w-full flex flex-col gap-2 mt-1">
              <Button
                type="button"
                variant="primary"
                size="md"
                block
                onClick={() => {
                  triggerHaptic('medium');
                  void createCheckoutSession();
                }}
              >
                <RefreshCw className="w-4 h-4" />
                <span>{t('user.shop.recreateCheckout')}</span>
              </Button>

              <Button type="button" variant="secondary" size="md" block onClick={handleClose}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 5: Verifying Screen (Outcome Pending) */}
        {step === 'verifying' && (
          <div className="flex flex-col items-center text-center gap-4 py-3">
            <div className="w-12 h-12 rounded-tile bg-brand-soft border border-brand/25 flex items-center justify-center text-brand-fg">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>

            <div className="flex flex-col gap-1.5 max-w-sm">
              <h3 className="text-sm sm:text-base font-semibold text-ink">
                {t('user.shop.orderVerifyingTitle')}
              </h3>
              <p className="text-xs text-ink-muted m-0 leading-relaxed">
                {t('user.shop.orderVerifyingDesc')}
              </p>
            </div>

            <div className="w-full flex flex-col gap-2 mt-2">
              <Button type="button" variant="primary" size="md" block onClick={handleGoToServices}>
                <span>{t('user.shop.goToServices')}</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </Button>

              <Button type="button" variant="secondary" size="md" block onClick={handleClose}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 6: Creation Error or Confirm Error */}
        {(step === 'creation_error' || step === 'confirm_error') && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <div className="w-12 h-12 rounded-tile bg-danger-soft border border-danger/25 flex items-center justify-center text-danger-fg">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="flex flex-col gap-1 max-w-xs">
              <h3 className="text-sm sm:text-base font-semibold text-ink">
                {t('user.shop.checkoutErrorTitle')}
              </h3>
              <p className="text-xs text-ink-muted m-0">
                {errorMessage || t('user.shop.checkoutErrorGeneric')}
              </p>
            </div>

            <div className="w-full flex flex-col gap-2 mt-1">
              <Button
                type="button"
                variant="primary"
                size="md"
                block
                onClick={() => {
                  triggerHaptic('medium');
                  const retryAction = resolveRetryAction();
                  if (retryAction === 'create_new_session') {
                    void createCheckoutSession();
                  }
                }}
              >
                <RefreshCw className="w-4 h-4" />
                <span>{t('user.shop.retry')}</span>
              </Button>

              <Button type="button" variant="secondary" size="md" block onClick={handleClose}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 7: Success Screen */}
        {step === 'success' && successData && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <div className="w-12 h-12 rounded-tile bg-ok-soft border border-ok/25 flex items-center justify-center text-ok-fg">
              <CheckCircle2 className="w-6 h-6" />
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="text-sm sm:text-base font-semibold text-ink">
                {t('user.shop.orderSuccess')}
              </h3>
            </div>

            {/* Service Username */}
            <div className="w-full p-3 rounded-tile border flex items-center justify-between text-xs bg-surface-2 border-line">
              <span className="text-ink-muted">{t('user.shop.configUsername')}:</span>
              <bdi dir="ltr" className="font-mono font-semibold text-ink">
                {successData.configUsername}
              </bdi>
            </div>

            {/* Subscription URL with Copy feedback */}
            {successData.subUrl && (
              <div className="w-full flex flex-col gap-1.5 text-start">
                <span className="text-xs text-ink-muted font-medium">{t('user.shop.subUrl')}</span>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    dir="ltr"
                    value={successData.subUrl}
                    className="flex-1 h-10 px-3 rounded-ctl border text-xs font-mono bg-surface-2 border-line select-all truncate text-ink-soft"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      copy(successData.subUrl!, 'checkout-sub-url');
                    }}
                    className={`h-10 px-3.5 rounded-ctl text-xs font-medium flex items-center gap-1.5 press rs-focus cursor-pointer shrink-0 ${
                      isCopied('checkout-sub-url')
                        ? 'bg-ok text-white'
                        : 'bg-brand hover:bg-brand-hover text-brand-ink'
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

            {/* High-contrast white QR Code frame */}
            {qrSrc ? (
              <div className="bg-white p-3 rounded-card border border-line flex items-center justify-center my-1">
                <img
                  src={qrSrc}
                  alt={t('user.services.qrTitle')}
                  className="w-[160px] h-[160px] sm:w-[180px] sm:h-[180px] select-none pointer-events-none"
                />
              </div>
            ) : successData.subUrl ? (
              <div className="bg-surface-2 p-3 rounded-card border border-line flex items-center justify-center my-1 w-[184px] h-[184px] sm:w-[204px] sm:h-[204px]">
                <Loader2 className="w-6 h-6 animate-spin text-ink-muted" />
              </div>
            ) : null}

            {/* Action Button: Go to My Services */}
            <div className="w-full flex flex-col gap-2 mt-2">
              <Button type="button" variant="primary" size="md" block onClick={handleGoToServices}>
                <span>{t('user.shop.goToServices')}</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </Button>

              <Button type="button" variant="secondary" size="md" block onClick={handleClose}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
