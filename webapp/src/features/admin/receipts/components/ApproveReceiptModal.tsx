import React from 'react';
import { CheckCircle2, Check, RotateCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import type { TopupReceipt } from '@/shared/types/admin.js';

interface ApproveReceiptModalProps {
  receipt: TopupReceipt | null;
  onClose: () => void;
  onConfirm: (receipt: TopupReceipt) => void;
  loading?: boolean;
}

export const ApproveReceiptModal: React.FC<ApproveReceiptModalProps> = ({
  receipt,
  onClose,
  onConfirm,
  loading = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney } = useFormatters();
  const { isDark, subCardClass, textPrimary, textSecondary, textMuted } = useThemeTokens();

  if (!receipt) return null;

  return (
    <Modal isOpen={Boolean(receipt)} onClose={onClose} maxWidth="sm">
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
            {t('admin.receipts.approveConfirmTitle')}
          </h3>
        </div>

        <p className={`text-xs leading-relaxed m-0 ${textSecondary}`}>
          {t('admin.receipts.approveConfirmBody', {
            amount: `${formatMoney(receipt.amount)} ${t('common.currency')}`,
          })}
        </p>

        <div className={`p-3 rounded-xl border text-xs space-y-1 font-mono ${subCardClass}`}>
          <div className="flex justify-between">
            <span className={`font-sans ${textMuted}`}>{t('common.userCode')}</span>
            <span dir="ltr" className={textPrimary}>
              {receipt.telegramId}
            </span>
          </div>
          <div className="flex justify-between">
            <span className={`font-sans ${textMuted}`}>{t('common.receiptCode')}</span>
            <span dir="ltr" className={textPrimary}>
              {receipt.id}
            </span>
          </div>
        </div>

        <div className="modal-action mt-4 flex gap-2">
          <button
            type="button"
            className={`btn btn-ghost btn-sm flex-1 text-xs border rounded-xl cursor-pointer ${
              isDark ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-700'
            }`}
            onClick={onClose}
            disabled={loading}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-success btn-sm flex-1 text-xs text-white shadow-sm rounded-xl cursor-pointer"
            disabled={loading}
            onClick={() => onConfirm(receipt)}
          >
            {loading ? (
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>{t('admin.receipts.approveConfirmBtn')}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
