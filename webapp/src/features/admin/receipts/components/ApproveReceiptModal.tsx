import React from 'react';
import { CheckCircle2, Check } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
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
  const { textPrimary, textSecondary, textMuted } = useThemeTokens();

  if (!receipt) return null;

  return (
    <Modal isOpen={Boolean(receipt)} onClose={onClose} maxWidth="sm">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <IconTile tone="ok" size="md">
            <CheckCircle2 />
          </IconTile>
          <h3 className={`font-semibold text-base m-0 ${textPrimary}`}>
            {t('admin.receipts.approveConfirmTitle')}
          </h3>
        </div>

        <p className={`text-xs leading-relaxed m-0 ${textSecondary}`}>
          {t('admin.receipts.approveConfirmBody', {
            amount: `${formatMoney(receipt.amount)} ${t('common.currency')}`,
          })}
        </p>

        <Card subCard padding="sm" className="text-xs space-y-1.5 tnum">
          <div className="flex justify-between gap-2">
            <span className={textMuted}>{t('common.userCode')}</span>
            <bdi dir="ltr" className={`font-mono ${textPrimary}`}>
              {receipt.telegramId}
            </bdi>
          </div>
          <div className="flex justify-between gap-2">
            <span className={textMuted}>{t('common.receiptCode')}</span>
            <bdi dir="ltr" className={`font-mono truncate ${textPrimary}`}>
              {receipt.id}
            </bdi>
          </div>
        </Card>

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
