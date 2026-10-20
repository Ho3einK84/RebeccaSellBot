import React from 'react';
import {
  Receipt,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import type { TopupReceipt } from '@/shared/types/admin.js';

interface ReceiptDetailModalProps {
  receipt: TopupReceipt | null;
  onClose: () => void;
  onApprove?: (receipt: TopupReceipt) => void;
  onReject?: (receipt: TopupReceipt) => void;
  onViewPhoto?: (receipt: TopupReceipt) => void;
  onInspectUser?: (telegramId: number) => void;
  loading?: boolean;
}

export const ReceiptDetailModal: React.FC<ReceiptDetailModalProps> = ({
  receipt,
  onClose,
  onApprove,
  onReject,
  onViewPhoto,
  onInspectUser,
  loading = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatIsoDate } = useFormatters();
  const { subCardClass, textPrimary, textSecondary, textMuted } = useThemeTokens();

  if (!receipt) return null;

  const isPending = receipt.status === 'pending';
  const isApproved = receipt.status === 'approved';
  const isRejected = receipt.status === 'rejected';

  const userDisplayName =
    [receipt.user?.firstName, receipt.user?.lastName].filter(Boolean).join('') ||
    receipt.user?.username ||
    `ID: ${receipt.telegramId}`;

  return (
    <Modal
      isOpen={Boolean(receipt)}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span>{t('admin.receipts.detailModalTitle')}</span>
          <span dir="ltr" className="tnum text-xs text-brand font-normal">
            #{receipt.id.slice(-8)}
          </span>
        </div>
      }
      icon={<Receipt className="w-5 h-5 text-brand" />}
      maxWidth="md"
    >
      <div className="space-y-4">
        {/* Top Summary Banner */}
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${isApproved ? 'bg-ok/10 border-ok/25' : isRejected ? 'bg-danger/10 border-danger/25' : 'bg-warn/10 border-warn/25'}`}
        >
          <div className="space-y-1">
            <span className={`text-xs block ${textMuted}`}>{t('common.amount')}</span>
            <div
              className={`text-xl sm:text-2xl font-bold tnum ${isApproved ? 'text-ok' : isRejected ? 'text-danger' : 'text-warn'}`}
            >
              {formatMoney(receipt.amount)} {t('common.currency')}
            </div>
          </div>

          <Badge
            variant={isApproved ? 'success' : isRejected ? 'error' : 'warning'}
            dot
            pulse={isPending}
            className="text-xs px-3 py-1 font-semibold"
          >
            {isApproved
              ? t('common.statusApproved')
              : isRejected
                ? t('common.statusRejected')
                : t('common.statusPending')}
          </Badge>
        </div>

        {/* User Information Card */}
        <div className={`p-3.5 rounded-xl border space-y-2.5 text-xs ${subCardClass}`}>
          <div className="flex items-center justify-between border-b pb-2 border-line/60">
            <div className="flex items-center gap-2 font-semibold">
              <User className="w-4 h-4 text-brand" />
              <span className={textPrimary}>{t('common.customer')}</span>
            </div>
            {onInspectUser && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-brand hover:text-brand transition-colors cursor-pointer"
                onClick={() => {
                  onClose();
                  onInspectUser(receipt.telegramId);
                }}
              >
                <span>{t('admin.users.btnDetails')}</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className={`block ${textMuted}`}>{t('admin.users.colName')}</span>
              <span className={`font-semibold ${textPrimary}`}>{userDisplayName}</span>
            </div>
            <div>
              <span className={`block ${textMuted}`}>{t('admin.users.colId')}</span>
              <span dir="ltr" className={`tnum ${textPrimary}`}>
                {receipt.telegramId}
              </span>
            </div>
            {receipt.user?.username && (
              <div>
                <span className={`block ${textMuted}`}>{t('admin.users.colUsername')}</span>
                <span dir="ltr" className="tnum text-brand">
                  @{receipt.user.username}
                </span>
              </div>
            )}
            {receipt.user?.balance !== undefined && (
              <div>
                <span className={`block ${textMuted}`}>{t('admin.receipts.userBalance')}</span>
                <span className={`tnum font-semibold ${textPrimary}`}>
                  {formatMoney(receipt.user.balance)} {t('common.currency')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Receipt Audit & Metadata */}
        <div className={`p-3.5 rounded-xl border space-y-2 text-xs ${subCardClass}`}>
          <div className="flex justify-between items-center text-[11px]">
            <span className={`flex items-center gap-1.5 ${textMuted}`}>
              <FileText className="w-3.5 h-3.5" />
              <span>{t('common.receiptCode')}</span>
            </span>
            <span dir="ltr" className={`tnum ${textPrimary}`}>
              {receipt.id}
            </span>
          </div>

          <div className="flex justify-between items-center text-[11px]">
            <span className={`flex items-center gap-1.5 ${textMuted}`}>
              <Clock className="w-3.5 h-3.5" />
              <span>{t('admin.receipts.createdAtLabel')}</span>
            </span>
            <span dir="ltr" className={`tnum ${textSecondary}`}>
              {formatIsoDate(receipt.createdAt)}
            </span>
          </div>

          {receipt.reviewedBy && (
            <div className="flex justify-between items-center text-[11px]">
              <span className={`flex items-center gap-1.5 ${textMuted}`}>
                <ShieldCheck className="w-3.5 h-3.5 text-ok" />
                <span>{t('admin.receipts.reviewedBy')}</span>
              </span>
              <span dir="ltr" className={`tnum ${textPrimary}`}>
                {receipt.reviewedBy}
              </span>
            </div>
          )}

          {receipt.updatedAt && !isPending && (
            <div className="flex justify-between items-center text-[11px]">
              <span className={`flex items-center gap-1.5 ${textMuted}`}>
                <Clock className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.reviewedAt')}</span>
              </span>
              <span dir="ltr" className={`tnum ${textSecondary}`}>
                {formatIsoDate(receipt.updatedAt)}
              </span>
            </div>
          )}

          {isRejected && receipt.rejectReason && (
            <div className="flex flex-col gap-1 pt-1.5 border-t border-line/50">
              <span className="font-sans flex items-center gap-1 text-danger font-semibold text-[11px]">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.rejectionReason')}:</span>
              </span>
              <span className="text-danger font-sans text-xs bg-danger/10 p-2 rounded-lg">
                {receipt.rejectReason}
              </span>
            </div>
          )}
        </div>

        {/* Photo Proof Action */}
        {receipt.photoFileId && onViewPhoto && (
          <button
            type="button"
            className={`w-full h-11 px-4 rounded-xl font-semibold text-xs border flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer bg-brand/15 hover:bg-brand/25 border-brand/30 text-brand`}
            onClick={() => onViewPhoto(receipt)}
          >
            <ImageIcon className="w-4 h-4" />
            <span>{t('admin.receipts.viewPhoto')}</span>
          </button>
        )}

        {/* Bottom Actions for Pending */}
        <div className="modal-action mt-5 flex gap-2.5">
          {isPending && onApprove && onReject ? (
            <>
              <Button
                type="button"
                variant="danger"
                size="md"
                className="flex-1"
                onClick={() => onReject(receipt)}
                disabled={loading}
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.reject')}</span>
              </Button>

              <Button
                type="button"
                variant="success"
                size="md"
                className="flex-1"
                onClick={() => onApprove(receipt)}
                disabled={loading}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.approve')}</span>
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="w-full"
              onClick={onClose}
            >
              {t('common.close')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
