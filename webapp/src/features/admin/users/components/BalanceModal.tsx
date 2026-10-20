import React, { useState, useMemo, useEffect } from 'react';
import { Wallet, X, Check, Plus, Minus, Settings2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import type { UserProfile, BalanceOperation } from '@/shared/types/admin.js';

interface BalanceModalProps {
  user: UserProfile | null;
  onClose: () => void;
  onSubmit: (data: { operation: BalanceOperation; amount: number; reason: string }) => void;
  loading?: boolean;
}

export const BalanceModal: React.FC<BalanceModalProps> = ({
  user,
  onClose,
  onSubmit,
  loading = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber } = useFormatters();
  const { subCardClass, inputClass, textPrimary, textSecondary } = useThemeTokens();

  const [operation, setOperation] = useState<BalanceOperation>('add');
  const [amountStr, setAmountStr] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  // Reset form whenever a different user is opened: the parent closes via
  // setBalanceModalUser(null) which bypasses handleClose.
  useEffect(() => {
    setOperation('add');
    setAmountStr('');
    setReason('');
  }, [user?.telegramId]);

  // Strict integer parsing: require safe integer, allowing 0 only when operation is 'set'.
  const numAmount = Number(amountStr);
  const isValidAmount =
    amountStr.trim() !== '' &&
    Number.isSafeInteger(numAmount) &&
    (operation === 'set' ? numAmount >= 0 : numAmount > 0);

  const previewNewBalance = useMemo(() => {
    if (!user) return 0;
    const cur = user.balance;
    if (operation === 'add') return cur + numAmount;
    if (operation === 'deduct') return Math.max(0, cur - numAmount);
    return numAmount;
  }, [user, operation, numAmount]);

  if (!user) return null;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidAmount || !reason.trim()) return;
    onSubmit({ operation, amount: numAmount, reason: reason.trim() });
  };

  const handleClose = () => {
    setAmountStr('');
    setReason('');
    setOperation('add');
    onClose();
  };

  const quickAmounts = [50000, 100000, 200000, 500000, 1000000];
  const quickReasons = [
    t('admin.users.quickReasonCard'),
    t('admin.users.quickReasonCompensation'),
    t('admin.users.quickReasonAdjustment'),
  ];

  return (
    <Modal isOpen={Boolean(user)} onClose={handleClose} maxWidth="md" closeOnBackdrop={!loading}>
      <div className="space-y-4">
        {/* Modal Header with User Context */}
        <div className="flex items-center justify-between pb-3 border-b border-line/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 shadow-xs bg-brand/15 border-brand/25 text-brand`}
            >
              <Wallet className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className={`font-bold text-sm sm:text-base m-0 tracking-tight ${textPrimary}`}>
                {t('admin.modals.balanceTitle')}
              </h3>
              <div className="text-[11px] tnum text-brand truncate mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>{[user.firstName, user.lastName].filter(Boolean).join('') || '—'}</span>
                {user.username && <span dir="ltr">(@{user.username})</span>}
                <span className="opacity-40">·</span>
                <span dir="ltr">#{user.telegramId}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="p-1.5 rounded-xl text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
            onClick={handleClose}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-4">
          {/* Current Balance Card */}
          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs ${subCardClass}`}
          >
            <span className={textSecondary}>{t('admin.users.balanceCurLabel')}</span>
            <span className={`font-bold tnum text-sm sm:text-base ${textPrimary}`}>
              {formatMoney(user.balance)}
              {''}
              <span className="text-xs font-normal text-ink-muted">{t('common.currency')}</span>
            </span>
          </div>

          {/* Segmented Operation Selector */}
          <div className="space-y-1.5">
            <div
              className={`grid grid-cols-3 gap-1 p-1 rounded-xl border text-xs bg-surface/[0.03] border-line/[0.08]`}
            >
              <button
                type="button"
                className={`h-8.5 rounded-lg font-medium transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer select-none ${operation === 'add' ? 'bg-ok/20 text-ok font-semibold border border-ok/30 shadow-xs' : 'text-ink-muted hover:text-ink-soft'}`}
                onClick={() => setOperation('add')}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('admin.modals.balanceOpAdd')}</span>
              </button>

              <button
                type="button"
                className={`h-8.5 rounded-lg font-medium transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer select-none ${operation === 'deduct' ? 'bg-danger/20 text-danger font-semibold border border-danger/30 shadow-xs' : 'text-ink-muted hover:text-ink-soft'}`}
                onClick={() => setOperation('deduct')}
              >
                <Minus className="w-3.5 h-3.5" />
                <span>{t('admin.modals.balanceOpDeduct')}</span>
              </button>

              <button
                type="button"
                className={`h-8.5 rounded-lg font-medium transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer select-none ${operation === 'set' ? 'bg-brand/20 text-brand font-semibold border border-brand/30 shadow-xs' : 'text-ink-muted hover:text-ink-soft'}`}
                onClick={() => setOperation('set')}
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>{t('admin.modals.balanceOpSet')}</span>
              </button>
            </div>
          </div>

          {/* Amount Input & Grid Chips */}
          <div className="space-y-2">
            <label className={`text-xs font-semibold block ${textPrimary}`}>
              {t('admin.modals.balanceAmountLabel')}
            </label>
            <input
              type="text"
              inputMode="numeric"
              dir="ltr"
              required
              className={`w-full h-10 px-3.5 text-sm tnum rounded-xl border outline-none transition-all ${inputClass}`}
              placeholder={t('admin.modals.balanceAmountPlaceholder')}
              value={amountStr}
              onChange={(e) => {
                const normalized = normalizeInputDigits(e.target.value).replace(/[^0-9]/g, '');
                setAmountStr(normalized);
              }}
            />

            {/* Quick Amount Chips in Equal Columns */}
            <div className="grid grid-cols-5 gap-1 sm:gap-1.5 pt-0.5">
              {quickAmounts.map((quickAmt) => {
                const isSelected = numAmount === quickAmt;
                const label =
                  quickAmt >= 1000000
                    ? t('admin.users.quickAmountM', {
                        amount: formatNumber(quickAmt / 1000000),
                      })
                    : t('admin.users.quickAmountK', {
                        amount: formatNumber(quickAmt / 1000),
                      });

                return (
                  <button
                    key={quickAmt}
                    type="button"
                    className={`h-8 px-1 rounded-lg text-[11px] sm:text-xs font-medium transition-all active:scale-95 cursor-pointer border flex items-center justify-center select-none ${isSelected ? 'bg-brand/25 border-brand/40 text-brand font-bold shadow-xs' : 'bg-surface/[0.04] border-line/10 text-ink-soft hover:bg-surface/[0.08]'}`}
                    onClick={() => setAmountStr(String(quickAmt))}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Calculated Balance Preview Card */}
          {isValidAmount && (
            <div
              className={`p-3 rounded-xl border flex items-center justify-between text-xs transition-colors bg-brand/10 border-brand/20`}
            >
              <span className={'text-brand font-medium'}>
                {t('admin.users.balancePreviewLabel')}
              </span>
              <span className={`font-bold tnum text-sm sm:text-base ${textPrimary}`}>
                {formatMoney(previewNewBalance)}
                {''}
                <span className="text-xs font-normal opacity-70">{t('common.currency')}</span>
              </span>
            </div>
          )}

          {/* Reason Input & Quick Chips */}
          <div className="space-y-2">
            <label className={`text-xs font-semibold block ${textPrimary}`}>
              {t('admin.modals.balanceReasonLabel')}
            </label>
            <input
              type="text"
              required
              className={`w-full h-10 px-3.5 text-xs sm:text-sm rounded-xl border outline-none transition-all ${inputClass}`}
              placeholder={t('admin.modals.balanceReasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />

            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {quickReasons.map((quickReason) => {
                const isSelected = reason === quickReason;
                return (
                  <button
                    key={quickReason}
                    type="button"
                    className={`h-8 px-2.5 rounded-lg text-xs transition-all active:scale-95 cursor-pointer border select-none ${isSelected ? 'bg-brand/25 border-brand/40 text-brand font-semibold shadow-xs' : 'bg-surface/[0.04] border-line/10 text-ink-muted hover:bg-surface/[0.08]'}`}
                    onClick={() => setReason(quickReason)}
                  >
                    {quickReason}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Modal Action Buttons */}
          <div className="flex items-center gap-2.5 pt-3 mt-4 border-t border-line">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={handleClose}
              disabled={loading}
            >
              {t('common.cancel')}
            </Button>

            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={loading || !isValidAmount || !reason.trim()}
              loading={loading}
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {loading ? t('admin.modals.balanceSubmitting') : t('admin.modals.balanceSubmit')}
              </span>
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
