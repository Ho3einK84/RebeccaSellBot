import React, { useEffect, useRef, useState } from 'react';
import {
  Wallet,
  CreditCard,
  Copy,
  Check,
  Send,
  History,
  ShieldCheck,
  ExternalLink,
  Gift,
  AlertCircle,
  X,
  Upload,
  Receipt,
  ArrowLeftRight,
  ArrowRight,
  FileImage,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import {
  openTelegramLinkAndMinimize,
  minimizeOrCloseWebApp,
} from '@/shared/lib/telegramNavigation.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { TransactionItem } from '@/features/user-portal/components/TransactionItem.js';
import { WalletTransferModal } from '@/features/user-portal/components/WalletTransferModal.js';
import { formatCardNumberSpaced, normalizeInputDigits } from '@/shared/lib/formatters.js';
import { useUserReceipts, useUserTransactions } from '../hooks/useUserPortalData.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { Pagination } from '@/shared/components/ui/Pagination.js';
import { SegmentedControl } from '@/shared/components/ui/SegmentedControl.js';
import { SkeletonList } from '@/shared/components/ui/Skeleton.js';
import type {
  UserPortalProfile,
  UserPortalSettings,
  UserTransactionRecord,
  PendingReceiptInfo,
  WalletDeficitContext,
  PrepareTopupResponse,
  TransactionFilterType,
} from '@/shared/types/userPortal.js';

interface WalletTabProps {
  profile: UserPortalProfile | null;
  settings: UserPortalSettings | null;
  transactions: UserTransactionRecord[];
  pendingReceipt?: PendingReceiptInfo | null;
  deficitContext?: WalletDeficitContext | null;
  onClearDeficit?: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const TOPUP_PRESETS = [50_000, 100_000, 200_000, 500_000];

/**
 * Compresses large receipt images client-side via Canvas (max 1600px, JPEG 0.84)
 * so uploads stay crisp, under 5 MB, and fast on mobile connections.
 */
async function encodeReceiptFile(file: File): Promise<{ base64: string; name: string }> {
  if (file.type === 'application/pdf') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ base64: String(reader.result || ''), name: file.name });
      reader.onerror = () => reject(new Error('READ_FAILED'));
      reader.readAsDataURL(file);
    });
  }

  // Compress images via Canvas when supported
  if (typeof document !== 'undefined' && file.type.startsWith('image/')) {
    try {
      const objectUrl = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('IMG_DECODE_FAILED'));
          el.src = objectUrl;
        });
        const maxDim = 1600;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
          return { base64: dataUrl, name: file.name.replace(/\.[^.]+$/, '.jpg') };
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      // Fallback to raw FileReader below
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ base64: String(reader.result || ''), name: file.name });
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.readAsDataURL(file);
  });
}

