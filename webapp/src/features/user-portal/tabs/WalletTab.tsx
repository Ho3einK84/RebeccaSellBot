import React from 'react';
import {
  Wallet,
  CreditCard,
  Copy,
  Check,
  Send,
  ArrowDownLeft,
  ArrowUpRight,
  History,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import type {
  UserPortalProfile,
  UserPortalSettings,
  UserTransactionRecord,
} from '@/shared/types/userPortal.js';

interface WalletTabProps {
  profile: UserPortalProfile | null;
  settings: UserPortalSettings | null;
  transactions: UserTransactionRecord[];
  onNotify: (message: string) => void;
}

export const WalletTab: React.FC<WalletTabProps> = ({
  profile,
  settings,
  transactions,
  onNotify,
}) => {
  const { t, isRtl } = useLanguage();
  const { isDark } = useThemeTokens();
  const { formatToman } = useFormatters();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();

  const currency = settings?.currency || t('common.currency');
  const balance = profile?.balance ?? 0;
  const availableBalance = profile?.availableBalance ?? 0;
  const cardNumber = settings?.cardNumber || '';
  const cardHolder = settings?.cardHolder || '';

  const formatCardNumberSpaced = (raw: string): string => {
    const cleaned = raw.replace(/\D/g, '');
    return cleaned.replace(/(\d{4})/g, '$1 ').trim();
  };

  const handleCopyCard = () => {
    if (!cardNumber) return;
    triggerHaptic('light');
    copy(cardNumber.replace(/\s+/g, ''), 'bank-card');
    onNotify(t('user.wallet.cardCopied'));
  };

  const handleOpenBotForReceipt = () => {
    triggerHaptic('medium');
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
      default:
        return t('user.wallet.typeOther');
    }
  };

  return (
    <div className="w-full flex flex-col gap-4 pb-6">
      {/* Wallet Balance Summary Card */}
      <section
        className={`p-5 rounded-3xl border flex items-center justify-between gap-3 text-start transition-all ${
          isDark
            ? 'bg-gradient-to-br from-indigo-950/40 via-zinc-900/60 to-purple-950/30 border-white/[0.08] shadow-md'
            : 'bg-gradient-to-br from-indigo-50/80 via-white to-purple-50/60 border-slate-200/90 shadow-2xs'
        }`}
      >
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
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

      {/* Card to Card Topup Section */}
      {cardNumber && (
        <section
          className={`p-4 sm:p-5 rounded-3xl border flex flex-col gap-3 text-start ${
            isDark
              ? 'bg-white/[0.025] border-white/[0.08]'
              : 'bg-white border-slate-200/90 shadow-2xs'
          }`}
        >
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-amber-500" />
            <h3
              className={`text-xs sm:text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}
            >
              {t('user.wallet.cardTopupTitle')}
            </h3>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-zinc-400 m-0">
            {t('user.wallet.cardTopupDesc')}
          </p>

          {/* Bank Card Presentation Box */}
          <div
            className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              isDark ? 'bg-zinc-900/80 border-white/[0.08]' : 'bg-slate-50 border-slate-200/90'
            }`}
          >
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                  {t('user.wallet.cardNumber')}
                </span>
                {cardHolder && (
                  <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                    ({cardHolder})
                  </span>
                )}
              </div>

              <span
                dir="ltr"
                className={`font-mono text-base sm:text-lg font-bold tracking-widest ${
                  isDark ? 'text-amber-300' : 'text-amber-600'
                }`}
              >
                {formatCardNumberSpaced(cardNumber)}
              </span>
            </div>

            <button
              type="button"
              onClick={handleCopyCard}
              className={`py-2 px-3.5 rounded-xl font-medium text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shrink-0 ${
                isCopied('bank-card')
                  ? 'bg-emerald-600 text-white'
                  : isDark
                    ? 'bg-white/10 hover:bg-white/15 text-white border border-white/10'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
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

          {/* Action to submit slip in bot */}
          <button
            type="button"
            onClick={handleOpenBotForReceipt}
            className={`w-full py-2.5 px-4 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-indigo-600/15 border-indigo-500/25 text-indigo-300 hover:bg-indigo-600/25'
                : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
            }`}
          >
            <Send className="w-3.5 h-3.5 rtl:rotate-180" />
            <span>{t('user.wallet.sendReceiptNotice')}</span>
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

        {transactions.length === 0 ? (
          <div
            className={`p-6 rounded-3xl border text-center text-xs ${
              isDark
                ? 'bg-white/[0.02] border-white/[0.06] text-zinc-500'
                : 'bg-slate-50 border-slate-200 text-slate-400'
            }`}
          >
            {t('user.wallet.txEmpty')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {transactions.map((tx) => {
              const isCredit = tx.amount > 0;
              const Icon = isCredit ? ArrowDownLeft : ArrowUpRight;

              return (
                <div
                  key={tx.id}
                  className={`p-3.5 rounded-2xl border flex items-center justify-between text-start gap-2.5 transition-all ${
                    isDark
                      ? 'bg-white/[0.025] border-white/[0.07]'
                      : 'bg-white border-slate-200/80 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        isCredit
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-rose-500/10 text-rose-400'
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
                        <span className="text-[10px] text-slate-400">
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
          </div>
        )}
      </section>
    </div>
  );
};
