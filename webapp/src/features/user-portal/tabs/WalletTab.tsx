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
    return cleaned.replace(/(\d{4})/g, '$1 ').trim();
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
      if (window.Telegram?.WebApp?.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink(url);
        setTimeout(() => {
          window.Telegram?.WebApp?.close?.();
        }, 350);
        return;
      }
    }
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
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
        className={`p-5 rounded-2xl border flex items-center justify-between gap-3 text-start transition-all ${
          isDark
            ? 'bg-gradient-to-br from-indigo-950/40 via-zinc-900/70 to-purple-950/30 border-white/[0.08] shadow-md'
            : 'bg-gradient-to-br from-indigo-50/80 via-white to-purple-50/60 border-slate-200/90 shadow-2xs'
        }`}
      >
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0 border border-indigo-500/20">
            <Wallet className="w-6 h-6" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 dark:text-zinc-400">
              {t('user.wallet.currentBalance')}
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span
                className={`text-xl sm:text-2xl font-mono font-extrabold ${
                  isDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                {formatToman(availableBalance)}
              </span>
              <span className="text-xs text-slate-500 dark:text-zinc-400 font-medium">
                {currency}
              </span>
            </div>
          </div>
        </div>

        {profile?.reservedBalance && profile.reservedBalance > 0 ? (
          <div className="flex flex-col items-end text-[11px] text-slate-400">
            <span>{t('user.wallet.totalLabel').replace('{amount}', formatToman(balance))}</span>
            <span className="text-amber-500">
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
          className={`p-4 rounded-2xl border flex flex-col gap-2.5 text-start transition-all relative overflow-hidden ${
            isDark
              ? 'bg-amber-950/20 border-amber-500/30 text-amber-200 shadow-md'
              : 'bg-amber-50 border-amber-200/90 text-amber-900 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
              </span>
              <h3 className="text-xs sm:text-sm font-bold m-0">
                {t('user.wallet.pendingReceiptTitle')}
              </h3>
            </div>

            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 font-semibold">
              {t('user.wallet.pendingReceiptStatusLabel')}
            </span>
          </div>

          <p className="text-xs leading-relaxed opacity-90 m-0">
            {t('user.wallet.pendingReceiptSubtitle')}
          </p>

          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs font-mono ${
              isDark ? 'bg-black/30 border-amber-500/20' : 'bg-white/90 border-amber-200'
            }`}
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
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
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
              <CreditCard className="w-4 h-4 text-amber-500 shrink-0" />
              <h3
                className={`text-xs sm:text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}
              >
                {t('user.wallet.cardTopupTitle')}
              </h3>
            </div>

            <span className="text-[10px] text-slate-400 dark:text-zinc-400 font-mono">
              {t('user.wallet.topupMinMaxHint')
                .replace('{min}', formatToman(minAmount))
                .replace('{max}', formatToman(maxAmount))}
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-zinc-400 m-0">
            {t('user.wallet.cardTopupDesc')}
          </p>

          {/* Bank Card Presentation Card */}
          <div
            className={`p-4 sm:p-5 rounded-2xl border relative overflow-hidden flex flex-col justify-between gap-4 shadow-md ${
              isDark
                ? 'bg-gradient-to-tr from-slate-950 via-indigo-950/80 to-slate-900 border-indigo-500/25 text-white'
                : 'bg-gradient-to-tr from-slate-900 via-indigo-950 to-slate-800 border-slate-700 text-white'
            }`}
          >
            {/* Top row: Chip and generic bank brand */}
            <div className="flex items-center justify-between">
              <div className="w-10 h-7 rounded-md bg-amber-400/80 border border-amber-300 flex items-center justify-center shadow-inner">
                <div className="w-7 h-4 border border-amber-600/40 rounded-sm grid grid-cols-2" />
              </div>

              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <ShieldCheck className="w-4 h-4 text-indigo-400" />
                <span>{t('user.wallet.bankCard')}</span>
              </div>
            </div>

            {/* Card Number */}
            <div className="flex flex-col gap-1 my-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-sans">
                {t('user.wallet.cardNumber')}
              </span>
              <span
                dir="ltr"
                className="font-mono text-lg sm:text-xl font-extrabold tracking-widest text-amber-300 text-start select-all"
              >
                {formatCardNumberSpaced(cardNumber)}
              </span>
            </div>

            {/* Bottom Row: Holder name and Copy Button */}
            <div className="flex items-center justify-between pt-2 border-t border-white/10 gap-2">
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] text-slate-400 font-sans">
                  {t('user.wallet.cardHolder')}
                </span>
                <span className="text-xs sm:text-sm font-bold text-white truncate">
                  {cardHolder || '—'}
                </span>
              </div>

              <button
                type="button"
                onClick={handleCopyCard}
                className={`min-h-[44px] min-w-[44px] py-2 px-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shrink-0 shadow-xs ${
                  isCopied('bank-card')
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white/15 hover:bg-white/20 text-white border border-white/20'
                }`}
                aria-label={t('user.wallet.copyCard')}
              >
                {isCopied('bank-card') ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
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

          {/* Quick preset amounts chips (Informative only) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-medium">
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
                    className={`min-h-[44px] py-2 px-3 rounded-xl text-xs font-semibold font-mono border transition-all active:scale-95 cursor-pointer flex items-center justify-center ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                        : isDark
                          ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-300'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700 shadow-2xs'
                    }`}
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
              <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5 font-mono">
                1
              </div>
              <div className="flex flex-col min-w-0">
                <span
                  className={`text-xs font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}
                >
                  {t('user.wallet.step1Title')}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                  {t('user.wallet.step1Desc')}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5 font-mono">
                2
              </div>
              <div className="flex flex-col min-w-0">
                <span
                  className={`text-xs font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}
                >
                  {t('user.wallet.step2Title')}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                  {t('user.wallet.step2Desc')}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5 font-mono">
                3
              </div>
              <div className="flex flex-col min-w-0">
                <span
                  className={`text-xs font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}
                >
                  {t('user.wallet.step3Title')}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                  {t('user.wallet.step3Desc')}
                </span>
              </div>
            </div>
          </div>

          {/* Action to submit slip in bot */}
          <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleOpenBotForReceipt('receipt')}
              className="w-full min-h-[44px] py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer shadow-md bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white"
            >
              <Send className="w-4 h-4 rtl:rotate-180" />
              <span>{t('user.wallet.sendReceiptDirect')}</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenBotForReceipt('topup')}
              className={`w-full sm:w-auto min-h-[44px] py-3 px-4 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer whitespace-nowrap ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-300'
                  : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700'
              }`}
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
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
            <CreditCard className="w-6 h-6" />
          </div>
          <div className="flex flex-col gap-1 max-w-sm">
            <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {t('user.wallet.cardTopupUnavailableTitle')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed m-0">
              {t('user.wallet.cardTopupUnavailableDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleOpenBotForReceipt('topup')}
            className="min-h-[44px] px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-md bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white"
          >
            <RotateCw className="w-4 h-4" />
            <span>{t('user.wallet.topupInBot')}</span>
          </button>
        </section>
      )}

      {/* Transaction History Section */}
      <section className="w-full">
        <div className="flex items-center gap-1.5 mb-2.5 px-1">
          <History className="w-3.5 h-3.5 text-indigo-400" />
          <h3
            className={`text-xs font-bold uppercase tracking-wider ${
              isDark ? 'text-zinc-400' : 'text-slate-600'
            }`}
          >
            {t('user.wallet.txHistory')}
          </h3>
        </div>

        {currentTransactions.length === 0 ? (
          <div
            className={`p-6 rounded-2xl border text-center text-xs ${
              isDark
                ? 'bg-white/[0.02] border-white/[0.06] text-zinc-500'
                : 'bg-slate-50 border-slate-200 text-slate-400'
            }`}
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
                  className={`p-3.5 rounded-2xl border flex items-center justify-between text-start gap-2.5 transition-all ${
                    isDark
                      ? `${subCardClass} hover:border-white/[0.12]`
                      : 'bg-white border-slate-200/80 shadow-2xs hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        isCredit
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-xs font-bold truncate ${
                            isDark ? 'text-white' : 'text-slate-900'
                          }`}
                        >
                          {getTransactionTypeLabel(tx.type)}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(tx.createdAt).toLocaleDateString(isRtl ? 'fa-IR' : 'en-US')}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                        {tx.description}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end shrink-0">
                    <span
                      dir="ltr"
                      className={`font-mono font-bold text-xs sm:text-sm ${
                        isCredit ? 'text-emerald-500' : 'text-rose-500'
                      }`}
                    >
                      {isCredit ? '+' : ''}
                      {formatToman(tx.amount)} {currency}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
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
              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-200/60 dark:border-white/[0.06]">
                <button
                  type="button"
                  disabled={page <= 1 || isFetchingTx}
                  onClick={() => {
                    triggerHaptic('selection');
                    setPage((p) => Math.max(1, p - 1));
                  }}
                  className={`min-h-[44px] min-w-[44px] inline-flex items-center gap-1.5 px-3 rounded-xl text-xs font-medium cursor-pointer transition-all active:scale-[0.98] border ${
                    isDark
                      ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08] disabled:opacity-30 disabled:pointer-events-none'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none shadow-xs'
                  }`}
                  aria-label={t('user.wallet.paginationPrev')}
                >
                  <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180 shrink-0" />
                  <span>{t('user.wallet.paginationPrev')}</span>
                </button>

                <span
                  className={`text-xs font-mono font-medium px-3 py-1.5 rounded-lg border ${
                    isDark
                      ? 'bg-white/[0.03] border-white/10 text-zinc-400'
                      : 'bg-slate-100 border-slate-200/80 text-slate-600'
                  }`}
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
                  className={`min-h-[44px] min-w-[44px] inline-flex items-center gap-1.5 px-3 rounded-xl text-xs font-medium cursor-pointer transition-all active:scale-[0.98] border ${
                    isDark
                      ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08] disabled:opacity-30 disabled:pointer-events-none'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none shadow-xs'
                  }`}
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
