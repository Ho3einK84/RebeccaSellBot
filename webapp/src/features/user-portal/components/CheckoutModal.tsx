import React, { useState } from 'react';
import {
  ShoppingCart,
  CheckCircle2,
  AlertCircle,
  Wallet,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { UserPackageItem } from '@/shared/types/userPortal.js';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  pkg: UserPackageItem | null;
  availableBalance: number;
  currency?: string;
  onGoToWallet: () => void;
  onSuccess: (message: string) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  pkg,
  availableBalance,
  currency,
  onGoToWallet,
  onSuccess,
}) => {
  const { t } = useLanguage();
  const { isDark } = useThemeTokens();
  const { triggerHaptic } = useHaptic();
  const { formatToman } = useFormatters();
  const [isProcessing, setIsProcessing] = useState(false);
  const displayCurrency = currency || t('common.currency');

  if (!pkg) return null;

  const hasSufficientBalance = availableBalance >= pkg.price;
  const deficit = Math.max(0, pkg.price - availableBalance);

  const handleConfirmOrder = () => {
    if (!hasSufficientBalance) return;
    setIsProcessing(true);
    triggerHaptic('medium');

    setTimeout(() => {
      setIsProcessing(false);
      triggerHaptic('success');
      onSuccess(t('user.shop.orderSuccess'));
      onClose();
    }, 800);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('user.shop.orderModalTitle')}
      icon={<ShoppingCart className="w-5 h-5 text-indigo-400" />}
      maxWidth="md"
    >
      <div className="flex flex-col gap-4 text-start pt-1">
        {/* Package summary card */}
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
              {pkg.name}
            </span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {t('user.shop.trafficUnit').replace('{gb}', String(pkg.gbAmount))}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400 pt-1 border-t border-slate-200/50 dark:border-white/[0.05]">
            <span>{t('user.shop.daysUnit').replace('{days}', String(pkg.durationDays))}</span>
            <span className="font-bold text-sm text-indigo-500 dark:text-indigo-400">
              {formatToman(pkg.price)} {displayCurrency}
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
            hasSufficientBalance
              ? isDark
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : isDark
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 shrink-0" />
            <span>{t('user.dashboard.availableBalance')}</span>
          </div>
          <span className="font-mono font-bold">
            {formatToman(availableBalance)} {displayCurrency}
          </span>
        </div>

        {/* Deficit warning if not enough funds */}
        {!hasSufficientBalance && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 dark:text-rose-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold">{t('user.shop.insufficientBalance')}</span>
              <p className="mt-0.5 text-[11px] leading-relaxed">
                {t('user.shop.chargeNeeded').replace('{amount}', formatToman(deficit))}
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 mt-2">
          {hasSufficientBalance ? (
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleConfirmOrder}
              className={`w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer shadow-md ${
                isDark
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {isProcessing ? (
                <span>{t('common.loading')}</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t('user.shop.confirmOrder')}</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                onClose();
                onGoToWallet();
              }}
              className="w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-slate-950 transition-all active:scale-[0.98] cursor-pointer shadow-md"
            >
              <Wallet className="w-4 h-4" />
              <span>{t('user.dashboard.quickTopup')}</span>
              <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
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
    </Modal>
  );
};
