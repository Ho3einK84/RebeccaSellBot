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
  AlertTriangle,
  Ban,
  FileText,
  CreditCard,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import type { TopupReceipt } from '@/shared/types/admin.js';

interface ReceiptDetailModalProps {
  receipt: TopupReceipt | null;
  onClose: () => void;
  onApprove?: (receipt: TopupReceipt) => void;
  onReject?: (receipt: TopupReceipt) => void;
  onVoid?: (receipt: TopupReceipt) => void;
  onViewPhoto?: (receipt: TopupReceipt) => void;
  onInspectUser?: (telegramId: number) => void;
  loading?: boolean;
}

export const ReceiptDetailModal: React.FC<ReceiptDetailModalProps> = ({
  receipt,
  onClose,
  onApprove,
  onReject,
  onVoid,
  onViewPhoto,
  onInspectUser,
  loading = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatId, formatIsoDate, formatReceiptShortId, sanitizeDisplayName } =
    useFormatters();
  const { textPrimary, textSecondary, textMuted } = useThemeTokens();

  if (!receipt) return null;

  const isPending = receipt.status === 'pending';
  const isApproved = receipt.status === 'approved';
  const isRejected = receipt.status === 'rejected';
  const isVoided = receipt.status === 'voided';

  const { displayName: userDisplayName } = sanitizeDisplayName(
    receipt.user?.firstName,
    receipt.user?.lastName,
    receipt.user?.username
      ? `@${receipt.user.username}`
      : `${t('common.idLabel')} ${formatId(receipt.telegramId)}`
  );

  const duplicateShortId = receipt.duplicateOfReceiptId
    ? formatReceiptShortId(receipt.duplicateOfReceiptId)
    : null;
  const hasDuplicateWarning = Boolean(receipt.duplicateOfReceiptId || receipt.duplicateWarning);

  return (
    <Modal
      isOpen={Boolean(receipt)}
      onClose={onClose}
      title={t('admin.receipts.detailModalTitle')}
      subtitle={
        <bdi dir="ltr" className="tnum font-medium text-brand-fg">
          #{formatReceiptShortId(receipt.id)}
        </bdi>
      }
      icon={
        <IconTile tone="brand" size="sm">
          <Receipt />
        </IconTile>
      }
      maxWidth="md"
      footer={
        isPending && onApprove && onReject ? (
          <div className="flex gap-2.5">
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
          </div>
        ) : isApproved && onVoid ? (
          <div className="flex gap-2.5">
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="flex-1"
              onClick={() => onVoid(receipt)}
              disabled={loading}
            >
              <Ban className="w-3.5 h-3.5" />
              <span>{t('admin.receipts.voidBtn')}</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={onClose}
            >
              {t('common.close')}
            </Button>
          </div>
        ) : (
          <Button type="button" variant="secondary" size="sm" block onClick={onClose}>
            {t('common.close')}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {/* Top Summary Banner */}
        <div
          className={`p-4 rounded-tile border flex items-center justify-between gap-3 ${
            isApproved
              ? 'bg-ok-soft border-ok/25'
              : isRejected
                ? 'bg-danger-soft border-danger/25'
                : isVoided
                  ? 'bg-surface-2 border-line-strong'
                  : 'bg-warn-soft border-warn/25'
          }`}
        >
          <div className="space-y-1">
            <span className={`text-xs block ${textMuted}`}>{t('common.amount')}</span>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <bdi
                dir="ltr"
                className={`text-xl sm:text-2xl font-bold tnum ${
                  isApproved
                    ? 'text-ok-fg'
                    : isRejected
                      ? 'text-danger-fg'
                      : isVoided
                        ? 'text-ink-muted line-through'
                        : 'text-warn-fg'
                }`}
              >
                {formatMoney(receipt.amount)}
              </bdi>
              <span className="text-xs font-normal text-ink-muted">{t('common.currency')}</span>
            </div>
          </div>

          <Badge
            variant={
              isApproved ? 'success' : isRejected ? 'error' : isVoided ? 'neutral' : 'warning'
            }
            dot
            className="text-xs px-3 py-1 font-semibold"
          >
            {isApproved
              ? t('common.statusApproved')
              : isRejected
                ? t('common.statusRejected')
                : isVoided
                  ? t('common.statusVoided')
                  : t('common.statusPending')}
          </Badge>
        </div>

        {hasDuplicateWarning && (
          <AlertBanner tone="warn" icon={<AlertTriangle />}>
            {duplicateShortId
              ? `${t('admin.receipts.duplicateWarningBadge')} — ${t('admin.receipts.duplicateOfLabel', { id: duplicateShortId })}`
              : receipt.duplicateWarning || t('admin.receipts.duplicateWarningBadge')}
          </AlertBanner>
        )}

        {/* User Information Card */}
        <Card subCard padding="md" className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between border-b pb-2 border-line">
            <div className="flex items-center gap-2 font-semibold">
              <User className="w-4 h-4 text-brand-fg" />
              <span className={textPrimary}>{t('common.customer')}</span>
            </div>
            {onInspectUser && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-brand-fg hover:underline cursor-pointer"
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

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div>
              <span className={`block text-[11px] ${textMuted}`}>{t('admin.users.colName')}</span>
              <span className={`font-semibold ${textPrimary}`}>{userDisplayName}</span>
            </div>
            <div>
              <span className={`block text-[11px] ${textMuted}`}>{t('admin.users.colId')}</span>
              <bdi dir="ltr" className={`tnum font-semibold ${textPrimary}`}>
                #{formatId(receipt.telegramId)}
              </bdi>
            </div>
            {receipt.user?.username && (
              <div>
                <span className={`block text-[11px] ${textMuted}`}>
                  {t('admin.users.colUsername')}
                </span>
                <bdi dir="ltr" className="tnum text-brand-fg font-medium">
                  @{receipt.user.username}
                </bdi>
              </div>
            )}
            {receipt.user?.balance !== undefined && (
              <div>
                <span className={`block text-[11px] ${textMuted}`}>
                  {t('admin.receipts.userBalance')}
                </span>
                <span className={`tnum font-semibold ${textPrimary}`}>
                  <bdi dir="ltr">{formatMoney(receipt.user.balance)}</bdi>{' '}
                  <span className="font-normal text-[11px] text-ink-muted">
                    {t('common.currency')}
                  </span>
                </span>
              </div>
            )}
          </div>
        </Card>

        {/* Receipt Audit & Metadata */}
        <Card subCard padding="md" className="space-y-2 text-xs">
          <div className="flex justify-between items-center text-[11px]">
            <span className={`flex items-center gap-1.5 ${textMuted}`}>
              <FileText className="w-3.5 h-3.5" />
              <span>{t('common.receiptCode')}</span>
            </span>
            <bdi dir="ltr" className={`tnum font-medium ${textPrimary}`}>
              #{formatId(receipt.id)}
            </bdi>
          </div>

          {(receipt.cardSummary || receipt.cardNumber) && (
            <div className="flex justify-between items-center text-[11px] gap-2">
              <span className={`flex items-center gap-1.5 shrink-0 ${textMuted}`}>
                <CreditCard className="w-3.5 h-3.5 text-warn-fg" />
                <span>{t('admin.receipts.destinationCard')}</span>
              </span>
              <span className={`font-medium text-end truncate ${textPrimary}`}>
                {receipt.cardSummary || receipt.cardNumber}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center text-[11px]">
            <span className={`flex items-center gap-1.5 ${textMuted}`}>
              <Clock className="w-3.5 h-3.5" />
              <span>{t('admin.receipts.createdAtLabel')}</span>
            </span>
            <bdi dir="ltr" className={`tnum ${textSecondary}`}>
              {formatIsoDate(receipt.createdAt)}
            </bdi>
          </div>

          {receipt.reviewedBy && (
            <div className="flex justify-between items-center text-[11px]">
              <span className={`flex items-center gap-1.5 ${textMuted}`}>
                <ShieldCheck className="w-3.5 h-3.5 text-ok-fg" />
                <span>{t('admin.receipts.reviewedBy')}</span>
              </span>
              <bdi dir="ltr" className={`tnum font-medium ${textPrimary}`}>
                #{formatId(receipt.reviewedBy)}
              </bdi>
            </div>
          )}

          {receipt.updatedAt && !isPending && (
            <div className="flex justify-between items-center text-[11px]">
              <span className={`flex items-center gap-1.5 ${textMuted}`}>
                <Clock className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.reviewedAt')}</span>
              </span>
              <bdi dir="ltr" className={`tnum ${textSecondary}`}>
                {formatIsoDate(receipt.updatedAt)}
              </bdi>
            </div>
          )}

          {isRejected && receipt.rejectReason && (
            <div className="flex flex-col gap-1 pt-2 border-t border-line">
              <span className="flex items-center gap-1 text-danger-fg font-semibold text-[11px]">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.rejectionReason')}:</span>
              </span>
              <span className="text-danger-fg text-xs bg-danger-soft border border-danger/20 p-2 rounded-ctl">
                {receipt.rejectReason}
              </span>
            </div>
          )}

          {isVoided && (receipt.voidedBy || receipt.voidedAt || receipt.voidReason) && (
            <div className="flex flex-col gap-1.5 pt-2 border-t border-line">
              {receipt.voidedBy && (
                <div className="flex justify-between items-center text-[11px]">
                  <span className={`flex items-center gap-1.5 ${textMuted}`}>
                    <Ban className="w-3.5 h-3.5 text-danger-fg" />
                    <span>{t('admin.receipts.voidedBy')}</span>
                  </span>
                  <bdi dir="ltr" className={`tnum font-medium ${textPrimary}`}>
                    #{formatId(receipt.voidedBy)}
                  </bdi>
                </div>
              )}
              {receipt.voidedAt && (
                <div className="flex justify-between items-center text-[11px]">
                  <span className={`flex items-center gap-1.5 ${textMuted}`}>
                    <Clock className="w-3.5 h-3.5" />
                    <span>{t('admin.receipts.voidedAt')}</span>
                  </span>
                  <bdi dir="ltr" className={`tnum ${textSecondary}`}>
                    {formatIsoDate(receipt.voidedAt)}
                  </bdi>
                </div>
              )}
              {receipt.voidReason && (
                <span className="text-ink-soft text-xs bg-surface border border-line p-2 rounded-ctl">
                  {t('admin.receipts.voidReason')}: {receipt.voidReason}
                </span>
              )}
            </div>
          )}
        </Card>

        {receipt.photoFileId && onViewPhoto && (
          <Button
            type="button"
            variant="tonal"
            size="md"
            block
            onClick={() => onViewPhoto(receipt)}
          >
            <ImageIcon className="w-4 h-4" />
            <span>{t('admin.receipts.viewPhoto')}</span>
          </Button>
        )}
      </div>
    </Modal>
  );
};
