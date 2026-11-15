import React from 'react';
import { CheckCircle2, Check, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
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
  const { formatMoney, formatNumber } = useFormatters();
  const { textPrimary, textSecondary, textMuted } = useThemeTokens();

  if (!isOpen || receipts.length === 0) return null;

  const totalAmount = receipts.reduce((sum, r) => sum + r.amount, 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.receipts.batchApproveTitle')}
      icon={<CheckCircle2 className="w-5 h-5 text-ok-fg" />}
      maxWidth="md"
      closeOnBackdrop={!loading}
    >
      <div className="space-y-4">
        <div className="p-3.5 rounded-tile border flex items-start gap-2.5 text-xs bg-warn-soft border-warn/25 text-warn-fg">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="m-0 leading-relaxed">
            {t('admin.receipts.batchApproveConfirmBody', {
              count: formatNumber(receipts.length),
              amount: `${formatMoney(totalAmount)} ${t('common.currency')}`,
            })}
          </p>
        </div>

        <Card subCard padding="sm" className="max-h-52 overflow-y-auto space-y-1.5 text-xs">
          {receipts.map((rec) => (
            <div
              key={rec.id}
              className="flex items-center justify-between p-2 rounded-ctl bg-surface border border-line tnum text-[11px]"
            >
              <div className="flex items-center gap-2">
                <bdi dir="ltr" className={`font-mono tnum ${textMuted}`}>
                  #{rec.id.slice(-6)}
                </bdi>
                <bdi dir="ltr" className={`tnum ${textSecondary}`}>
                  {t('common.idLabel')} {rec.telegramId}
                </bdi>
              </div>
              <span className="font-semibold text-ok-fg">
                <bdi dir="ltr">{formatMoney(rec.amount)}</bdi> {t('common.currency')}
              </span>
            </div>
          ))}
        </Card>

        <div className="flex items-center justify-between px-1 text-xs">
          <span className={textMuted}>
            {t('admin.receipts.batchSelectedCount', { count: formatNumber(receipts.length) })}
          </span>
          <span className={`font-semibold tnum text-sm ${textPrimary}`}>
            <bdi dir="ltr">{formatMoney(totalAmount)}</bdi> {t('common.currency')}
          </span>
        </div>

        <div className="flex items-center gap-2.5 pt-3 mt-4 border-t border-line">
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
