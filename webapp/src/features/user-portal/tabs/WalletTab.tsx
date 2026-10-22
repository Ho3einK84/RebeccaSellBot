import React, { useState } from 'react';
import {
  Wallet,
  CreditCard,
  Copy,
  Check,
  Send,
  ArrowDownLeft,
  ArrowUpRight,
  History,
  ShieldCheck,
  RotateCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { openTelegramLinkAndMinimize, minimizeOrCloseWebApp } from '@/shared/lib/telegramNavigation.js';
import { useUserTransactions } from '../hooks/useUserPortalData.js';
import type {
  UserPortalProfile,
  UserPortalSettings,
  UserTransactionRecord,
  PendingReceiptInfo,
} from '@/shared/types/userPortal.js';

interface WalletTabProps {
  profile: UserPortalProfile | null;
  settings: UserPortalSettings | null;
  transactions: UserTransactionRecord[];
  pendingReceipt?: PendingReceiptInfo | null;
  onNotify: (message: string) => void;
}

const PRESET_AMOUNTS = [50_000, 100_000, 200_000, 500_000, 1_000_000];

export const WalletTab: React.FC<WalletTabProps> = ({
  profile,
  settings,
  transactions,
  pendingReceipt,
  onNotify,
}) => {
  const { t, isRtl } = useLanguage();
  const { isDark, cardClass, subCardClass } = useThemeTokens();
  const { formatToman } = useFormatters();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();

  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [page, setPage] = useState<number>(1);

  const { data: txQueryData, isFetching: isFetchingTx } = useUserTransactions(page, 10);
  const currentTransactions = txQueryData?.transactions ?? transactions;
  const totalPages = txQueryData?.totalPages ?? 1;

  const currency = settings?.currency || t('common.currency');
  const balance = profile?.balance ?? 0;
  const availableBalance = profile?.availableBalance ?? 0;
  const cardNumber = settings?.cardNumber || '';
  const cardHolder = settings?.cardHolder || '';
  const minAmount = settings?.topupMinAmount ?? 10_000;
  const maxAmount = settings?.topupMaxAmount ?? 10_000_000;

  const formatCardNumberSpaced = (raw: string): string => {
    const cleaned = raw.replace(/\D/g, '');
    return cleaned.replace(/(\d{4})/g, '$1').trim();
  };

  const handleCopyCard = async () => {
    if (!cardNumber) return;
    triggerHaptic('light');
    const ok = await copy(cardNumber.replace(/\s+/g, ''), 'bank-card');
    if (ok) {
      onNotify(t('user.wallet.cardCopied'));
    }
  };

  const handleSelectPreset = (amount: number) => {
    triggerHaptic('selection');
    setSelectedPreset((prev) => (prev === amount ? null : amount));
  };

  const handleOpenBotForReceipt = (payload = 'receipt') => {
    triggerHaptic('medium');
    const botUser = settings?.botUsername || '';
    if (botUser) {
      const cleanBot = botUser.replace(/^@/, '');
      const url = `https://t.me/${cleanBot}?start=${payload}`;
      openTelegramLinkAndMinimize(url);
      return;
    }
    minimizeOrCloseWebApp();
  };

  const getTransactionTypeLabel = (type: string): string => {
    switch (type) {
      case 'topup':
        return t('user.wallet.typeTopup');
      case 'purchase':
        return t('user.wallet.typePurchase');
      case 'refund':
        return t('user.wallet.typeRefund');
      case 'cashback':
        return t('user.wallet.typeCashback');
      case 'referral_bonus':
        return t('user.wallet.typeReferral');
      case 'admin_adjustment':
        return t('user.wallet.typeAdminAdjustment');
      case 'transfer_sent':
        return t('user.wallet.typeTransferSent');
      case 'transfer_received':
        return t('user.wallet.typeTransferReceived');
      default:
        return t('user.wallet.typeOther');
    }
  };

  return (
    <div className="w-full flex flex-col gap-4 pb-6">
      {/* Wallet Balance Summary Card */}
      <section
        className={`p-5 rounded-2xl border flex items-center justify-between gap-3 text-start transition-all bg-gradient-to-br from-brand-soft via-surface to-brand-soft/50 dark:from-brand/35 dark:via-surface dark:to-brand/20 border-brand/20 shadow-md shadow-2xs`}
      >
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-brand/10 text-brand flex items-center justify-center shrink-0 border border-brand/20">
            <Wallet className="w-6 h-6" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-ink-muted">{t('user.wallet.currentBalance')}</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className={`text-xl sm:text-2xl tnum font-extrabold text-ink`}>
                {formatToman(availableBalance)}
              </span>
              <span className="text-xs text-ink-muted font-medium">{currency}</span>
            </div>
          </div>
        </div>

        {profile?.reservedBalance && profile.reservedBalance > 0 ? (
          <div className="flex flex-col items-end text-[11px] text-ink-muted">
            <span>{t('user.wallet.totalLabel').replace('{amount}', formatToman(balance))}</span>
            <span className="text-warn">
              {t('user.wallet.reservedLabel').replace(
                '{amount}',
                formatToman(profile.reservedBalance)
              )}
            </span>
          </div>
        ) : null}
      </section>

      {/* Pending Receipt Status Banner */}
      {pendingReceipt && (
        <section
          className={`p-4 rounded-2xl border flex flex-col gap-2.5 text-start transition-all relative overflow-hidden bg-warn/20 border-warn/30 text-warn shadow-md shadow-2xs`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warn opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-warn" />
              </span>
              <h3 className="text-xs sm:text-sm font-bold m-0">
                {t('user.wallet.pendingReceiptTitle')}
              </h3>
            </div>

            <span className="text-[10px] tnum px-2 py-0.5 rounded-full bg-warn/15 border border-warn/30 font-semibold">
              {t('user.wallet.pendingReceiptStatusLabel')}
            </span>
          </div>

          <p className="text-xs leading-relaxed opacity-90 m-0">
            {t('user.wallet.pendingReceiptSubtitle')}
          </p>

          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs tnum bg-surface-2/70 dark:bg-black/30 border-warn/25 text-ink`}
          >
            <div className="flex flex-col">
              <span className="text-[10px] opacity-75 font-sans">
                {t('user.wallet.pendingReceiptAmountLabel')}
              </span>
              <span className="font-bold text-sm">
                {formatToman(pendingReceipt.amount)} {currency}
              </span>
            </div>

            <div className="flex flex-col items-end">
              <span className="text-[10px] opacity-75 font-sans">
                {t('user.wallet.pendingReceiptTrackingId')}
              </span>
              <button
                type="button"
                onClick={async () => {
                  triggerHaptic('light');
                  const ok = await copy(pendingReceipt.id, 'receipt-id');
                  if (ok) {
                    onNotify(t('common.copied'));
                  }
                }}
                className="min-h-[44px] inline-flex items-center gap-1 text-[11px] underline opacity-90 hover:opacity-100 cursor-pointer p-1.5 rounded-lg"
                aria-label={t('common.copy')}
              >
                <span>
                  {pendingReceipt.id.length > 15
                    ? `${pendingReceipt.id.slice(0, 8)}...${pendingReceipt.id.slice(-4)}`
                    : pendingReceipt.id}
                </span>
                {isCopied('receipt-id') ? (
                  <Check className="w-3.5 h-3.5 text-ok" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Card to Card Topup Section or Empty Card State */}
      {cardNumber ? (
        <section
          className={`p-4 sm:p-5 rounded-2xl border flex flex-col gap-3.5 text-start ${cardClass}`}
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-warn shrink-0" />
              <h3 className={`text-xs sm:text-sm font-bold text-ink`}>
                {t('user.wallet.cardTopupTitle')}
              </h3>
            </div>

            <span className="text-[10px] text-ink-muted tnum">
              {t('user.wallet.topupMinMaxHint')
                .replace('{min}', formatToman(minAmount))
                .replace('{max}', formatToman(maxAmount))}
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-ink-muted m-0">
            {t('user.wallet.cardTopupDesc')}
          </p>

          {/* Bank Card Presentation Card */}
          <div
            className={`p-4 sm:p-5 rounded-2xl border relative overflow-hidden flex flex-col justify-between gap-4 shadow-lg bg-gradient-to-tr from-slate-950 via-brand/80 to-slate-900 border-white/10 text-white`}
          >
            {/* Top row: Chip and generic bank brand */}
            <div className="flex items-center justify-between">
              <div className="w-10 h-7 rounded-md bg-amber-400 border border-amber-300 flex items-center justify-center shadow-inner">
                <div className="w-7 h-4 border border-amber-600/40 rounded-sm grid grid-cols-2" />
              </div>

              <div className="flex items-center gap-1.5 text-xs font-semibold text-white/80">
                <ShieldCheck className="w-4 h-4 text-brand-soft" />
                <span>{t('user.wallet.bankCard')}</span>
              </div>
            </div>

            {/* Card Number */}
            <div className="flex flex-col gap-1 my-1">
              <span className="text-[10px] text-white/70 uppercase tracking-widest font-sans">
                {t('user.wallet.cardNumber')}
              </span>
              <span
                dir="ltr"
                className="font-mono text-lg sm:text-xl font-extrabold tracking-widest text-amber-300 text-start select-all drop-shadow-xs"
              >
                {formatCardNumberSpaced(cardNumber)}
              </span>
            </div>

            {/* Bottom Row: Holder name and Copy Button */}
            <div className="flex items-center justify-between pt-2 border-t border-white/15 gap-2">
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] text-white/70 font-sans">
                  {t('user.wallet.cardHolder')}
                </span>
                <span className="text-xs sm:text-sm font-bold text-white truncate">
                  {cardHolder || '—'}
                </span>
              </div>

              <button
                type="button"
                onClick={handleCopyCard}
                className={`min-h-[44px] min-w-[44px] py-2 px-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shrink-0 shadow-xs ${isCopied('bank-card') ? 'bg-ok text-white' : 'bg-white/15 hover:bg-white/25 text-white border border-white/20'}`}
                aria-label={t('user.wallet.copyCard')}
              >
                {isCopied('bank-card') ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-white" />
                    <span>{t('user.wallet.cardCopied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-white" />
                    <span>{t('user.wallet.copyCard')}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick preset amounts chips (Informative only) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-ink-muted font-medium">
              {t('user.wallet.quickAmounts')}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESET_AMOUNTS.map((amt) => {
                const isSelected = selectedPreset === amt;
                return (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => handleSelectPreset(amt)}
                    className={`min-h-[44px] py-2 px-3 rounded-xl text-xs font-semibold tnum border transition-all active:scale-95 cursor-pointer flex items-center justify-center ${isSelected ? 'bg-brand border-brand text-brand-ink shadow-xs' : 'bg-surface-2 border-line hover:bg-surface-3 text-ink-soft shadow-2xs'}`}
                  >
                    {formatToman(amt)} {currency}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step-by-Step Payment Instructions */}
          <div className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${subCardClass}`}>
            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-brand/20 text-brand flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5 tnum">
                1
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-ink">{t('user.wallet.step1Title')}</span>
                <span className="text-[11px] text-ink-muted">{t('user.wallet.step1Desc')}</span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-brand/20 text-brand flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5 tnum">
                2
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-ink">{t('user.wallet.step2Title')}</span>
                <span className="text-[11px] text-ink-muted">{t('user.wallet.step2Desc')}</span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-brand/20 text-brand flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5 tnum">
                3
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-ink">{t('user.wallet.step3Title')}</span>
                <span className="text-[11px] text-ink-muted">{t('user.wallet.step3Desc')}</span>
              </div>
            </div>
          </div>

          {/* Action to submit slip in bot */}
          <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleOpenBotForReceipt('receipt')}
              className="w-full min-h-[44px] py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer shadow-md bg-brand hover:bg-brand text-brand-ink"
            >
              <Send className="w-4 h-4 rtl:rotate-180" />
              <span>{t('user.wallet.sendReceiptDirect')}</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenBotForReceipt('topup')}
              className="w-full sm:w-auto min-h-[44px] py-3 px-4 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer whitespace-nowrap bg-surface-2 border-line hover:bg-surface-3 text-ink-soft"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>{t('user.wallet.openBotTopup')}</span>
            </button>
          </div>
        </section>
      ) : (
        /* Empty Card State when card topup is not configured */
        <section
          className={`p-5 rounded-2xl border flex flex-col items-center text-center gap-3 ${cardClass}`}
        >
          <div className="w-12 h-12 rounded-2xl bg-warn/10 text-warn flex items-center justify-center border border-warn/20">
            <CreditCard className="w-6 h-6" />
          </div>
          <div className="flex flex-col gap-1 max-w-sm">
            <h3 className={`text-sm font-bold text-ink`}>
              {t('user.wallet.cardTopupUnavailableTitle')}
            </h3>
            <p className="text-xs text-ink-muted leading-relaxed m-0">
              {t('user.wallet.cardTopupUnavailableDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleOpenBotForReceipt('topup')}
            className="min-h-[44px] px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-md bg-brand hover:bg-brand text-brand-ink"
          >
            <RotateCw className="w-4 h-4" />
            <span>{t('user.wallet.topupInBot')}</span>
          </button>
        </section>
      )}

      {/* Transaction History Section */}
      <section className="w-full">
        <div className="flex items-center gap-1.5 mb-2.5 px-1">
          <History className="w-3.5 h-3.5 text-brand" />
          <h3 className={`text-xs font-bold uppercase tracking-wider text-ink-muted`}>
            {t('user.wallet.txHistory')}
          </h3>
        </div>

        {currentTransactions.length === 0 ? (
          <div
            className={`p-6 rounded-2xl border text-center text-xs bg-surface border-line text-ink-muted`}
          >
            {t('user.wallet.txEmpty')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {currentTransactions.map((tx) => {
              const isCredit = tx.amount > 0;
              const Icon = isCredit ? ArrowDownLeft : ArrowUpRight;

              return (
                <div
                  key={tx.id}
                  className={`p-3.5 rounded-2xl border flex items-center justify-between text-start gap-2.5 transition-all ${isDark ? `${subCardClass} hover:border-line/[0.12]` : 'bg-surface border-line/80 shadow-2xs hover:border-line-strong'}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isCredit ? 'bg-ok/10 text-ok border border-ok/20' : 'bg-danger/10 text-danger border border-danger/20'}`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-bold truncate text-ink`}>
                          {getTransactionTypeLabel(tx.type)}
                        </span>
                        <span className="text-[10px] text-ink-muted tnum">
                          {new Date(tx.createdAt).toLocaleDateString(isRtl ? 'fa-IR' : 'en-US')}
                        </span>
                      </div>
                      <span className="text-[11px] text-ink-muted truncate">{tx.description}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end shrink-0">
                    <span
                      dir="ltr"
                      className={`tnum font-bold text-xs sm:text-sm ${isCredit ? 'text-ok' : 'text-danger'}`}
                    >
                      {isCredit ? '+' : ''}
                      {formatToman(tx.amount)} {currency}
                    </span>
                    <span className="text-[10px] text-ink-muted tnum">
                      {t('user.wallet.balanceAfterLabel').replace(
                        '{amount}',
                        formatToman(tx.balanceAfter)
                      )}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-line/60">
                <button
                  type="button"
                  disabled={page <= 1 || isFetchingTx}
                  onClick={() => {
                    triggerHaptic('selection');
                    setPage((p) => Math.max(1, p - 1));
                  }}
                  className={`min-h-[44px] min-w-[44px] inline-flex items-center gap-1.5 px-3 rounded-xl text-xs font-medium cursor-pointer transition-all active:scale-[0.98] border bg-surface-2 border-line text-ink-soft hover:bg-surface-3 disabled:opacity-30 disabled:pointer-events-none shadow-xs`}
                  aria-label={t('user.wallet.paginationPrev')}
                >
                  <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180 shrink-0" />
                  <span>{t('user.wallet.paginationPrev')}</span>
                </button>

                <span
                  className={`text-xs tnum font-medium px-3 py-1.5 rounded-lg border bg-surface-2 border-line text-ink-muted`}
                >
                  {t('user.wallet.paginationPage')
                    .replace('{page}', String(page))
                    .replace('{totalPages}', String(totalPages))}
                </span>

                <button
                  type="button"
                  disabled={page >= totalPages || isFetchingTx}
                  onClick={() => {
                    triggerHaptic('selection');
                    setPage((p) => p + 1);
                  }}
                  className={`min-h-[44px] min-w-[44px] inline-flex items-center gap-1.5 px-3 rounded-xl text-xs font-medium cursor-pointer transition-all active:scale-[0.98] border bg-surface-2 border-line text-ink-soft hover:bg-surface-3 disabled:opacity-30 disabled:pointer-events-none shadow-xs`}
                  aria-label={t('user.wallet.paginationNext')}
                >
                  <span>{t('user.wallet.paginationNext')}</span>
                  <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180 shrink-0" />
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
