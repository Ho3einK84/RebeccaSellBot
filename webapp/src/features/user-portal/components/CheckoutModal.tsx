import React, { useReducer, useEffect, useCallback, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ShoppingCart,
  CheckCircle2,
  AlertCircle,
  Wallet,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Clock,
  RefreshCw,
  Copy,
  Check,
  Loader2,
  Ticket,
  Flame,
  Smartphone,
  ExternalLink,
  Zap,
  Sliders,
  Package,
  Plus,
  Minus,
  Sparkles,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Skeleton } from '@/shared/components/ui/Skeleton.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { SegmentedControl } from '@/shared/components/ui/SegmentedControl.js';
import { useToast } from '@/shared/components/ui/Toast.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
import { openTelegramLinkAndMinimize } from '@/shared/lib/telegramNavigation.js';
import { useTelegramContactVerification } from '@/shared/hooks/useTelegramContactVerification.js';
import { SmartConnectButtons } from './SmartConnectButtons.js';
import { ForcedJoinModal, extractForcedJoinPayload } from './ForcedJoinGate.js';
import type {
  CustomVolumeQuoteResponse,
  CustomVolumeSettings,
  ForcedJoinChannelDto,
  PromoQuoteResponse,
  UserConfigRecord,
  UserPackageItem,
  UserRenewalOptionsResponse,
  WalletDeficitContext,
} from '@/shared/types/userPortal.js';
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
  mode?: 'purchase' | 'renewal';
  targetConfig?: UserConfigRecord | null;
  availableBalance: number;
  creditLimit?: number;
  purchasingPower?: number;
  allowPromoCodes?: boolean;
  currency?: string;
  customServiceNameEnabled?: boolean;
  botUsername?: string;
  customVolumeSettings?: CustomVolumeSettings;
  onGoToWallet: () => void;
  onGoToWalletWithDeficit?: (context: WalletDeficitContext) => void;
  onGoToServices?: () => void;
  onSuccess: (message: string) => void;
}

const RENEW_CUSTOM_PRESETS = [10, 20, 30, 50, 100, 200];
const CUSTOM_NAME_REGEX = /^[a-z][a-z0-9_]{2,20}$/;