export const WalletTab: React.FC<WalletTabProps> = ({
  profile,
  settings,
  transactions,
  pendingReceipt,
  deficitContext,
  onClearDeficit,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { formatToman, formatNumber, formatIsoDate } = useFormatters();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const [historyMode, setHistoryMode] = useState<'transactions' | 'receipts'>('transactions');
  const [txFilter, setTxFilter] = useState<TransactionFilterType>('all');
  const [page, setPage] = useState<number>(1);
  const [receiptsPage, setReceiptsPage] = useState<number>(1);

  // Native Top-Up Wizard state
  const [amountInput, setAmountInput] = useState<string>('');
  const [preparedTopup, setPreparedTopup] = useState<PrepareTopupResponse | null>(null);
  const [isPreparingTopup, setIsPreparingTopup] = useState(false);
  const [topupError, setTopupError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ name: string; base64: string } | null>(null);
  const [isSubmittingReceipt, setIsSubmittingReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Gift code & Transfer state
  const [giftCode, setGiftCode] = useState('');
  const [isRedeemingGift, setIsRedeemingGift] = useState(false);
  const [giftFeedback, setGiftFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

  const currency = settings?.currency || t('common.currency');
  const balance = profile?.balance ?? 0;
  const availableBalance = profile?.availableBalance ?? 0;
  const cardNumber = settings?.cardNumber || '';
  const cardHolder = settings?.cardHolder || '';
  const minAmount = settings?.topupMinAmount ?? 10_000;
  const maxAmount = settings?.topupMaxAmount ?? 10_000_000;
  const allCardsCapReached = Boolean(settings?.allCardsCapReached);
  const canTransferBalance = settings?.walletTransferEnabled !== false;
  const transferMinAmount = settings?.walletTransferMinAmount ?? 5_000;

  // Auto-fill deposit input when navigated here with a checkout shortfall
  useEffect(() => {
    if (deficitContext && deficitContext.amount > 0) {
      const clamped = Math.min(Math.max(deficitContext.amount, minAmount), maxAmount);
      setAmountInput(String(clamped));
      setPreparedTopup(null);
    }
  }, [deficitContext, minAmount, maxAmount]);

  const { data: txQueryData, isFetching: isFetchingTx } = useUserTransactions(page, 10, txFilter);
  const isLoadingTxPage = (page > 1 || txFilter !== 'all') && isFetchingTx && !txQueryData;
  const currentTransactions =
    txQueryData?.transactions ?? (page === 1 && txFilter === 'all' ? transactions : []);
  const totalPages = txQueryData?.totalPages ?? 1;

  const { data: receiptsQueryData, isFetching: isFetchingReceipts } = useUserReceipts(
    receiptsPage,
    10,
    historyMode === 'receipts'
  );
  const receiptsList = receiptsQueryData?.receipts ?? [];
  const receiptsTotalPages = receiptsQueryData?.totalPages ?? 1;

  const parsedAmount = parseInt(normalizeInputDigits(amountInput).replace(/[^\d]/g, ''), 10) || 0;
  const isAmountValid = parsedAmount >= minAmount && parsedAmount <= maxAmount;
  const validPresets = TOPUP_PRESETS.filter((v) => v >= minAmount && v <= maxAmount);

  const handleCopyCard = async (numToCopy?: string) => {
    const target = numToCopy || cardNumber;
    if (!target) return;
    triggerHaptic('light');
    const ok = await copy(target.replace(/\s+/g, ''), 'bank-card');
    if (ok) {
      onNotify(t('user.wallet.cardCopied'), 'success');
    }
  };

  const handleCopyDeficit = async () => {
    if (!deficitContext || deficitContext.amount <= 0) return;
    triggerHaptic('light');
    const ok = await copy(String(deficitContext.amount), 'deficit-amount');
    if (ok) {
      onNotify(t('user.wallet.deficitCopied'), 'success');
    }
  };

  const handleCopyPayableAmount = async () => {
    if (!preparedTopup) return;
    triggerHaptic('light');
    const ok = await copy(String(preparedTopup.payableAmount), 'payable-amount');
    if (ok) {
      onNotify(t('user.wallet.payableAmountCopied'), 'success');
    }
  };

  const handleOpenBotForReceipt = (payload?: string) => {
    triggerHaptic('medium');
    const finalPayload =
      payload ??
      (parsedAmount >= minAmount
        ? `topup_${parsedAmount}`
        : deficitContext && deficitContext.amount > 0
          ? `topup_${deficitContext.amount}`
          : 'receipt');
    const botUser = (settings?.botUsername || '').replace(/^@/, '').trim();
    if (botUser) {
      const url = `https://t.me/${botUser}?start=${finalPayload}`;
      openTelegramLinkAndMinimize(url);
      return;
    }
    minimizeOrCloseWebApp();
  };

  const handlePrepareTopup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAmountValid || isPreparingTopup) return;
    setIsPreparingTopup(true);
    setTopupError(null);
    triggerHaptic('medium');

    try {
      const res = await api.prepareUserTopup(parsedAmount);
      setPreparedTopup(res);
      setSelectedFile(null);
      triggerHaptic('success');
    } catch (err: unknown) {
      triggerHaptic('error');
      let msg = t('common.error');
      if (err instanceof ApiClientError) {
        if (err.code === 'ALL_CARDS_CAP_REACHED') msg = t('user.wallet.allCardsCapDesc');
        else if (err.code === 'NO_BANK_CARD') msg = t('user.wallet.cardTopupUnavailableDesc');
        else if (err.code === 'PENDING_RECEIPT_EXISTS') {
          msg = t('user.wallet.pendingReceiptSubtitle');
          void queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
        } else if (err.code === 'INVALID_TOPUP_AMOUNT') msg = t('common.invalidAmount');
      }
      setTopupError(msg);
    } finally {
      setIsPreparingTopup(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTopupError(null);
    if (file.size > 15 * 1024 * 1024) {
      setTopupError(t('user.wallet.uploadReceiptHint'));
      return;
    }
    try {
      const encoded = await encodeReceiptFile(file);
      setSelectedFile(encoded);
      triggerHaptic('selection');
    } catch {
      setTopupError(t('common.error'));
    }
  };

  const handleSubmitReceipt = async () => {
    if (!preparedTopup || !selectedFile || isSubmittingReceipt) return;
    setIsSubmittingReceipt(true);
    setTopupError(null);
    triggerHaptic('medium');

    try {
      const res = await api.submitUserTopupReceipt({
        amount: preparedTopup.payableAmount,
        cardId: preparedTopup.card.id,
        cardNumber: preparedTopup.card.cardNumber,
        fileBase64: selectedFile.base64,
        fileName: selectedFile.name,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
      await queryClient.invalidateQueries({ queryKey: ['user', 'receipts'] });
      triggerHaptic('success');
      onNotify(
        t('user.wallet.receiptSubmittedSuccess').replace('{shortId}', res.shortId),
        'success'
      );
      setPreparedTopup(null);
      setSelectedFile(null);
      setAmountInput('');
      onClearDeficit?.();
    } catch (err: unknown) {
      triggerHaptic('error');
      let msg = t('common.error');
      if (err instanceof ApiClientError) {
        if (err.code === 'DUPLICATE_RECEIPT') msg = t('user.wallet.receiptDuplicateError');
        else if (err.code === 'PENDING_RECEIPT_EXISTS') {
          msg = t('user.wallet.pendingReceiptSubtitle');
          void queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
        } else if (err.message) msg = err.message;
      }
      setTopupError(msg);
    } finally {
      setIsSubmittingReceipt(false);
    }
  };

  const handleRedeemGiftCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = giftCode.trim();
    if (!trimmed || isRedeemingGift) return;
    setIsRedeemingGift(true);
    setGiftFeedback(null);
    triggerHaptic('medium');
    try {
      await api.redeemGiftPromo(trimmed);
      setGiftCode('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
      void queryClient.invalidateQueries({ queryKey: ['user', 'transactions'] });
      triggerHaptic('success');
      const msg = t('user.wallet.giftCodeSuccess');
      setGiftFeedback({ type: 'success', message: msg });
      onNotify(msg, 'success');
    } catch (err: unknown) {
      triggerHaptic('error');
      let msg = t('user.shop.promoInvalid');
      if (err instanceof ApiClientError && err.code === 'PROMO_PURCHASE_ONLY') {
        msg = t('user.wallet.giftCodeNotCredit');
      }
      setGiftFeedback({ type: 'error', message: msg });
    } finally {
      setIsRedeemingGift(false);
    }
  };

  const activeCard = preparedTopup?.card ?? {
    id: settings?.cardId || '',
    cardNumber,
    cardHolder,
    bankName: settings?.bankName || '',
  };

  return (
    <div className="w-full flex flex-col gap-5 pb-6">
      {/* Top Wallet Summary + P2P Transfer CTA */}
      <Card padding="lg" className="flex items-center justify-between gap-3 flex-wrap text-start">
        <div className="flex items-center gap-3.5">
          <IconTile tone="brand" size="lg">
            <Wallet />
          </IconTile>
          <div className="flex flex-col">
            <span className="text-xs text-ink-muted">{t('user.wallet.currentBalance')}</span>
            <div className="flex items-baseline gap-2 mt-1">
              <bdi
                dir="ltr"
                className="text-2xl sm:text-3xl tnum font-bold tracking-tight leading-none text-ink"
              >
                {formatToman(availableBalance)}
              </bdi>
              <span className="text-xs text-ink-muted font-medium">{currency}</span>
            </div>
            {profile?.reservedBalance && profile.reservedBalance > 0 ? (
              <div className="flex items-center gap-2 text-[11px] text-ink-muted tnum mt-0.5">
                <span>{t('user.wallet.totalLabel').replace('{amount}', formatToman(balance))}</span>
                <span className="text-warn-fg font-medium">
                  {t('user.wallet.reservedLabel').replace(
                    '{amount}',
                    formatToman(profile.reservedBalance)
                  )}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {canTransferBalance && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              triggerHaptic('selection');
              setIsTransferModalOpen(true);
            }}
            className="shrink-0"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-brand-fg shrink-0" />
            <span>{t('user.wallet.transferBalanceButton')}</span>
          </Button>
        )}
      </Card>

      {/* Deficit Context Banner from Checkout */}
      {deficitContext && deficitContext.amount > 0 && (
        <Card tone="warn" padding="md" className="flex flex-col gap-2.5 text-start">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 text-warn-fg shrink-0" />
              <h3 className="text-xs sm:text-sm font-semibold text-ink m-0 truncate">
                {t('user.wallet.deficitBannerTitle')}
              </h3>
            </div>
            {onClearDeficit && (
              <button
                type="button"
                onClick={onClearDeficit}
                className="w-7 h-7 rounded-ctl inline-flex items-center justify-center text-ink-muted hover:text-ink cursor-pointer shrink-0"
                aria-label={t('common.close')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <p className="text-xs text-ink-soft m-0 leading-relaxed tnum">
            {t('user.wallet.deficitBannerDesc')
              .replace('{item}', deficitContext.itemName)
              .replace('{amount}', formatToman(deficitContext.amount))
              .replace('{currency}', currency)}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={isCopied('deficit-amount') ? 'success' : 'secondary'}
              onClick={() => void handleCopyDeficit()}
            >
              {isCopied('deficit-amount') ? (
                <>
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('user.wallet.deficitCopied')}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('user.wallet.copyDeficit')}</span>
                </>
              )}
            </Button>
          </div>
        </Card>
      )}

      {/* Pending Receipt Status Banner */}
      {pendingReceipt && (
        <Card tone="warn" padding="md" className="flex flex-col gap-3 text-start">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-warn shrink-0" aria-hidden="true" />
              <h3 className="text-xs sm:text-sm font-semibold text-ink m-0">
                {t('user.wallet.pendingReceiptTitle')}
              </h3>
            </div>

            <Badge variant="warning" size="xs">
              {t('user.wallet.pendingReceiptStatusLabel')}
            </Badge>
          </div>

          <p className="text-xs leading-relaxed text-ink-soft m-0">
            {t('user.wallet.pendingReceiptSubtitle')}
          </p>

          <div className="rounded-tile border border-warn/25 bg-surface p-3 flex items-center justify-between gap-3 text-xs tnum">
            <div className="flex flex-col">
              <span className="text-[11px] text-ink-muted">
                {t('user.wallet.pendingReceiptAmountLabel')}
              </span>
              <span className="font-semibold text-sm text-ink mt-0.5">
                <bdi dir="ltr">{formatToman(pendingReceipt.amount)}</bdi> {currency}
              </span>
            </div>

            <div className="flex flex-col items-end">
              <span className="text-[11px] text-ink-muted">
                {t('user.wallet.pendingReceiptTrackingId')}
              </span>
              <button
                type="button"
                onClick={async () => {
                  triggerHaptic('light');
                  const ok = await copy(pendingReceipt.id, 'receipt-id');
                  if (ok) {
                    onNotify(t('common.copied'), 'success');
                  }
                }}
                className="h-9 inline-flex items-center gap-1.5 text-xs font-mono text-brand-fg hover:underline cursor-pointer px-1.5 rounded-ctl rs-focus"
                aria-label={t('common.copy')}
              >
                <bdi dir="ltr">
                  {pendingReceipt.id.length > 15
                    ? `${pendingReceipt.id.slice(0, 8)}...${pendingReceipt.id.slice(-4)}`
                    : pendingReceipt.id}
                </bdi>
                {isCopied('receipt-id') ? (
                  <Check className="w-3.5 h-3.5 text-ok-fg shrink-0 anim-pop" />
                ) : (
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                )}
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Main Split: Native Card Topup & Gift Code vs Ledger / Receipts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-7 flex flex-col gap-4">
          {allCardsCapReached && !preparedTopup ? (
            <Card padding="lg" className="flex flex-col items-center text-center gap-3.5">
              <IconTile tone="warn" size="lg">
                <CreditCard />
              </IconTile>
              <div className="flex flex-col gap-1 max-w-sm">
                <h3 className="text-sm font-semibold text-ink m-0">
                  {t('user.wallet.allCardsCapTitle')}
                </h3>
                <p className="text-xs text-ink-muted leading-relaxed m-0">
                  {t('user.wallet.allCardsCapDesc')}
                </p>
              </div>
            </Card>
          ) : activeCard.cardNumber ? (
            <Card padding="lg" className="flex flex-col gap-4 text-start">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-warn-fg shrink-0" />
                    <h3 className="text-sm font-semibold text-ink m-0">
                      {t('user.wallet.cardTopupTitle')}
                    </h3>
                  </div>
                  {preparedTopup && (
                    <button
                      type="button"
                      onClick={() => {
                        setPreparedTopup(null);
                        setSelectedFile(null);
                        setTopupError(null);
                      }}
                      className="text-xs text-brand-fg font-medium hover:underline cursor-pointer"
                    >
                      {t('user.wallet.backToAmount')}
                    </button>
                  )}
                </div>

                <span className="text-[11px] text-ink-muted tnum">
                  {t('user.wallet.topupMinMaxHint')
                    .replace('{min}', formatToman(minAmount))
                    .replace('{max}', formatToman(maxAmount))
                    .replaceAll('{currency}', currency)}
                </span>
              </div>

              {!preparedTopup ? (
                /* Step 1: Select Amount to Prepare Card & Unique Amount */
                <form
                  onSubmit={(e) => void handlePrepareTopup(e)}
                  className="flex flex-col gap-3.5"
                >
                  <p className="text-xs leading-relaxed text-ink-muted m-0">
                    {t('user.wallet.step1Desc')}
                  </p>

                  {validPresets.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {validPresets.map((val) => {
                        const selected = parsedAmount === val;
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() => {
                              triggerHaptic('selection');
                              setAmountInput(String(val));
                              if (topupError) setTopupError(null);
                            }}
                            className={`h-9 px-2 rounded-ctl text-xs font-semibold border press rs-focus cursor-pointer tnum transition-colors ${
                              selected
                                ? 'bg-brand border-brand text-brand-ink'
                                : 'bg-surface-2 border-line text-ink-soft hover:border-line-strong'
                            }`}
                          >
                            <bdi dir="ltr">{formatToman(val)}</bdi>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-ink-soft">
                      {t('user.wallet.enterAmountLabel').replace('{currency}', currency)}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      value={amountInput}
                      onChange={(e) => {
                        setAmountInput(e.target.value);
                        if (topupError) setTopupError(null);
                      }}
                      placeholder={String(minAmount)}
                      disabled={isPreparingTopup || Boolean(pendingReceipt)}
                      className="w-full min-h-11 px-3 rounded-ctl border border-line bg-surface-2 text-sm font-mono font-semibold text-ink tnum rs-focus"
                    />
                  </div>

                  {topupError && (
                    <div className="rounded-tile border border-danger/30 bg-danger-soft p-2.5 text-xs text-danger-fg flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{topupError}</span>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <Button
                      type="submit"
                      size="md"
                      variant="primary"
                      className="w-full sm:flex-1"
                      loading={isPreparingTopup}
                      disabled={!isAmountValid || isPreparingTopup || Boolean(pendingReceipt)}
                    >
                      <span>
                        {isPreparingTopup
                          ? t('user.wallet.preparingTopup')
                          : t('user.wallet.prepareTopupButton')}
                      </span>
                      <ArrowRight className="w-4 h-4 rtl:rotate-180 shrink-0" />
                    </Button>
                    <Button
                      type="button"
                      size="md"
                      variant="secondary"
                      onClick={() => handleOpenBotForReceipt()}
                      className="w-full sm:w-auto shrink-0"
                    >
                      <Send className="w-4 h-4 shrink-0 text-brand-fg" />
                      <span>{t('user.wallet.topupInBot')}</span>
                    </Button>
                  </div>
                </form>
              ) : (
                /* Step 2: Bank Card + Exact Unique Amount + Native Receipt Upload */
                <div className="flex flex-col gap-4 anim-pop">
                  {/* Anodized Matte Bank Card Presentation */}
                  <div className="rounded-card rs-hero-bank text-obsidian-ink p-4 sm:p-5 flex flex-col justify-between gap-4">
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className="w-10 h-7 rounded-md bg-gradient-to-br from-amber-200/30 via-amber-300/20 to-amber-500/15 border border-amber-300/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] flex items-center justify-center"
                        aria-hidden="true"
                      >
                        <div className="w-6 h-4 border border-amber-300/40 rounded-xs grid grid-cols-2" />
                      </div>

                      <div className="flex items-center gap-1.5 text-xs font-medium text-white/80">
                        <ShieldCheck className="w-4 h-4 text-sky-400" />
                        <span>{preparedTopup.card.bankName || t('user.wallet.bankCard')}</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 my-1">
                      <span className="text-[11px] text-white/65">
                        {t('user.wallet.cardNumber')}
                      </span>
                      <bdi
                        dir="ltr"
                        className="font-mono text-lg sm:text-xl font-semibold tracking-wider text-amber-300 text-start select-all"
                      >
                        {formatCardNumberSpaced(preparedTopup.card.cardNumber)}
                      </bdi>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-white/10 gap-3">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] text-white/65">
                          {t('user.wallet.cardHolder')}
                        </span>
                        <span className="text-xs sm:text-sm font-semibold text-white truncate">
                          {preparedTopup.card.cardHolder || '—'}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleCopyCard(preparedTopup.card.cardNumber)}
                        className={`h-11 px-3.5 rounded-ctl font-medium text-xs inline-flex items-center justify-center gap-1.5 press rs-focus cursor-pointer shrink-0 border transition-colors ${
                          isCopied('bank-card')
                            ? 'bg-ok border-ok text-white'
                            : 'bg-white/12 hover:bg-white/20 text-white border-white/20'
                        }`}
                        aria-label={t('user.wallet.copyCard')}
                      >
                        {isCopied('bank-card') ? (
                          <>
                            <Check className="w-3.5 h-3.5 anim-pop" />
                            <span>{t('user.wallet.cardCopied')}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>{t('user.wallet.copyCard')}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Exact Payable Amount Banner */}
                  <div
                    className={`rounded-tile border p-3.5 flex flex-col gap-2 ${
                      preparedTopup.isUniqueAmount
                        ? 'border-warn/35 bg-warn-soft'
                        : 'border-brand/25 bg-brand-soft/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-medium text-ink-soft">
                          {preparedTopup.isUniqueAmount
                            ? t('user.wallet.uniqueAmountTitle')
                            : t('common.amount')}
                        </span>
                        <div className="flex items-baseline gap-1.5 mt-0.5">
                          <bdi dir="ltr" className="text-lg font-bold tnum text-ink">
                            {formatToman(preparedTopup.payableAmount)}
                          </bdi>
                          <span className="text-xs font-medium text-ink-muted">{currency}</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={isCopied('payable-amount') ? 'success' : 'secondary'}
                        onClick={() => void handleCopyPayableAmount()}
                      >
                        {isCopied('payable-amount') ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {isCopied('payable-amount')
                            ? t('common.copied')
                            : t('user.wallet.copyPayableAmount')}
                        </span>
                      </Button>
                    </div>
                    {preparedTopup.isUniqueAmount && (
                      <p className="text-[11px] text-warn-fg m-0 leading-relaxed tnum">
                        {t('user.wallet.uniqueAmountNotice')
                          .replace('{amount}', formatToman(preparedTopup.payableAmount))
                          .replace('{currency}', currency)}
                      </p>
                    )}
                  </div>

                  {/* Native File Upload Box */}
                  {preparedTopup.nativeUploadEnabled && (
                    <div className="flex flex-col gap-2.5">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={(e) => void handleFileChange(e)}
                        className="hidden"
                      />

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSubmittingReceipt}
                        className={`w-full p-4 rounded-tile border-2 border-dashed flex flex-col items-center justify-center gap-1.5 text-center cursor-pointer transition-colors ${
                          selectedFile
                            ? 'border-ok/50 bg-ok-soft/50 text-ok-fg'
                            : 'border-line-strong bg-surface-2 hover:bg-surface-3 text-ink-soft'
                        }`}
                      >
                        {selectedFile ? (
                          <>
                            <FileImage className="w-6 h-6" />
                            <span className="text-xs font-semibold truncate max-w-full px-2">
                              {selectedFile.name}
                            </span>
                            <span className="text-[11px] underline">
                              {t('user.wallet.changeReceiptFile')}
                            </span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-6 h-6 text-brand-fg" />
                            <span className="text-xs font-semibold text-ink">
                              {t('user.wallet.uploadReceiptLabel')}
                            </span>
                            <span className="text-[11px] text-ink-muted">
                              {t('user.wallet.uploadReceiptHint')}
                            </span>
                          </>
                        )}
                      </button>

                      {topupError && (
                        <div className="rounded-tile border border-danger/30 bg-danger-soft p-2.5 text-xs text-danger-fg flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{topupError}</span>
                        </div>
                      )}

                      <Button
                        type="button"
                        size="md"
                        variant="primary"
                        block
                        loading={isSubmittingReceipt}
                        disabled={!selectedFile || isSubmittingReceipt}
                        onClick={() => void handleSubmitReceipt()}
                      >
                        <Upload className="w-4 h-4 shrink-0" />
                        <span>
                          {isSubmittingReceipt
                            ? t('user.wallet.submittingReceipt')
                            : t('user.wallet.submitReceiptButton')}
                        </span>
                      </Button>
                    </div>
                  )}

                  {/* Optional Bot Fallback */}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    block
                    onClick={() => handleOpenBotForReceipt(`topup_${preparedTopup.payableAmount}`)}
                  >
                    <Send className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('user.wallet.openBotTopup')}</span>
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <Card padding="lg" className="flex flex-col items-center text-center gap-3.5">
              <IconTile tone="warn" size="lg">
                <CreditCard />
              </IconTile>
              <div className="flex flex-col gap-1 max-w-sm">
                <h3 className="text-sm font-semibold text-ink m-0">
                  {t('user.wallet.cardTopupUnavailableTitle')}
                </h3>
                <p className="text-xs text-ink-muted leading-relaxed m-0">
                  {t('user.wallet.cardTopupUnavailableDesc')}
                </p>
              </div>
              <Button size="md" variant="primary" onClick={() => handleOpenBotForReceipt('topup')}>
                <ExternalLink className="w-4 h-4 shrink-0" />
                <span>{t('user.wallet.topupInBot')}</span>
              </Button>
            </Card>
          )}

          {/* Gift Credit Redemption Card */}
          <Card padding="md" className="flex flex-col gap-3 text-start">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-brand-fg shrink-0" />
              <h3 className="text-sm font-semibold text-ink m-0">
                {t('user.wallet.giftCodeTitle')}
              </h3>
            </div>
            <p className="text-xs text-ink-muted m-0 leading-relaxed">
              {t('user.wallet.giftCodeDesc')}
            </p>
            <form
              onSubmit={(e) => void handleRedeemGiftCode(e)}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                dir="ltr"
                value={giftCode}
                onChange={(e) => {
                  setGiftCode(e.target.value);
                  if (giftFeedback) setGiftFeedback(null);
                }}
                placeholder={t('user.wallet.giftCodePlaceholder')}
                aria-label={t('user.wallet.giftCodeTitle')}
                className="flex-1 h-11 px-3.5 rounded-ctl border border-line bg-surface-2 text-xs sm:text-sm font-mono text-ink placeholder:text-ink-muted rs-focus"
              />
              <Button
                type="submit"
                size="md"
                variant="secondary"
                disabled={!giftCode.trim() || isRedeemingGift}
                loading={isRedeemingGift}
                className="shrink-0"
              >
                {t('user.wallet.giftCodeRedeem')}
              </Button>
            </form>
            {giftFeedback && (
              <p
                className={`text-xs m-0 ${
                  giftFeedback.type === 'success' ? 'text-ok-fg' : 'text-danger-fg'
                }`}
              >
                {giftFeedback.message}
              </p>
            )}
          </Card>
        </div>

        {/* Right Column: Transactions Ledger + Receipt History */}
        <section className="lg:col-span-5 flex flex-col gap-3">
          <SectionHeader icon={<History />} title={t('user.wallet.txHistory')} />

          <SegmentedControl
            value={historyMode}
            onChange={(val) => {
              triggerHaptic('selection');
              setHistoryMode(val);
            }}
            ariaLabel={t('user.wallet.txHistory')}
            options={[
              {
                id: 'transactions',
                label: t('user.wallet.historyTabTransactions'),
                icon: History,
                tone: 'brand',
              },
              {
                id: 'receipts',
                label: t('user.wallet.historyTabReceipts'),
                icon: Receipt,
                tone: 'brand',
              },
            ]}
          />

          {historyMode === 'transactions' ? (
            <>
              {/* Category Filter Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                {(
                  [
                    { id: 'all', label: t('user.wallet.txFilterAll') },
                    { id: 'topup', label: t('user.wallet.txFilterTopup') },
                    { id: 'purchase', label: t('user.wallet.txFilterPurchase') },
                    { id: 'rewards', label: t('user.wallet.txFilterRewards') },
                    { id: 'transfer', label: t('user.wallet.txFilterTransfer') },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection');
                      setTxFilter(chip.id);
                      setPage(1);
                    }}
                    className={`h-8 px-2.5 rounded-full text-[11px] font-medium border shrink-0 press cursor-pointer transition-colors ${
                      txFilter === chip.id
                        ? 'bg-brand border-brand text-brand-ink'
                        : 'bg-surface border-line text-ink-soft hover:border-line-strong'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {isLoadingTxPage ? (
                <SkeletonList count={3} />
              ) : currentTransactions.length === 0 ? (
                <Card padding="lg" className="text-center text-xs text-ink-muted">
                  {t('user.wallet.txEmpty')}
                </Card>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="rs-grouped-list divide-y divide-line anim-stagger">
                    {currentTransactions.map((tx) => (
                      <TransactionItem key={tx.id} tx={tx} currency={currency} grouped />
                    ))}
                  </div>

                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    disabled={isFetchingTx}
                    prevLabel={t('user.wallet.paginationPrev')}
                    nextLabel={t('user.wallet.paginationNext')}
                    pageLabel={t('user.wallet.paginationPage')
                      .replace('{page}', formatNumber(page))
                      .replace('{totalPages}', formatNumber(totalPages))}
                    onPageChange={(nextPage) => {
                      triggerHaptic('selection');
                      setPage(nextPage);
                    }}
                  />
                </div>
              )}
            </>
          ) : isFetchingReceipts && receiptsList.length === 0 ? (
            <SkeletonList count={3} />
          ) : receiptsList.length === 0 ? (
            <Card padding="lg" className="text-center text-xs text-ink-muted">
              {t('user.wallet.receiptsEmpty')}
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="rs-grouped-list divide-y divide-line anim-stagger">
                {receiptsList.map((r) => {
                  const badgeVariant =
                    r.status === 'approved'
                      ? 'success'
                      : r.status === 'rejected' || r.status === 'voided'
                        ? 'error'
                        : 'warning';
                  const statusLabel =
                    r.status === 'approved'
                      ? t('common.statusApproved')
                      : r.status === 'rejected'
                        ? t('common.statusRejected')
                        : r.status === 'voided'
                          ? t('common.statusVoided')
                          : t('common.statusPending');
                  return (
                    <div
                      key={r.id}
                      className="px-4 py-3 flex items-center justify-between gap-2.5 text-start"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <bdi dir="ltr" className="text-xs sm:text-sm font-semibold tnum text-ink">
                            {formatToman(r.amount)} {currency}
                          </bdi>
                          <Badge variant={badgeVariant} size="xs">
                            {statusLabel}
                          </Badge>
                        </div>
                        <span className="text-[11px] text-ink-muted tnum truncate">
                          #{r.shortId} · {formatIsoDate(r.createdAt)}
                          {r.cardNumber ? ` · ${r.cardNumber}` : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <Pagination
                page={receiptsPage}
                totalPages={receiptsTotalPages}
                disabled={isFetchingReceipts}
                prevLabel={t('user.wallet.paginationPrev')}
                nextLabel={t('user.wallet.paginationNext')}
                pageLabel={t('user.wallet.paginationPage')
                  .replace('{page}', formatNumber(receiptsPage))
                  .replace('{totalPages}', formatNumber(receiptsTotalPages))}
                onPageChange={(nextPage) => {
                  triggerHaptic('selection');
                  setReceiptsPage(nextPage);
                }}
              />
            </div>
          )}
        </section>
      </div>

      {/* Native Wallet-to-Wallet Transfer Modal */}
      <WalletTransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        availableBalance={availableBalance}
        minAmount={transferMinAmount}
        currency={currency}
        onNotify={onNotify}
      />
    </div>
  );
};
