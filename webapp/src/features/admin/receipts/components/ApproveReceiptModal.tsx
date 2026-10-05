import React from 'react';
import { CheckCircle2, Check } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
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

        <div className="flex items-center gap-2.5 pt-3 mt-4 border-t border-slate-200 dark:border-white/10">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={loading}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="success"
            className="flex-1"
            disabled={loading}
            loading={loading}
            onClick={() => onConfirm(receipt)}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{t('admin.receipts.approveConfirmBtn')}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
