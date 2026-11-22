import React, { useState, useEffect } from 'react';
import { Ban, ShieldAlert } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Switch } from '@/shared/components/ui/Switch.js';
import { Textarea } from '@/shared/components/ui/Input.js';
import type { TopupReceipt } from '@/shared/types/admin.js';

interface VoidReceiptModalProps {
  receipt: TopupReceipt | null;
  onClose: () => void;
  onConfirm: (
    receipt: TopupReceipt,
    options: { reason?: string; disablePurchasedConfigs: boolean }
  ) => void;
  loading?: boolean;
}

export const VoidReceiptModal: React.FC<VoidReceiptModalProps> = ({
  receipt,
  onClose,
  onConfirm,
  loading = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatId, formatReceiptShortId } = useFormatters();
  const [reason, setReason] = useState('');
  const [disablePurchasedConfigs, setDisablePurchasedConfigs] = useState(true);

  useEffect(() => {
    setReason('');
    setDisablePurchasedConfigs(true);
  }, [receipt?.id]);

  if (!receipt) return null;

  const handleClose = () => {
    setReason('');
    setDisablePurchasedConfigs(true);
    onClose();
  };

  return (
    <Modal
      isOpen={Boolean(receipt)}
      onClose={handleClose}
      maxWidth="md"
      closeOnBackdrop={!loading}
      title={t('admin.receipts.voidModalTitle')}
      subtitle={
        <bdi dir="ltr" className="tnum font-medium text-danger-fg">
          #{formatReceiptShortId(receipt.id)}
        </bdi>
      }
      icon={
        <IconTile tone="danger" size="sm">
          <Ban />
        </IconTile>
      }
      footer={
        <div className="flex items-center gap-2.5">
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
            type="button"
            variant="danger"
            className="flex-1"
            loading={loading}
            disabled={loading}
            onClick={() =>
              onConfirm(receipt, {
                reason: reason.trim() || undefined,
                disablePurchasedConfigs,
              })
            }
          >
            <Ban className="w-3.5 h-3.5" />
            <span>
              {loading ? t('admin.receipts.voidSubmitting') : t('admin.receipts.voidConfirmBtn')}
            </span>
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-start">
        <p className="text-xs leading-relaxed text-ink-soft m-0">
          {t('admin.receipts.voidModalBody', {
            amount: `${formatMoney(receipt.amount)} ${t('common.currency')}`,
          })}
        </p>

        <Card subCard padding="sm" className="text-xs space-y-1.5 tnum">
          <div className="flex justify-between gap-2">
            <span className="text-ink-muted">{t('common.userCode')}</span>
            <bdi dir="ltr" className="tnum font-medium text-ink">
              #{formatId(receipt.telegramId)}
            </bdi>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-ink-muted">{t('common.receiptCode')}</span>
            <bdi dir="ltr" className="tnum font-medium text-ink">
              #{formatReceiptShortId(receipt.id)}
            </bdi>
          </div>
        </Card>

        <Card subCard padding="sm" className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <ShieldAlert className="w-3.5 h-3.5 text-warn-fg shrink-0" />
              <span>{t('admin.receipts.voidDisableConfigsLabel')}</span>
            </div>
            <p className="text-[11px] text-ink-muted leading-relaxed m-0">
              {t('admin.receipts.voidDisableConfigsHint')}
            </p>
          </div>
          <Switch
            checked={disablePurchasedConfigs}
            onChange={setDisablePurchasedConfigs}
            ariaLabel={t('admin.receipts.voidDisableConfigsLabel')}
          />
        </Card>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold block text-ink">
            {t('admin.receipts.voidReasonLabel')}
          </label>
          <Textarea
            rows={2}
            placeholder={t('admin.receipts.voidReasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};
