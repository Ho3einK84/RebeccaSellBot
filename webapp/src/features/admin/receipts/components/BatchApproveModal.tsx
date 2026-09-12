import React from 'react';
import { CheckCircle2, Check, RotateCw, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import type { TopupReceipt } from '@/shared/types/admin.js';

interface BatchApproveModalProps {
  receipts: TopupReceipt[];
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (receipts: TopupReceipt[]) => void;
  loading?: boolean;
}

export const BatchApproveModal: React.FC<BatchApproveModalProps> = ({
  receipts,
  isOpen,
  onClose,
  onConfirm,
  loading = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney } = useFormatters();
  const { isDark, subCardClass, textPrimary, textSecondary, textMuted } = useThemeTokens();

  if (!isOpen || receipts.length === 0) return null;

  const totalAmount = receipts.reduce((sum, r) => sum + r.amount, 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="md">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
              isDark
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-emerald-50 border-emerald-200 text-emerald-600'
            }`}
          >
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <h3 className={`font-bold text-base m-0 ${textPrimary}`}>
            {t('admin.receipts.batchApproveTitle')}
          </h3>
        </div>

        <div
          className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs ${
            isDark
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="m-0 leading-relaxed">
            {t('admin.receipts.batchApproveConfirmBody', {
              count: String(receipts.length),
              amount: `${formatMoney(totalAmount)} ${t('common.currency')}`,
            })}
          </p>
        </div>

        {/* Selected Receipts List */}
        <div
          className={`max-h-52 overflow-y-auto rounded-xl border p-2.5 space-y-1.5 text-xs ${subCardClass}`}
        >
          {receipts.map((rec) => (
            <div
              key={rec.id}
              className="flex items-center justify-between p-2 rounded-lg bg-black/5 dark:bg-white/[0.03] font-mono text-[11px]"
            >
              <div className="flex items-center gap-2">
                <span className={`font-sans ${textMuted}`}>#{rec.id.slice(-6)}</span>
                <span className={textSecondary}>ID: {rec.telegramId}</span>
              </div>
              <span className={`font-bold ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                {formatMoney(rec.amount)} {t('common.currency')}
              </span>
            </div>
          ))}
        </div>

        {/* Total Summary */}
        <div className="flex items-center justify-between px-1 text-xs">
          <span className={textMuted}>
            {t('admin.receipts.batchSelectedCount', { count: String(receipts.length) })}
          </span>
          <span className={`font-bold font-mono text-sm ${textPrimary}`}>
            {formatMoney(totalAmount)} {t('common.currency')}
          </span>
        </div>

        <div className="modal-action mt-5 flex gap-2.5">
          <button
            type="button"
            className={`flex-1 h-10 px-4 rounded-xl text-xs font-medium border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center ${
              isDark
                ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 shadow-xs'
            }`}
            onClick={onClose}
            disabled={loading}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`flex-1 h-10 px-4 rounded-xl font-semibold text-xs border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 ${
              isDark
                ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/30 text-emerald-300 shadow-xs'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600 shadow-xs'
            }`}
            disabled={loading}
            onClick={() => onConfirm(receipts)}
          >
            {loading ? (
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>{t('admin.receipts.batchApproveConfirmBtn')}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
