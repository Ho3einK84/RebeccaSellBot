import React, { useState, useMemo } from 'react';
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

  const numAmount = parseInt(amountStr, 10) || 0;

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
    if (numAmount < 0 || !reason.trim()) return;
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                isDark
                  ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-700'
              }`}
            >
              <Wallet className="w-5 h-5" />
            </div>
            <h3 className={`font-bold text-base m-0 ${textPrimary}`}>
              {t('admin.modals.balanceTitle')}
            </h3>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-xs cursor-pointer text-slate-400 hover:text-white"
            onClick={handleClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-4">
          {/* User Balance Info Card */}
          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs ${subCardClass}`}
          >
            <span className={textSecondary}>{t('admin.users.balanceCurLabel')}</span>
            <span className={`font-bold font-mono text-sm ${textPrimary}`}>
              {formatMoney(user.balance)} {t('common.currency')}
            </span>
          </div>

          {/* Segmented Operation Selector */}
          <div
            className={`grid grid-cols-3 gap-1 p-1 rounded-xl border text-xs ${
              isDark ? 'bg-white/[0.03] border-white/10' : 'bg-slate-100 border-slate-200'
            }`}
          >
            <button
              type="button"
              className={`btn btn-xs h-8 border-none rounded-lg cursor-pointer ${
                operation === 'add'
                  ? 'bg-emerald-600 text-white font-bold shadow-xs'
                  : isDark
                    ? 'btn-ghost text-slate-300'
                    : 'btn-ghost text-slate-700'
              }`}
              onClick={() => setOperation('add')}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('admin.modals.balanceOpAdd')}</span>
            </button>

            <button
              type="button"
              className={`btn btn-xs h-8 border-none rounded-lg cursor-pointer ${
                operation === 'deduct'
                  ? 'bg-rose-600 text-white font-bold shadow-xs'
                  : isDark
                    ? 'btn-ghost text-slate-300'
                    : 'btn-ghost text-slate-700'
              }`}
              onClick={() => setOperation('deduct')}
            >
              <Minus className="w-3.5 h-3.5" />
              <span>{t('admin.modals.balanceOpDeduct')}</span>
            </button>

            <button
              type="button"
              className={`btn btn-xs h-8 border-none rounded-lg cursor-pointer ${
                operation === 'set'
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : isDark
                    ? 'btn-ghost text-slate-300'
                    : 'btn-ghost text-slate-700'
              }`}
              onClick={() => setOperation('set')}
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>{t('admin.modals.balanceOpSet')}</span>
            </button>
          </div>

          {/* Amount Input */}
          <div className="space-y-1.5">
            <label className={`text-xs font-medium block ${textPrimary}`}>
              {t('admin.modals.balanceAmountLabel')}
            </label>
            <input
              type="number"
              min="0"
              required
              className={`input input-bordered w-full text-sm font-mono rounded-xl ${inputClass}`}
              placeholder={t('admin.modals.balanceAmountPlaceholder')}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
            />

            {/* Quick Amount Chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {quickAmounts.map((quickAmt) => (
                <button
                  key={quickAmt}
                  type="button"
                  className={`badge badge-sm py-1.5 px-2 text-[10px] font-mono cursor-pointer transition-all border ${
                    isDark
                      ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-indigo-600 hover:text-white'
                      : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-indigo-600 hover:text-white'
                  }`}
                  onClick={() => setAmountStr(String(quickAmt))}
                >
                  +{formatNumber(quickAmt / 1000)}k
                </button>
              ))}
            </div>
          </div>

          {/* Calculated Balance Preview */}
          {amountStr && (
            <div
              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                isDark ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-200'
              }`}
            >
              <span className={isDark ? 'text-indigo-300' : 'text-indigo-800'}>
                {t('admin.users.balancePreviewLabel')}
              </span>
              <span className={`font-bold font-mono text-sm ${textPrimary}`}>
                {formatMoney(previewNewBalance)} {t('common.currency')}
              </span>
            </div>
          )}

          {/* Reason Input & Quick Chips */}
          <div className="space-y-1.5">
            <label className={`text-xs font-medium block ${textPrimary}`}>
              {t('admin.modals.balanceReasonLabel')}
            </label>
            <input
              type="text"
              required
              className={`input input-bordered w-full text-xs rounded-xl ${inputClass}`}
              placeholder={t('admin.modals.balanceReasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />

            <div className="flex flex-wrap gap-1.5 pt-1">
              {quickReasons.map((quickReason) => (
                <button
                  key={quickReason}
                  type="button"
                  className={`badge badge-sm py-1.5 px-2 text-[10px] cursor-pointer transition-all border ${
                    isDark
                      ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/10'
                      : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                  }`}
                  onClick={() => setReason(quickReason)}
                >
                  {quickReason}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="modal-action mt-4 flex gap-2">
            <button
              type="button"
              className={`btn btn-ghost btn-sm flex-1 text-xs border rounded-xl cursor-pointer ${
                isDark ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-700'
              }`}
              onClick={handleClose}
              disabled={loading}
            >
              {t('common.cancel')}
            </button>

            <button
              type="submit"
              className="btn btn-primary btn-sm flex-1 text-xs text-white shadow-sm rounded-xl cursor-pointer"
              disabled={loading}
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
