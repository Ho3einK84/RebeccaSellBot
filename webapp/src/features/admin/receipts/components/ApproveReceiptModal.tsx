import React from 'react';
import { CheckCircle2, Check, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
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
  const { formatMoney, formatId, formatReceiptShortId } = useFormatters();
  const { textPrimary, textSecondary, textMuted } = useThemeTokens();

  if (!receipt) return null;

  const duplicateShortId = receipt.duplicateOfReceiptId
    ? formatReceiptShortId(receipt.duplicateOfReceiptId)
    : null;
  const hasDuplicateWarning = Boolean(receipt.duplicateOfReceiptId || receipt.duplicateWarning);

  return (
    <Modal
      isOpen={Boolean(receipt)}
      onClose={onClose}
      maxWidth="sm"
      closeOnBackdrop={!loading}
      title={t('admin.receipts.approveConfirmTitle')}
      icon={
        <IconTile tone="ok" size="sm">
          <CheckCircle2 />
        </IconTile>
      }
      footer={
        <div className="flex items-center gap-2.5">
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
      }
    >
      <div className="space-y-4">
        {hasDuplicateWarning && (
          <AlertBanner tone="warn" icon={<AlertTriangle />}>
            {duplicateShortId
              ? `${t('admin.receipts.duplicateWarningBadge')} — ${t('admin.receipts.duplicateOfLabel', { id: duplicateShortId })}`
              : receipt.duplicateWarning || t('admin.receipts.duplicateWarningBadge')}
          </AlertBanner>
        )}

        <p className={`text-xs leading-relaxed m-0 ${textSecondary}`}>
          {t('admin.receipts.approveConfirmBody', {
            amount: `${formatMoney(receipt.amount)} ${t('common.currency')}`,
          })}
        </p>

        <Card subCard padding="sm" className="text-xs space-y-1.5 tnum">
          <div className="flex justify-between gap-2">
            <span className={textMuted}>{t('common.userCode')}</span>
            <bdi dir="ltr" className={`tnum font-medium ${textPrimary}`}>
              #{formatId(receipt.telegramId)}
            </bdi>
          </div>
          <div className="flex justify-between gap-2">
            <span className={textMuted}>{t('common.receiptCode')}</span>
            <bdi dir="ltr" className={`tnum font-medium truncate ${textPrimary}`}>
              #{formatReceiptShortId(receipt.id)}
            </bdi>
          </div>
        </Card>
      </div>
    </Modal>
  );
};
