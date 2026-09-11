import React, { useState, useMemo, useEffect } from 'react';
import { Wallet, X, Check, RotateCw, Plus, Minus, Settings2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
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
  const { isDark, subCardClass, inputClass, textPrimary, textSecondary } = useThemeTokens();

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

  // Strict integer parsing: parseInt("1.9") → 1 silently truncates, and
  // "" → 0 would submit a useless zero adjustment. Require a positive
  // safe integer.
  const numAmount = Number(amountStr);
  const isValidAmount = Number.isSafeInteger(numAmount) && numAmount > 0;

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
    <Modal isOpen={Boolean(user)} onClose={handleClose} maxWidth="md">
      <div className="space-y-4">
        {/* Modal Header with User Context */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200/60 dark:border-white/[0.06]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 shadow-xs ${
                isDark
                  ? 'bg-indigo-500/15 border-indigo-500/25 text-indigo-400'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-700'
              }`}
            >
              <Wallet className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className={`font-bold text-sm sm:text-base m-0 tracking-tight ${textPrimary}`}>
                {t('admin.modals.balanceTitle')}
              </h3>
              <div className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 truncate mt-0.5">
                {[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}
                {user.username ? ` (@${user.username})` : ''} · #{user.telegramId}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
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
            <span className={`font-bold font-mono text-sm sm:text-base ${textPrimary}`}>
              {formatMoney(user.balance)}{' '}
              <span className="text-xs font-normal text-slate-400">{t('common.currency')}</span>
            </span>
          </div>

          {/* Segmented Operation Selector */}
          <div className="space-y-1.5">
            <div
              className={`grid grid-cols-3 gap-1 p-1 rounded-xl border text-xs ${
                isDark ? 'bg-white/[0.03] border-white/[0.08]' : 'bg-slate-100 border-slate-200/80'
              }`}
            >
              <button
                type="button"
                className={`h-8.5 rounded-lg font-medium transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer select-none ${
                  operation === 'add'
                    ? isDark
                      ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30 shadow-xs'
                      : 'bg-white text-emerald-700 font-semibold shadow-xs border border-emerald-200'
                    : isDark
                      ? 'text-zinc-400 hover:text-zinc-200'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
                onClick={() => setOperation('add')}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('admin.modals.balanceOpAdd')}</span>
              </button>

              <button
                type="button"
                className={`h-8.5 rounded-lg font-medium transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer select-none ${
                  operation === 'deduct'
                    ? isDark
                      ? 'bg-rose-500/20 text-rose-300 font-semibold border border-rose-500/30 shadow-xs'
                      : 'bg-white text-rose-700 font-semibold shadow-xs border border-rose-200'
                    : isDark
                      ? 'text-zinc-400 hover:text-zinc-200'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
                onClick={() => setOperation('deduct')}
              >
                <Minus className="w-3.5 h-3.5" />
                <span>{t('admin.modals.balanceOpDeduct')}</span>
              </button>

              <button
                type="button"
                className={`h-8.5 rounded-lg font-medium transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer select-none ${
                  operation === 'set'
                    ? isDark
                      ? 'bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30 shadow-xs'
                      : 'bg-white text-indigo-700 font-semibold shadow-xs border border-indigo-200'
                    : isDark
                      ? 'text-zinc-400 hover:text-zinc-200'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
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
              type="number"
              min="0"
              required
              className={`w-full h-10 px-3.5 text-sm font-mono rounded-xl border outline-none transition-all ${inputClass}`}
              placeholder={t('admin.modals.balanceAmountPlaceholder')}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
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
                    className={`h-8 px-1 rounded-lg text-[11px] sm:text-xs font-medium transition-all active:scale-95 cursor-pointer border flex items-center justify-center select-none ${
                      isSelected
                        ? isDark
                          ? 'bg-indigo-500/25 border-indigo-500/40 text-indigo-300 font-bold shadow-xs'
                          : 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-xs'
                        : isDark
                          ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]'
                          : 'bg-slate-50 border-slate-200/80 text-slate-700 hover:bg-slate-100'
                    }`}
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
              className={`p-3 rounded-xl border flex items-center justify-between text-xs transition-colors ${
                isDark
                  ? 'bg-indigo-500/10 border-indigo-500/20'
                  : 'bg-indigo-50/70 border-indigo-200/80'
              }`}
            >
              <span
                className={isDark ? 'text-indigo-300 font-medium' : 'text-indigo-800 font-medium'}
              >
                {t('admin.users.balancePreviewLabel')}
              </span>
              <span className={`font-bold font-mono text-sm sm:text-base ${textPrimary}`}>
                {formatMoney(previewNewBalance)}{' '}
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
                    className={`h-8 px-2.5 rounded-lg text-xs transition-all active:scale-95 cursor-pointer border select-none ${
                      isSelected
                        ? isDark
                          ? 'bg-indigo-500/25 border-indigo-500/40 text-indigo-300 font-semibold shadow-xs'
                          : 'bg-indigo-50 border-indigo-300 text-indigo-700 font-semibold shadow-xs'
                        : isDark
                          ? 'bg-white/[0.04] border-white/10 text-zinc-400 hover:bg-white/[0.08]'
                          : 'bg-slate-50 border-slate-200/80 text-slate-600 hover:bg-slate-100'
                    }`}
                    onClick={() => setReason(quickReason)}
                  >
                    {quickReason}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Modal Action Buttons */}
          <div className="modal-action mt-5 flex gap-2.5">
            <button
              type="button"
              className={`flex-1 h-10 px-4 rounded-xl text-xs font-medium border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-xs'
              }`}
              onClick={handleClose}
              disabled={loading}
            >
              {t('common.cancel')}
            </button>

            <button
              type="submit"
              className={`flex-1 h-10 px-4 rounded-xl font-semibold text-xs transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                isDark
                  ? 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-xs'
                  : 'bg-slate-900 hover:bg-slate-800 text-white shadow-xs'
              }`}
              disabled={loading || !isValidAmount || !reason.trim()}
            >
              {loading ? (
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>
                {loading ? t('admin.modals.balanceSubmitting') : t('admin.modals.balanceSubmit')}
              </span>
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