function normalizeClientCustomName(raw: string): string {
  return normalizeInputDigits(raw).trim().toLowerCase();
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  pkg,
  mode = 'purchase',
  targetConfig = null,
  availableBalance,
  creditLimit = 0,
  purchasingPower,
  allowPromoCodes = true,
  currency,
  customServiceNameEnabled = false,
  botUsername,
  customVolumeSettings,
  onGoToWallet,
  onGoToWalletWithDeficit,
  onGoToServices,
  onSuccess,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const { formatToman, formatNumber } = useFormatters();
  const { copy, isCopied } = useCopy();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const isRenewal = mode === 'renewal' && Boolean(targetConfig);
  const displayCurrency = currency || t('common.currency');

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

  // Renewal package selector state
  const [renewalOptions, setRenewalOptions] = useState<UserRenewalOptionsResponse | null>(null);
  const [isLoadingRenewalOptions, setIsLoadingRenewalOptions] = useState(false);
  const [renewalOptionsError, setRenewalOptionsError] = useState<string | null>(null);
  const [selectedRenewalPkg, setSelectedRenewalPkg] = useState<UserPackageItem | null>(null);
  const [renewTab, setRenewTab] = useState<'packages' | 'custom'>('packages');

  // Custom volume state inside renewal selector
  const minGb = customVolumeSettings?.minGb ?? 5;
  const maxGb = customVolumeSettings?.maxGb ?? 500;
  const defaultDays = customVolumeSettings?.defaultDays ?? 30;
  const basePricePerGb = customVolumeSettings?.pricePerGb ?? 5000;
  const [renewCustomGb, setRenewCustomGb] = useState<number>(() =>
    Math.min(Math.max(30, minGb), maxGb)
  );
  const [renewTypedGb, setRenewTypedGb] = useState<string>(() =>
    String(Math.min(Math.max(30, minGb), maxGb))
  );
  const [renewCustomQuote, setRenewCustomQuote] = useState<CustomVolumeQuoteResponse | null>(null);
  const [isFetchingRenewQuote, setIsFetchingRenewQuote] = useState(false);

  // Promo code state
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<PromoQuoteResponse | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);

  // Custom service name state (purchase only)
  const [customNameInput, setCustomNameInput] = useState('');

  // Shortfall metadata from 409 response
  const [shortfallPrice, setShortfallPrice] = useState<number | null>(null);
  const [shortfallCreditLimit, setShortfallCreditLimit] = useState<number | null>(null);
  const [shortfallPurchasingPower, setShortfallPurchasingPower] = useState<number | null>(null);
  const [forcedJoinChannels, setForcedJoinChannels] = useState<ForcedJoinChannelDto[] | null>(null);

  const effectivePkg = isRenewal ? (pkg ?? selectedRenewalPkg) : pkg;
  const isSelectingRenewalPackage = isRenewal && effectivePkg === null;

  // Stable refs
  const availableBalanceRef = useRef<number>(availableBalance);
  availableBalanceRef.current = availableBalance;
  const creditLimitRef = useRef<number>(creditLimit);
  creditLimitRef.current = creditLimit;
  const purchasingPowerRef = useRef<number>(
    purchasingPower ?? Math.max(0, availableBalance + creditLimit)
  );
  purchasingPowerRef.current = purchasingPower ?? Math.max(0, availableBalance + creditLimit);

  const stepRef = useRef(step);
  stepRef.current = step;
  const reachedSuccess = (): boolean => stepRef.current === 'success';

  const isProcessingRef = useRef<boolean>(isProcessing);
  isProcessingRef.current = isProcessing;

  const sessionPkgKeyRef = useRef<string | null>(null);

  // Load renewal options when opening in renewal mode without a pre-selected package
  useEffect(() => {
    if (!isOpen || !isRenewal || !targetConfig) return;
    let cancelled = false;
    setIsLoadingRenewalOptions(true);
    setRenewalOptionsError(null);

    api
      .getRenewalOptions(targetConfig.id)
      .then((res) => {
        if (cancelled) return;
        setRenewalOptions(res);
        if (res.packages.length === 0 && res.customVolumeEnabled) {
          setRenewTab('custom');
        } else {
          setRenewTab('packages');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRenewalOptionsError(t('common.networkError'));
        setRenewalOptions(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingRenewalOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, isRenewal, targetConfig, t]);

  // Live quote for custom volume tab inside renewal selector
  useEffect(() => {
    if (!isOpen || !isSelectingRenewalPackage || renewTab !== 'custom') return;
    let cancelled = false;
    setIsFetchingRenewQuote(true);
    const timer = setTimeout(async () => {
      try {
        const quote = await api.getUserQuote(renewCustomGb, defaultDays);
        if (!cancelled) setRenewCustomQuote(quote);
      } catch {
        if (!cancelled) setRenewCustomQuote(null);
      } finally {
        if (!cancelled) setIsFetchingRenewQuote(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, isSelectingRenewalPackage, renewTab, renewCustomGb, defaultDays]);

  const createCheckoutSession = useCallback(
    async (overrides?: { promoCode?: string | null; requestedUsername?: string | null }) => {
      const targetPkg = effectivePkg;
      const pkgKey = buildPackageKey(targetPkg);
      if (!targetPkg || !pkgKey) return;
      if (reachedSuccess() || isProcessingRef.current) return;

      const resolvedPromoCode =
        overrides && 'promoCode' in overrides
          ? overrides.promoCode || undefined
          : appliedPromo?.code || undefined;
      const normalizedName =
        overrides && 'requestedUsername' in overrides
          ? overrides.requestedUsername || undefined
          : !isRenewal && customServiceNameEnabled
            ? (() => {
                const candidate = normalizeClientCustomName(customNameInput);
                return CUSTOM_NAME_REGEX.test(candidate) ? candidate : undefined;
              })()
            : undefined;

      dispatch({ type: 'CREATE_START', pkgKey });
      setShortfallPrice(null);

      try {
        const isCustom = targetPkg.id === 'custom' || targetPkg.id.startsWith('custom');
        const payload = {
          ...(isRenewal && targetConfig
            ? { kind: 'renew_config' as const, configId: targetConfig.id }
            : {}),
          ...(isCustom
            ? {
                custom: {
                  gb: targetPkg.gbAmount,
                  days: targetPkg.durationDays,
                },
              }
            : { packageId: targetPkg.id }),
          ...(resolvedPromoCode ? { promoCode: resolvedPromoCode } : {}),
          ...(normalizedName ? { requestedUsername: normalizedName } : {}),
        };

        const res = await api.createCheckout(payload);
        if (reachedSuccess()) return;

        dispatch({ type: 'CREATE_SUCCESS', checkout: res });
      } catch (err: unknown) {
        if (reachedSuccess()) return;

        if (err instanceof ApiClientError) {
          const fjPayload = extractForcedJoinPayload(err);
          if (fjPayload) {
            setForcedJoinChannels(fjPayload.channels);
            dispatch({
              type: 'CREATE_ERROR',
              message: t('user.forcedJoin.purchaseDesc'),
            });
            return;
          }
          const errData = err.data as
            | {
                code?: string;
                deficit?: number;
                availableBalance?: number;
                creditLimit?: number;
                purchasingPower?: number;
                price?: number;
              }
            | undefined;

          if (
            err.status === 403 &&
            (err.code === 'PHONE_VERIFICATION_REQUIRED' ||
              errData?.code === 'PHONE_VERIFICATION_REQUIRED')
          ) {
            dispatch({ type: 'CREATE_PHONE_REQUIRED' });
            return;
          }

          if (
            err.status === 409 &&
            (err.code === 'INSUFFICIENT_BALANCE' || errData?.code === 'INSUFFICIENT_BALANCE')
          ) {
            const serverPrice = errData?.price ?? targetPkg.price;
            setShortfallPrice(serverPrice);
            setShortfallCreditLimit(
              typeof errData?.creditLimit === 'number'
                ? errData.creditLimit
                : creditLimitRef.current
            );
            setShortfallPurchasingPower(
              typeof errData?.purchasingPower === 'number'
                ? errData.purchasingPower
                : purchasingPowerRef.current
            );
            const deficit =
              errData?.deficit ??
              Math.max(0, serverPrice - (errData?.purchasingPower ?? purchasingPowerRef.current));
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
    },
    [
      effectivePkg,
      isRenewal,
      targetConfig,
      appliedPromo?.code,
      customServiceNameEnabled,
      customNameInput,
      t,
    ]
  );

  // Reset modal local state when closed; trigger checkout creation when effectivePkg changes
  useEffect(() => {
    if (!isOpen) {
      sessionPkgKeyRef.current = null;
      setSelectedRenewalPkg(null);
      setRenewalOptions(null);
      setRenewalOptionsError(null);
      setPromoOpen(false);
      setPromoInput('');
      setAppliedPromo(null);
      setPromoError(null);
      setCustomNameInput('');
      setShortfallPrice(null);
      setShortfallCreditLimit(null);
      setShortfallPurchasingPower(null);
      setForcedJoinChannels(null);
      dispatch({ type: 'RESET' });
      return;
    }

    const baseKey = buildPackageKey(effectivePkg);
    const currentPkgKey = baseKey
      ? `${isRenewal ? `renew:${targetConfig?.id ?? ''}` : 'buy'}:${baseKey}`
      : null;

    if (effectivePkg && currentPkgKey) {
      if (sessionPkgKeyRef.current === currentPkgKey) {
        return;
      }
      if (sessionPkgKeyRef.current !== null && !reachedSuccess() && !isProcessingRef.current) {
        dispatch({ type: 'RESET' });
      }
      if (reachedSuccess() || isProcessingRef.current) {
        return;
      }
      sessionPkgKeyRef.current = currentPkgKey;
      void createCheckoutSession({ promoCode: null, requestedUsername: null });
    }
  }, [isOpen, effectivePkg, isRenewal, targetConfig?.id, createCheckoutSession]);

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

  const handleApplyPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = promoInput.trim();
    if (!trimmed || !effectivePkg || isApplyingPromo) return;
    setIsApplyingPromo(true);
    setPromoError(null);
    triggerHaptic('selection');

    try {
      const isCustom = effectivePkg.id === 'custom' || effectivePkg.id.startsWith('custom');
      const quote = await api.quotePromo({
        code: trimmed,
        ...(isCustom
          ? { custom: { gb: effectivePkg.gbAmount, days: effectivePkg.durationDays } }
          : { packageId: effectivePkg.id }),
      });
      setAppliedPromo(quote);
      setPromoInput('');
      triggerHaptic('success');
      await createCheckoutSession({ promoCode: quote.code });
    } catch (err: unknown) {
      triggerHaptic('error');
      if (err instanceof ApiClientError && err.code === 'PROMO_NOT_ALLOWED') {
        setPromoError(t('user.shop.promoNotAllowedForGroup'));
      } else if (err instanceof ApiClientError && err.code === 'PROMO_GIFT_CREDIT_ONLY') {
        setPromoError(t('user.shop.promoGiftCreditHint'));
      } else {
        setPromoError(t('user.shop.promoInvalid'));
      }
    } finally {
      setIsApplyingPromo(false);
    }
  };

  const handleRemovePromo = async () => {
    if (isApplyingPromo || isProcessing) return;
    triggerHaptic('light');
    setAppliedPromo(null);
    setPromoError(null);
    await createCheckoutSession({ promoCode: null });
  };

  const normalizedCustomName = normalizeClientCustomName(customNameInput);
  const customNameHasInput =
    !isRenewal && customServiceNameEnabled && normalizedCustomName.length > 0;
  const isCustomNameInvalid = customNameHasInput && !CUSTOM_NAME_REGEX.test(normalizedCustomName);

  const handleConfirmCheckout = async () => {
    if (!checkout || isProcessing || isCustomNameInvalid) return;
    dispatch({ type: 'CONFIRM_START' });
    triggerHaptic('medium');

    try {
      let activeCheckoutId = checkout.checkoutId;

      // If user typed a valid custom service name after checkout creation, re-create checkout with it before confirming
      if (
        !isRenewal &&
        customServiceNameEnabled &&
        effectivePkg &&
        (normalizedCustomName || '') !== (checkout.requestedUsername ?? '')
      ) {
        const isCustom = effectivePkg.id === 'custom' || effectivePkg.id.startsWith('custom');
        const refreshed = await api.createCheckout({
          ...(isCustom
            ? { custom: { gb: effectivePkg.gbAmount, days: effectivePkg.durationDays } }
            : { packageId: effectivePkg.id }),
          ...(appliedPromo?.code ? { promoCode: appliedPromo.code } : {}),
          ...(normalizedCustomName ? { requestedUsername: normalizedCustomName } : {}),
        });
        activeCheckoutId = refreshed.checkoutId;
        dispatch({ type: 'CREATE_SUCCESS', checkout: refreshed });
        dispatch({ type: 'CONFIRM_START' });
      }

      const res = await api.confirmCheckout(activeCheckoutId);
      if (res.success) {
        triggerHaptic('success');

        void queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
        void queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
        void queryClient.invalidateQueries({ queryKey: ['user', 'transactions'] });
        void queryClient.invalidateQueries({ queryKey: ['user'] });

        dispatch({
          type: 'CONFIRM_SUCCESS',
          data: {
            configUsername: res.configUsername,
            subUrl: res.subUrl,
            kind: res.kind ?? (isRenewal ? 'renew_config' : 'new_config'),
            startOnFirstUse: res.startOnFirstUse ?? checkout.startOnFirstUse,
            availableBalanceAfter: res.availableBalanceAfter,
          },
        });

        if (!isRenewal && res.subUrl) {
          QRCode.toDataURL(res.subUrl, {
            width: 220,
            margin: 1.5,
            color: { dark: '#000000', light: '#ffffff' },
          })
            .then((url) => dispatch({ type: 'SET_QR', qrSrc: url }))
            .catch(() => dispatch({ type: 'SET_QR', qrSrc: '' }));
        }

        onSuccess(isRenewal ? t('user.services.renewSuccessTitle') : t('user.shop.orderSuccess'));
      } else {
        // Defensive fallback if server returned 2xx without `success: true`
        const raw = res as unknown as { code?: string; error?: string; message?: string };
        if (raw?.code === 'PURCHASE_OUTCOME_PENDING') {
          void queryClient.invalidateQueries({ queryKey: ['user'] });
          dispatch({ type: 'CONFIRM_VERIFYING' });
        } else {
          dispatch({
            type: 'CONFIRM_ERROR',
            message: raw?.error || raw?.message || t('user.shop.checkoutErrorGeneric'),
          });
        }
      }
    } catch (err: unknown) {
      triggerHaptic('error');
      if (err instanceof ApiClientError) {
        const fjPayload = extractForcedJoinPayload(err);
        if (fjPayload) {
          setForcedJoinChannels(fjPayload.channels);
          dispatch({
            type: 'CONFIRM_ERROR',
            message: t('user.forcedJoin.purchaseDesc'),
          });
          return;
        }
        const errData = err.data as { code?: string; deficit?: number } | undefined;

        if (
          err.status === 403 &&
          (err.code === 'PHONE_VERIFICATION_REQUIRED' ||
            errData?.code === 'PHONE_VERIFICATION_REQUIRED')
        ) {
          dispatch({ type: 'CONFIRM_PHONE_REQUIRED' });
          return;
        }

        if (
          err.status === 202 ||
          err.code === 'PURCHASE_OUTCOME_PENDING' ||
          errData?.code === 'PURCHASE_OUTCOME_PENDING'
        ) {
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
              Math.max(
                0,
                (checkout?.price ?? effectivePkg?.price ?? 0) - purchasingPowerRef.current
              ),
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

  const handleBackToRenewalSelector = () => {
    if (isProcessing) return;
    triggerHaptic('light');
    sessionPkgKeyRef.current = null;
    setSelectedRenewalPkg(null);
    setAppliedPromo(null);
    setPromoError(null);
    setPromoOpen(false);
    setShortfallPrice(null);
    dispatch({ type: 'RESET' });
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
    if (onGoToWalletWithDeficit && deficitAmount > 0) {
      onGoToWalletWithDeficit({
        amount: deficitAmount,
        itemName:
          checkout?.name ??
          effectivePkg?.name ??
          targetConfig?.configUsername ??
          t('user.shop.orderModalTitle'),
      });
      return;
    }
    onGoToWallet();
  };

  const phoneVerify = useTelegramContactVerification({
    botUsername,
    onVerified: () => {
      triggerHaptic('success');
      void createCheckoutSession();
    },
    onFallbackOpened: () => {
      onClose();
    },
  });

  const handleOpenPhoneVerifyInBot = () => {
    triggerHaptic('medium');
    const cleanBot = (botUsername || '').replace(/^@/, '').trim();
    if (cleanBot) {
      openTelegramLinkAndMinimize(`https://t.me/${cleanBot}?start=verify_phone`);
    }
    onClose();
  };

  const handleOpenSubUrl = (url: string) => {
    triggerHaptic('light');
    if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url);
    } else if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleRenewCustomGbChange = (val: number) => {
    const clamped = Math.min(Math.max(val, minGb), maxGb);
    setRenewCustomGb(clamped);
    setRenewTypedGb(String(clamped));
  };

  const renewPricePerDay = customVolumeSettings?.pricePerDay ?? 0;

  const handleSelectRenewCustom = () => {
    triggerHaptic('medium');
    const price =
      renewCustomQuote?.totalPrice ??
      Math.max(0, renewCustomGb * basePricePerGb + defaultDays * renewPricePerDay);
    setSelectedRenewalPkg({
      id: 'custom',
      name: t('user.shop.customPackageName')
        .replace('{gb}', formatNumber(renewCustomGb))
        .replace('{days}', formatNumber(defaultDays)),
      gbAmount: renewCustomGb,
      durationDays: defaultDays,
      price,
      ...(renewCustomQuote?.originalPrice && renewCustomQuote.originalPrice > price
        ? { originalPrice: renewCustomQuote.originalPrice }
        : {}),
    });
  };

  if (!isRenewal && !pkg) return null;
  if (isRenewal && !targetConfig) return null;

  const modalTitle = isSelectingRenewalPackage
    ? t('user.services.renewModalTitle')
    : step === 'success'
      ? isRenewal
        ? t('user.services.renewSuccessTitle')
        : t('user.shop.orderSuccess')
      : isRenewal
        ? t('user.services.renewModalTitle')
        : t('user.shop.orderModalTitle');

  const renderPromoControls = () => {
    if (!allowPromoCodes) return null;
    return (
      <div className="w-full rounded-tile border border-line bg-surface-2 p-3 flex flex-col gap-2 text-start">
        {appliedPromo ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-ok-fg font-medium min-w-0">
              <Ticket className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {appliedPromo.bonusGb > 0
                  ? t('user.shop.promoAppliedGiftGb')
                      .replace('{code}', appliedPromo.code)
                      .replace('{gb}', formatNumber(appliedPromo.bonusGb))
                  : t('user.shop.promoAppliedDiscount')
                      .replace('{code}', appliedPromo.code)
                      .replace('{amount}', formatToman(appliedPromo.discountAmount))
                      .replace('{currency}', displayCurrency)}
              </span>
            </div>
            <button
              type="button"
              disabled={isProcessing || isApplyingPromo}
              onClick={() => void handleRemovePromo()}
              className="text-[11px] font-semibold text-danger-fg hover:underline shrink-0 cursor-pointer inline-flex items-center gap-0.5"
            >
              <X className="w-3 h-3" />
              <span>{t('user.shop.promoRemove')}</span>
            </button>
          </div>
        ) : !promoOpen ? (
          <button
            type="button"
            onClick={() => {
              triggerHaptic('light');
              setPromoOpen(true);
            }}
            className="w-full flex items-center justify-between text-xs font-medium text-brand-fg cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5">
              <Ticket className="w-3.5 h-3.5 shrink-0" />
              <span>{t('user.shop.promoToggleLabel')}</span>
            </span>
            <Plus className="w-3.5 h-3.5 shrink-0" />
          </button>
        ) : (
          <form onSubmit={(e) => void handleApplyPromo(e)} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                dir="ltr"
                value={promoInput}
                onChange={(e) => {
                  setPromoInput(e.target.value);
                  if (promoError) setPromoError(null);
                }}
                placeholder={t('user.shop.promoPlaceholder')}
                aria-label={t('user.shop.promoToggleLabel')}
                className="flex-1 h-9 px-2.5 rounded-ctl border border-line bg-surface text-xs font-mono text-ink placeholder:text-ink-muted rs-focus"
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={!promoInput.trim() || isApplyingPromo}
                loading={isApplyingPromo}
                className="h-9 shrink-0"
              >
                {t('user.shop.promoApply')}
              </Button>
            </div>
            {promoError && <p className="text-[11px] text-danger-fg m-0">{promoError}</p>}
          </form>
        )}
      </div>
    );
  };

  const validRenewPresets = RENEW_CUSTOM_PRESETS.filter((v) => v >= minGb && v <= maxGb);
  const renewRangePct =
    maxGb > minGb
      ? Math.min(100, Math.max(0, ((renewCustomGb - minGb) / (maxGb - minGb)) * 100))
      : 0;
  const renewCustomDisplayPrice =
    renewCustomQuote?.totalPrice ??
    Math.max(0, renewCustomGb * basePricePerGb + defaultDays * renewPricePerDay);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={modalTitle}
      subtitle={
        isRenewal && targetConfig && !isSelectingRenewalPackage
          ? targetConfig.configUsername
          : isSelectingRenewalPackage
            ? t('user.services.renewModalSubtitle')
            : undefined
      }
      icon={
        <IconTile tone={step === 'success' ? 'ok' : 'brand'} size="sm">
          {step === 'success' ? <CheckCircle2 /> : isRenewal ? <RefreshCw /> : <ShoppingCart />}
        </IconTile>
      }
      maxWidth="md"
      closeOnBackdrop={!isProcessing}
      hideCloseButton={isProcessing}
    >
      <div className="flex flex-col gap-4 text-start pt-1">
        {/* Renewal Package Selector Step */}
        {isSelectingRenewalPackage && targetConfig && (
          <div className="flex flex-col gap-3.5">
            {/* Target Service Context */}
            <div className="p-3 rounded-tile border border-line bg-surface-2 flex items-center justify-between gap-2 flex-wrap text-xs">
              <bdi dir="ltr" className="font-mono font-semibold text-ink truncate">
                {targetConfig.configUsername}
              </bdi>
              <div className="flex items-center gap-1.5 flex-wrap">
                {renewalOptions?.config.currentRemainingGb !== null &&
                  renewalOptions?.config.currentRemainingGb !== undefined && (
                    <Badge variant="neutral" size="xs" className="tnum">
                      {t('user.shop.trafficUnit').replace(
                        '{gb}',
                        formatNumber(renewalOptions.config.currentRemainingGb)
                      )}
                    </Badge>
                  )}
                {renewalOptions?.defaultRolloverEnabled && (
                  <Badge variant="success" size="xs">
                    {t('user.services.rolloverBadge')}
                  </Badge>
                )}
              </div>
            </div>

            {isLoadingRenewalOptions ? (
              <div className="flex items-center justify-center py-8 gap-2 text-xs text-ink-muted">
                <Loader2 className="w-4 h-4 animate-spin text-brand-fg" />
                <span>{t('common.loading')}</span>
              </div>
            ) : renewalOptionsError ? (
              <div className="p-4 rounded-tile border border-danger/25 bg-danger-soft text-danger-fg text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{renewalOptionsError}</span>
              </div>
            ) : (
              <>
                {renewalOptions?.customVolumeEnabled &&
                  (renewalOptions.packages.length ?? 0) > 0 && (
                    <SegmentedControl
                      value={renewTab}
                      onChange={setRenewTab}
                      ariaLabel={t('user.services.renewSelectPackage')}
                      options={[
                        {
                          id: 'packages',
                          label: t('user.services.renewPackagesTab'),
                          icon: Package,
                          count: formatNumber(renewalOptions.packages.length),
                          tone: 'brand',
                        },
                        {
                          id: 'custom',
                          label: t('user.services.renewCustomTab'),
                          icon: Sliders,
                          tone: 'brand',
                        },
                      ]}
                    />
                  )}

                {renewTab === 'packages' ? (
                  (renewalOptions?.packages.length ?? 0) === 0 ? (
                    <div className="p-4 rounded-tile border border-line bg-surface-2 text-xs text-ink-muted text-center">
                      {t('user.shop.emptyPackages')}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pe-0.5">
                      {(renewalOptions?.packages ?? []).map((p) => {
                        const hasDiscount =
                          typeof p.originalPrice === 'number' && p.originalPrice > p.price;
                        const discountPct =
                          hasDiscount && p.originalPrice
                            ? Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100)
                            : 0;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              triggerHaptic('selection');
                              setSelectedRenewalPkg(p);
                            }}
                            className="w-full p-3 rounded-tile border border-line bg-surface-2 hover:border-brand/45 hover:bg-surface-3 text-start flex items-center justify-between gap-2.5 press rs-focus cursor-pointer transition-all"
                          >
                            <div className="flex flex-col gap-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs sm:text-sm font-semibold text-ink truncate">
                                  {p.name}
                                </span>
                                {hasDiscount && discountPct > 0 && (
                                  <Badge variant="warning" size="xs" className="tnum shrink-0">
                                    <Flame className="w-3 h-3" />
                                    <span>
                                      {t('user.shop.discountBadgeOff').replace(
                                        '{percent}',
                                        formatNumber(discountPct)
                                      )}
                                    </span>
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Badge variant="primary" size="xs">
                                  <Zap className="w-3 h-3" />
                                  <span>
                                    {t('user.shop.trafficUnit').replace(
                                      '{gb}',
                                      formatNumber(p.gbAmount)
                                    )}
                                  </span>
                                </Badge>
                                <Badge variant="neutral" size="xs">
                                  {t('user.shop.daysUnit').replace(
                                    '{days}',
                                    formatNumber(p.durationDays)
                                  )}
                                </Badge>
                              </div>
                            </div>
                            <div className="flex flex-col items-end shrink-0">
                              {hasDiscount && p.originalPrice && (
                                <span className="text-[10px] line-through text-ink-muted tnum">
                                  <bdi dir="ltr">{formatToman(p.originalPrice)}</bdi>
                                </span>
                              )}
                              <span className="text-xs sm:text-sm font-semibold tnum text-ink">
                                <bdi dir="ltr">{formatToman(p.price)}</bdi>
                              </span>
                              <span className="text-[10px] text-ink-muted">{displayCurrency}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <div className="flex flex-col gap-3">
                    {validRenewPresets.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {validRenewPresets.map((val) => {
                          const selected = renewCustomGb === val;
                          return (
                            <button
                              key={val}
                              type="button"
                              onClick={() => {
                                triggerHaptic('selection');
                                handleRenewCustomGbChange(val);
                              }}
                              className={`h-9 rounded-ctl text-xs font-medium border press rs-focus cursor-pointer tnum ${
                                selected
                                  ? 'bg-brand border-brand text-brand-ink'
                                  : 'bg-surface-2 border-line text-ink-soft hover:border-line-strong'
                              }`}
                            >
                              <bdi dir="ltr">{formatNumber(val)} GB</bdi>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="p-3 rounded-tile border border-line bg-surface-2 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-ink-soft font-medium">
                          {t('user.shop.customVolumeGbLabel')}
                        </span>
                        <div dir="ltr" className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={renewCustomGb <= minGb}
                            onClick={() => handleRenewCustomGbChange(renewCustomGb - 5)}
                            className="w-8 h-8 rounded-ctl border border-line-strong bg-surface flex items-center justify-center disabled:opacity-40 cursor-pointer"
                            aria-label={t('user.shop.decreaseGb')}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            value={renewTypedGb}
                            onChange={(e) => {
                              setRenewTypedGb(e.target.value);
                              const parsed = parseInt(normalizeInputDigits(e.target.value), 10);
                              if (!isNaN(parsed)) {
                                setRenewCustomGb(Math.min(Math.max(parsed, minGb), maxGb));
                              }
                            }}
                            onBlur={() => handleRenewCustomGbChange(renewCustomGb)}
                            aria-label={t('user.shop.customGbInputLabel')}
                            className="w-12 text-center tnum font-semibold text-sm text-brand-fg bg-transparent border-b border-line-strong focus:border-brand focus:outline-hidden"
                          />
                          <button
                            type="button"
                            disabled={renewCustomGb >= maxGb}
                            onClick={() => handleRenewCustomGbChange(renewCustomGb + 5)}
                            className="w-8 h-8 rounded-ctl border border-line-strong bg-surface flex items-center justify-center disabled:opacity-40 cursor-pointer"
                            aria-label={t('user.shop.increaseGb')}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={minGb}
                        max={maxGb}
                        step={1}
                        value={renewCustomGb}
                        onChange={(e) => handleRenewCustomGbChange(Number(e.target.value))}
                        aria-label={t('user.shop.customGbInputLabel')}
                        style={{ '--rs-range-pct': `${renewRangePct}%` } as React.CSSProperties}
                        className="rs-range w-full cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-ink-muted">
                        {t('user.shop.daysUnit').replace('{days}', formatNumber(defaultDays))}
                      </span>
                      <div className="flex items-baseline gap-1 tnum">
                        {isFetchingRenewQuote && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-muted self-center" />
                        )}
                        <bdi dir="ltr" className="text-base font-semibold text-ink">
                          {formatToman(renewCustomDisplayPrice)}
                        </bdi>
                        <span className="text-ink-muted">{displayCurrency}</span>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      block
                      onClick={handleSelectRenewCustom}
                    >
                      <Zap className="w-4 h-4 shrink-0" />
                      <span>{t('user.shop.selectPlan')}</span>
                    </Button>
                  </div>
                )}
              </>
            )}

            <Button type="button" variant="secondary" size="md" block onClick={handleClose}>
              {t('common.cancel')}
            </Button>
          </div>
        )}

        {/* Step 1: Loading Skeleton */}
        {!isSelectingRenewalPackage && step === 'loading' && (
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
        {!isSelectingRenewalPackage && step === 'review' && checkout && (
          <>
            {/* Expiry countdown banner */}
            <div className="flex items-center justify-between px-0.5 gap-2">
              {isRenewal && !pkg ? (
                <button
                  type="button"
                  onClick={handleBackToRenewalSelector}
                  disabled={isProcessing}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-fg hover:underline cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
                  <span>{t('user.services.renewSelectPackage')}</span>
                </button>
              ) : (
                <span className="text-xs text-ink-muted">{t('user.shop.orderModalTitle')}</span>
              )}
              <div className="flex items-center gap-1.5 text-xs text-warn-fg tnum font-semibold px-2.5 py-1 rounded-ctl bg-warn-soft border border-warn/25 shrink-0">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {t('user.shop.expiresIn').replace('{time}', formatCountdown(remainingSeconds))}
                </span>
              </div>
            </div>

            {/* Server-confirmed package card */}
            <div className="p-4 rounded-tile border bg-surface-2 border-line flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm sm:text-base text-ink truncate">
                  {checkout.name}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="primary" size="xs">
                    {t('user.shop.trafficUnit').replace(
                      '{gb}',
                      formatNumber(checkout.finalGb ?? checkout.gb)
                    )}
                  </Badge>
                  {(checkout.bonusGb ?? 0) > 0 && (
                    <Badge variant="success" size="xs" className="tnum">
                      +{formatNumber(checkout.bonusGb!)} GB
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-ink-muted pt-2 border-t border-line">
                <span>
                  {t('user.shop.daysUnit').replace('{days}', formatNumber(checkout.days))}
                </span>
                <span className="font-semibold text-sm text-brand-fg tnum">
                  {formatToman(checkout.price)} {displayCurrency}
                </span>
              </div>

              {/* Price Breakdown when discounts or bonus GB apply */}
              {((checkout.discountAmount ?? 0) > 0 ||
                (checkout.groupDiscountAmount ?? 0) > 0 ||
                (checkout.promoDiscountAmount ?? 0) > 0 ||
                (checkout.bonusGb ?? 0) > 0) && (
                <div className="pt-2 border-t border-line flex flex-col gap-1 text-[11px] tnum">
                  {checkout.originalPrice && checkout.originalPrice > checkout.price && (
                    <div className="flex items-center justify-between text-ink-muted">
                      <span>{t('user.shop.originalPriceLabel')}</span>
                      <span className="line-through">
                        {formatToman(checkout.originalPrice)} {displayCurrency}
                      </span>
                    </div>
                  )}
                  {(checkout.groupDiscountAmount ?? 0) > 0 && (
                    <div className="flex items-center justify-between text-brand-fg">
                      <span className="inline-flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        <span>
                          {t('user.shop.groupDiscountLabel')}
                          {(checkout.groupDiscountPercent ?? 0) > 0
                            ? ` (${formatNumber(checkout.groupDiscountPercent!)}%)`
                            : ''}
                        </span>
                      </span>
                      <span>
                        -{formatToman(checkout.groupDiscountAmount!)} {displayCurrency}
                      </span>
                    </div>
                  )}
                  {(checkout.catalogDiscountAmount ??
                    Math.max(
                      0,
                      (checkout.discountAmount ?? 0) - (checkout.groupDiscountAmount ?? 0)
                    )) > 0 && (
                    <div className="flex items-center justify-between text-warn-fg">
                      <span className="inline-flex items-center gap-1">
                        <Flame className="w-3 h-3" />
                        <span>
                          {checkout.activeDiscountTitle || t('user.shop.catalogDiscountLabel')}
                        </span>
                      </span>
                      <span>
                        -
                        {formatToman(
                          checkout.catalogDiscountAmount ??
                            Math.max(
                              0,
                              (checkout.discountAmount ?? 0) - (checkout.groupDiscountAmount ?? 0)
                            )
                        )}{' '}
                        {displayCurrency}
                      </span>
                    </div>
                  )}
                  {(checkout.promoDiscountAmount ?? 0) > 0 && (
                    <div className="flex items-center justify-between text-ok-fg">
                      <span>{t('user.shop.promoDiscountLabel')}</span>
                      <span>
                        -{formatToman(checkout.promoDiscountAmount!)} {displayCurrency}
                      </span>
                    </div>
                  )}
                  {(checkout.bonusGb ?? 0) > 0 && (
                    <div className="flex items-center justify-between text-ok-fg">
                      <span>{t('user.shop.bonusGbLabel')}</span>
                      <span>
                        +{formatNumber(checkout.bonusGb!)}{' '}
                        {t('user.shop.trafficUnit').replace('{gb}', '').trim()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Renewal Rollover Preview Card */}
            {isRenewal && checkout.rolloverPreview?.enabled && (
              <div className="p-3 rounded-tile border border-ok/25 bg-ok-soft/60 flex flex-col gap-1.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-ok-fg">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('user.services.rolloverPreviewTitle')}</span>
                </div>
                <p className="text-[11px] text-ink-soft m-0">{t('user.services.rolloverNotice')}</p>
                {(typeof checkout.rolloverPreview.projectedTotalGb === 'number' ||
                  typeof checkout.rolloverPreview.projectedTotalDays === 'number') && (
                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-ok/20 text-[11px] tnum">
                    {typeof checkout.rolloverPreview.projectedTotalGb === 'number' && (
                      <span className="text-ink">
                        {t('user.services.rolloverTraffic')}:{' '}
                        <strong>
                          {t('user.shop.trafficUnit').replace(
                            '{gb}',
                            formatNumber(checkout.rolloverPreview.projectedTotalGb)
                          )}
                        </strong>
                      </span>
                    )}
                    {typeof checkout.rolloverPreview.projectedTotalDays === 'number' && (
                      <span className="text-ink">
                        {t('user.services.rolloverDuration')}:{' '}
                        <strong>
                          {t('user.shop.daysUnit').replace(
                            '{days}',
                            formatNumber(checkout.rolloverPreview.projectedTotalDays)
                          )}
                        </strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* On-Hold First Connection Notice (Purchase only) */}
            {!isRenewal && checkout.startOnFirstUse && (
              <div className="p-2.5 rounded-tile border border-brand/25 bg-brand-soft/50 flex items-center gap-2 text-xs text-ink-soft">
                <Clock className="w-4 h-4 text-brand-fg shrink-0" />
                <span>{t('user.shop.onHoldInfo')}</span>
              </div>
            )}

            {/* Optional Custom Service Name Input (Purchase only) */}
            {!isRenewal && customServiceNameEnabled && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink-soft">
                  {t('user.shop.customNameLabel')}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={customNameInput}
                  onChange={(e) => setCustomNameInput(e.target.value)}
                  placeholder={t('user.shop.customNamePlaceholder')}
                  className={`h-10 px-3 rounded-ctl border bg-surface-2 text-xs font-mono text-ink placeholder:text-ink-muted rs-focus ${
                    isCustomNameInvalid ? 'border-danger' : 'border-line'
                  }`}
                />
                <span
                  className={`text-[11px] ${
                    isCustomNameInvalid ? 'text-danger-fg' : 'text-ink-muted'
                  }`}
                >
                  {isCustomNameInvalid
                    ? t('user.shop.customNameInvalid')
                    : t('user.shop.customNameHint')}
                </span>
              </div>
            )}

            {/* Collapsible Promo Code Input */}
            {renderPromoControls()}

            {/* Feature points (Purchase only) */}
            {!isRenewal && (
              <div className="flex flex-col gap-1.5 px-0.5 text-[11px] text-ink-muted">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-ok-fg shrink-0" />
                  <span>{t('user.shop.fastConnectionFeature')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-ok-fg shrink-0" />
                  <span>{t('user.shop.allPlatformsFeature')}</span>
                </div>
              </div>
            )}

            {/* Wallet Balance Status + Balance / Credit After Payment */}
            {(() => {
              const effCreditLimit = checkout.creditLimit ?? creditLimit;
              const projectedAfter = checkout.availableBalance - checkout.price;
              const usesCredit = projectedAfter < 0;
              const remainingCreditAfter =
                effCreditLimit > 0 ? Math.max(0, projectedAfter + effCreditLimit) : 0;
              return (
                <div
                  className={`p-3 rounded-tile border flex flex-col gap-1.5 text-xs ${
                    usesCredit
                      ? 'bg-warn-soft border-warn/30 text-warn-fg'
                      : 'bg-ok-soft border-ok/25 text-ok-fg'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 shrink-0" />
                      <span>{t('user.dashboard.availableBalance')}</span>
                    </div>
                    <bdi dir="ltr" className="tnum font-semibold">
                      {formatToman(checkout.availableBalance)} {displayCurrency}
                    </bdi>
                  </div>
                  {effCreditLimit > 0 && (
                    <div
                      className={`flex items-center justify-between text-[11px] opacity-90 pt-1 border-t ${
                        usesCredit ? 'border-warn/25' : 'border-ok/20'
                      }`}
                    >
                      <span>{t('user.wallet.creditLimitLabel')}</span>
                      <bdi dir="ltr" className="tnum font-semibold">
                        {formatToman(effCreditLimit)} {displayCurrency}
                      </bdi>
                    </div>
                  )}
                  <div
                    className={`flex items-center justify-between text-[11px] opacity-90 pt-1 border-t ${
                      usesCredit ? 'border-warn/25' : 'border-ok/20'
                    }`}
                  >
                    <span>
                      {usesCredit
                        ? t('user.shop.projectedDebtLabel')
                        : t('user.shop.balanceAfterLabel')}
                    </span>
                    <bdi dir="ltr" className="tnum font-semibold">
                      {formatToman(usesCredit ? Math.abs(projectedAfter) : projectedAfter)}{' '}
                      {displayCurrency}
                    </bdi>
                  </div>
                  {usesCredit && effCreditLimit > 0 && (
                    <div className="flex items-center justify-between text-[11px] opacity-85 pt-1 border-t border-warn/25">
                      <span>{t('user.shop.remainingCreditLabel')}</span>
                      <bdi dir="ltr" className="tnum font-semibold">
                        {formatToman(remainingCreditAfter)} {displayCurrency}
                      </bdi>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 mt-1">
              <Button
                type="button"
                variant="primary"
                size="md"
                block
                disabled={isProcessing || isCustomNameInvalid}
                loading={isProcessing}
                onClick={() => void handleConfirmCheckout()}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{t('user.shop.confirmOrder')}</span>
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="md"
                block
                disabled={isProcessing}
                onClick={handleClose}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </>
        )}

        {/* Step 3: Insufficient Balance */}
        {!isSelectingRenewalPackage && step === 'insufficient_balance' && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <IconTile tone="warn" size="lg">
              <AlertCircle />
            </IconTile>

            <div className="flex flex-col gap-1">
              <h3 className="text-sm sm:text-base font-semibold text-ink m-0">
                {t('user.shop.insufficientBalance')}
              </h3>
              <p className="text-xs text-ink-muted m-0">
                {t('user.shop.chargeNeeded')
                  .replace('{amount}', formatToman(deficitAmount))
                  .replace('{currency}', displayCurrency)}
              </p>
            </div>

            {/* Breakdown card */}
            <div className="w-full p-3.5 rounded-tile border flex flex-col gap-2 text-xs text-start bg-surface-2 border-line">
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">{t('common.amount')}:</span>
                <span className="tnum font-semibold">
                  {formatToman(shortfallPrice ?? checkout?.price ?? effectivePkg?.price ?? 0)}{' '}
                  {displayCurrency}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">{t('user.dashboard.availableBalance')}:</span>
                <bdi dir="ltr" className="tnum font-semibold">
                  {formatToman(checkout?.availableBalance ?? availableBalance)} {displayCurrency}
                </bdi>
              </div>
              {(shortfallCreditLimit ?? creditLimit) > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">{t('user.wallet.creditLimitLabel')}:</span>
                    <bdi dir="ltr" className="tnum font-semibold">
                      {formatToman(shortfallCreditLimit ?? creditLimit)} {displayCurrency}
                    </bdi>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">{t('user.wallet.purchasingPowerLabel')}:</span>
                    <bdi dir="ltr" className="tnum font-semibold">
                      {formatToman(
                        shortfallPurchasingPower ??
                          purchasingPower ??
                          Math.max(0, availableBalance + creditLimit)
                      )}{' '}
                      {displayCurrency}
                    </bdi>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-line text-danger-fg font-semibold">
                <span>{t('user.shop.deficitLabel')}:</span>
                <span className="tnum font-semibold">
                  {formatToman(deficitAmount)} {displayCurrency}
                </span>
              </div>
            </div>

            {/* Promo code input right on shortfall screen so discount can cover small gaps */}
            {renderPromoControls()}

            <div className="w-full flex flex-col gap-2 mt-1">
              <Button type="button" variant="primary" size="md" block onClick={handleGoToWallet}>
                <Wallet className="w-4 h-4" />
                <span>{t('user.shop.goToWallet')}</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </Button>

              {isRenewal && !pkg && (
                <Button
                  type="button"
                  variant="tonal"
                  size="md"
                  block
                  onClick={handleBackToRenewalSelector}
                >
                  {t('user.services.renewSelectPackage')}
                </Button>
              )}

              <Button type="button" variant="secondary" size="md" block onClick={handleClose}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3b: Phone Verification Required */}
        {!isSelectingRenewalPackage && step === 'phone_required' && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <IconTile tone="brand" size="lg">
              <Smartphone />
            </IconTile>

            <div className="flex flex-col gap-1.5 max-w-sm">
              <h3 className="text-sm sm:text-base font-semibold text-ink m-0">
                {t('user.shop.phoneVerifyRequiredTitle')}
              </h3>
              <p className="text-xs text-ink-muted m-0 leading-relaxed">
                {t('user.shop.phoneVerifyRequiredDesc')}
              </p>
            </div>

            <div className="w-full flex flex-col gap-2 mt-1">
              {phoneVerify.supportsNativeRequestContact ? (
                <>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    block
                    loading={phoneVerify.isVerifying}
                    disabled={phoneVerify.isVerifying}
                    onClick={phoneVerify.startVerification}
                  >
                    <Smartphone className="w-4 h-4 shrink-0" />
                    <span>
                      {phoneVerify.isVerifying
                        ? t('user.shop.verifyPhoneWaiting')
                        : t('user.shop.verifyPhoneNative')}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="tonal"
                    size="md"
                    block
                    disabled={phoneVerify.isVerifying}
                    onClick={handleOpenPhoneVerifyInBot}
                  >
                    <span>{t('user.shop.verifyPhoneInBot')}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  block
                  onClick={handleOpenPhoneVerifyInBot}
                >
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <span>{t('user.shop.verifyPhoneInBot')}</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </Button>
              )}

              <Button type="button" variant="secondary" size="md" block onClick={handleClose}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Checkout Expired */}
        {!isSelectingRenewalPackage && step === 'expired' && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <IconTile tone="warn" size="lg">
              <Clock />
            </IconTile>

            <div className="flex flex-col gap-1">
              <h3 className="text-sm sm:text-base font-semibold text-ink m-0">
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
        {!isSelectingRenewalPackage && step === 'verifying' && (
          <div className="flex flex-col items-center text-center gap-4 py-3">
            <IconTile tone="brand" size="lg">
              <Loader2 className="animate-spin" />
            </IconTile>

            <div className="flex flex-col gap-1.5 max-w-sm">
              <h3 className="text-sm sm:text-base font-semibold text-ink m-0">
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
        {!isSelectingRenewalPackage && (step === 'creation_error' || step === 'confirm_error') && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <IconTile tone="danger" size="lg">
              <AlertCircle />
            </IconTile>

            <div className="flex flex-col gap-1 max-w-xs">
              <h3 className="text-sm sm:text-base font-semibold text-ink m-0">
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
        {!isSelectingRenewalPackage && step === 'success' && successData && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <IconTile tone="ok" size="lg" className="anim-pop">
              <CheckCircle2 />
            </IconTile>

            <div className="flex flex-col gap-1">
              <h3 className="text-sm sm:text-base font-semibold text-ink m-0">
                {isRenewal ? t('user.services.renewSuccessTitle') : t('user.shop.orderSuccess')}
              </h3>
              {isRenewal && (
                <p className="text-xs text-ink-muted m-0">{t('user.services.renewSuccessDesc')}</p>
              )}
            </div>

            {/* Service Username & Summary */}
            <div className="w-full p-3 rounded-tile border flex flex-col gap-2 text-xs bg-surface-2 border-line text-start">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-muted">{t('user.shop.configUsername')}:</span>
                <bdi dir="ltr" className="font-mono font-semibold text-ink">
                  {successData.configUsername}
                </bdi>
              </div>
              {typeof successData.availableBalanceAfter === 'number' && (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-line tnum">
                  <span className="text-ink-muted">
                    {successData.availableBalanceAfter < 0
                      ? t('user.shop.projectedDebtLabel')
                      : t('user.shop.balanceAfterLabel')}
                    :
                  </span>
                  <bdi
                    dir="ltr"
                    className={`font-semibold ${
                      successData.availableBalanceAfter < 0 ? 'text-warn-fg' : 'text-ink'
                    }`}
                  >
                    {formatToman(
                      successData.availableBalanceAfter < 0
                        ? Math.abs(successData.availableBalanceAfter)
                        : successData.availableBalanceAfter
                    )}{' '}
                    {displayCurrency}
                  </bdi>
                </div>
              )}
            </div>

            {/* On-Hold Info on Success (Purchase only) */}
            {!isRenewal && successData.startOnFirstUse && (
              <div className="w-full p-2.5 rounded-tile border border-brand/25 bg-brand-soft/50 flex items-center gap-2 text-xs text-ink-soft text-start">
                <Clock className="w-4 h-4 text-brand-fg shrink-0" />
                <span>{t('user.shop.onHoldInfo')}</span>
              </div>
            )}

            {/* Subscription URL with Copy + Open Link (Purchase only) */}
            {!isRenewal && successData.subUrl && (
              <div className="w-full flex flex-col gap-1.5 text-start">
                <span className="text-xs text-ink-muted font-medium">{t('user.shop.subUrl')}</span>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    dir="ltr"
                    value={successData.subUrl}
                    aria-label={t('user.shop.subUrl')}
                    className="flex-1 h-10 px-3 rounded-ctl border text-xs font-mono bg-surface-2 border-line select-all truncate text-ink-soft rs-focus"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant={isCopied('checkout-sub-url') ? 'success' : 'primary'}
                    onClick={async () => {
                      triggerHaptic('light');
                      const ok = await copy(successData.subUrl!, 'checkout-sub-url');
                      if (ok) {
                        notify(t('user.services.linkCopied'), 'success');
                      }
                    }}
                    className="h-10 shrink-0"
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
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="tonal"
                  block
                  onClick={() => handleOpenSubUrl(successData.subUrl!)}
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('user.services.openLink')}</span>
                </Button>
                <div className="pt-2">
                  <SmartConnectButtons
                    subUrl={successData.subUrl}
                    configUsername={successData.configUsername}
                  />
                </div>
              </div>
            )}

            {/* High-contrast white QR Code frame (Purchase only) */}
            {!isRenewal && qrSrc ? (
              <div className="bg-white p-3 rounded-card border border-line shadow-[var(--shadow-card)] flex items-center justify-center my-1 anim-pop">
                <img
                  src={qrSrc}
                  alt={t('user.services.qrTitle')}
                  className="w-[160px] h-[160px] sm:w-[180px] sm:h-[180px] select-none pointer-events-none"
                />
              </div>
            ) : !isRenewal && successData.subUrl ? (
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
      <ForcedJoinModal
        isOpen={Boolean(forcedJoinChannels)}
        channels={forcedJoinChannels ?? []}
        action="purchase"
        onClose={() => setForcedJoinChannels(null)}
        onVerified={() => {
          setForcedJoinChannels(null);
          void createCheckoutSession();
        }}
        onNotify={(msg, type) => notify(msg, type ?? 'success')}
      />
    </Modal>
  );
};
