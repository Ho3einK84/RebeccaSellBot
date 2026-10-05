import React from 'react';
import { CheckCircle2, Check, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.receipts.batchApproveTitle')}
      icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />}
      maxWidth="md"
      closeOnBackdrop={!loading}
    >
      <div className="space-y-4">
        {/* Warning Banner */}
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
                <span dir="ltr" className={`font-mono ${textMuted}`}>
                  #{rec.id.slice(-6)}
                </span>
                <span dir="ltr" className={`font-mono ${textSecondary}`}>
                  {t('common.idLabel')} {rec.telegramId}
                </span>
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
            onClick={() => onConfirm(receipts)}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{t('admin.receipts.batchApproveConfirmBtn')}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
