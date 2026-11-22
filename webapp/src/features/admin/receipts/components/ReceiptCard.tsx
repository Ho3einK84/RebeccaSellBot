import React from 'react';
import {
  Check,
  X,
  Clock,
  Image as ImageIcon,
  Info,
  ShieldCheck,
  AlertCircle,
  Wallet,
  Copy,
  Eye,
  AlertTriangle,
  CreditCard,
  Ban,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useToast } from '@/shared/components/ui/Toast.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import type { TopupReceipt } from '@/shared/types/admin.js';

interface ReceiptCardProps {
  receipt: TopupReceipt;
  isSelected?: boolean;
  onToggleSelect?: (receipt: TopupReceipt) => void;
  onApprove?: (receipt: TopupReceipt) => void;
  onReject?: (receipt: TopupReceipt) => void;
  onViewPhoto?: (receipt: TopupReceipt) => void;
  onViewDetails?: (receipt: TopupReceipt) => void;
  onInspectUser: (telegramId: number) => void;
  disabled?: boolean;
}

export const ReceiptCard: React.FC<ReceiptCardProps> = ({
  receipt,
  isSelected = false,
  onToggleSelect,
  onApprove,
  onReject,
  onViewPhoto,
  onViewDetails,
  onInspectUser,
  disabled = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatId, formatIsoDate, formatReceiptShortId, sanitizeDisplayName } =
    useFormatters();
  const { copy, isCopied } = useCopy();
  const { notify } = useToast();

  const isPending = receipt.status === 'pending';
  const isApproved = receipt.status === 'approved';
  const isRejected = receipt.status === 'rejected';
  const isVoided = receipt.status === 'voided';

  const badgeVariant = isApproved
    ? ('success' as const)
    : isRejected
      ? ('error' as const)
      : isVoided
        ? ('neutral' as const)
        : ('warning' as const);
  const statusLabel = isApproved
    ? t('common.statusApproved')
    : isRejected
      ? t('common.statusRejected')
      : isVoided
        ? t('common.statusVoided')
        : t('common.statusPending');

  const duplicateShortId = receipt.duplicateOfReceiptId
    ? formatReceiptShortId(receipt.duplicateOfReceiptId)
    : null;
  const hasDuplicateWarning = Boolean(receipt.duplicateOfReceiptId || receipt.duplicateWarning);

  const { displayName } = sanitizeDisplayName(
    receipt.user?.firstName,
    receipt.user?.lastName,
    receipt.user?.username || `${t('common.idLabel')} ${receipt.telegramId}`
  );

  const handleCopyUserId = async () => {
    const ok = await copy(String(receipt.telegramId), `receipt-user-${receipt.telegramId}`);
    if (ok) {
      notify(t('user.copiedId'), 'success');
    }
  };

  return (
    <Card
      padding="md"
      tone={isSelected ? 'brand' : 'default'}
      className="flex flex-col justify-between gap-3 hover:border-line-strong transition-colors text-start"
    >
      <div className="space-y-3">
        {/* User Info Header */}
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {isPending && onToggleSelect && (
              <input
                type="checkbox"
                className="rs-checkbox cursor-pointer shrink-0"
                checked={isSelected}
                onChange={() => onToggleSelect(receipt)}
                aria-label={displayName}
              />
            )}

            <button
              type="button"
              className="cursor-pointer shrink-0 rounded-full rs-focus"
              onClick={() => onInspectUser(receipt.telegramId)}
              title={t('admin.users.btnDetails')}
            >
              <Avatar
                name={receipt.user?.firstName || displayName}
                username={receipt.user?.username}
                size="md"
              />
            </button>

            <div className="min-w-0 flex-1">
              <button
                type="button"
                className="font-semibold text-sm truncate text-start hover:underline cursor-pointer block max-w-full text-ink"
                onClick={() => onInspectUser(receipt.telegramId)}
                title={t('admin.users.btnDetails')}
              >
                {displayName}
              </button>
              <div className="text-xs tnum mt-0.5">
                {receipt.user?.username ? (
                  <bdi dir="ltr" className="font-medium text-brand-fg">
                    @{receipt.user.username}
                  </bdi>
                ) : (
                  <span className="text-ink-muted">{t('admin.users.noUsername')}</span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="inline-flex items-center gap-1 h-7 text-xs tnum px-2 rounded-ctl border press rs-focus shrink-0 cursor-pointer bg-surface-2 border-line hover:border-line-strong text-ink-soft"
            onClick={() => void handleCopyUserId()}
            title={t('common.copy')}
          >
            <bdi dir="ltr" className="tnum font-medium">
              #{formatId(receipt.telegramId)}
            </bdi>
            {isCopied(`receipt-user-${receipt.telegramId}`) ? (
              <Check className="w-3 h-3 text-ok-fg shrink-0" />
            ) : (
              <Copy className="w-3 h-3 text-ink-muted shrink-0" />
            )}
          </button>
        </div>

        {/* Financial & Status Metrics */}
        <Card subCard padding="sm" className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <Wallet
              className={`w-4 h-4 shrink-0 ${
                isApproved
                  ? 'text-ok-fg'
                  : isRejected
                    ? 'text-danger-fg'
                    : isVoided
                      ? 'text-ink-muted'
                      : 'text-warn-fg'
              }`}
            />
            <bdi
              dir="ltr"
              className={`font-semibold text-sm tnum ${
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
            <span className="text-xs text-ink-muted">{t('common.currency')}</span>
          </div>

          <Badge variant={badgeVariant} dot size="xs">
            {statusLabel}
          </Badge>
        </Card>

        {hasDuplicateWarning && (
          <div className="flex items-center gap-2 rounded-ctl border border-warn/35 bg-warn-soft px-2.5 py-1.5 text-[11px] font-medium text-warn-fg">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {duplicateShortId
                ? `${t('admin.receipts.duplicateWarningBadge')} · ${t('admin.receipts.duplicateOfLabel', { id: duplicateShortId })}`
                : receipt.duplicateWarning || t('admin.receipts.duplicateWarningBadge')}
            </span>
          </div>
        )}

        {/* Meta Footer */}
        <div className="pt-2 border-t border-line text-[11px] text-ink-muted flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <bdi dir="ltr" className="tnum font-medium">
              #{formatReceiptShortId(receipt.id)}
            </bdi>

            <span className="opacity-40">·</span>

            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 opacity-70 shrink-0" />
              <bdi dir="ltr" className="tnum">
                {formatIsoDate(receipt.createdAt)}
              </bdi>
            </div>
          </div>

          {(receipt.cardSummary || receipt.cardNumber) && (
            <div className="flex items-center gap-1 text-[11px] text-ink-soft">
              <CreditCard className="w-3 h-3 text-warn-fg shrink-0" />
              <span className="truncate">{receipt.cardSummary || receipt.cardNumber}</span>
            </div>
          )}

          {receipt.reviewedBy && (
            <div className="flex items-center gap-1 text-[11px] text-brand-fg">
              <ShieldCheck className="w-3.5 h-3.5 text-ok-fg shrink-0" />
              <span>
                {t('admin.receipts.reviewedBy')}:{' '}
                <bdi dir="ltr" className="tnum font-medium">
                  #{formatId(receipt.reviewedBy)}
                </bdi>
              </span>
            </div>
          )}

          {isVoided && (receipt.voidedBy || receipt.voidReason) && (
            <div className="flex items-center gap-1 text-[11px] text-ink-soft">
              <Ban className="w-3.5 h-3.5 text-danger-fg shrink-0" />
              <span className="truncate">
                {receipt.voidReason
                  ? `${t('admin.receipts.voidReason')}: ${receipt.voidReason}`
                  : `${t('admin.receipts.voidedBy')}: #${formatId(receipt.voidedBy)}`}
              </span>
            </div>
          )}

          {isRejected && receipt.rejectReason && (
            <div className="flex items-center gap-1 text-[11px] text-danger-fg">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {t('admin.receipts.rejectionReason')}: {receipt.rejectReason}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      {isPending ? (
        <div className="space-y-2 pt-0.5">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-ctl border text-xs font-medium press rs-focus cursor-pointer bg-surface-2 hover:bg-surface-3 border-line text-ink-soft"
              onClick={() => onViewDetails?.(receipt)}
            >
              <Info className="w-3.5 h-3.5 text-ink-muted" />
              <span>{t('admin.receipts.details')}</span>
            </button>

            {receipt.photoFileId && onViewPhoto ? (
              <button
                type="button"
                className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-ctl border text-xs font-semibold press rs-focus cursor-pointer bg-brand-soft hover:bg-brand/15 border-brand/25 text-brand-fg"
                onClick={() => onViewPhoto(receipt)}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.viewPhoto')}</span>
              </button>
            ) : (
              <button
                type="button"
                className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-ctl border text-xs font-medium press rs-focus cursor-pointer bg-surface-2 hover:bg-surface-3 border-line text-ink-soft"
                onClick={() => onInspectUser(receipt.telegramId)}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{t('admin.users.btnDetails')}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {onReject && (
              <button
                type="button"
                className="flex items-center justify-center gap-1.5 h-10 px-3 rounded-ctl border text-xs font-semibold press rs-focus cursor-pointer disabled:opacity-50 bg-danger-soft hover:bg-danger/15 border-danger/25 text-danger-fg"
                disabled={disabled}
                onClick={() => onReject(receipt)}
              >
                <X className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.reject')}</span>
              </button>
            )}

            {onApprove && (
              <button
                type="button"
                className="flex items-center justify-center gap-1.5 h-10 px-3 rounded-ctl border text-xs font-semibold press rs-focus cursor-pointer disabled:opacity-50 bg-ok-soft hover:bg-ok/15 border-ok/25 text-ok-fg"
                disabled={disabled}
                onClick={() => onApprove(receipt)}
              >
                <Check className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.approve')}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <button
            type="button"
            className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-ctl border text-xs font-medium press rs-focus cursor-pointer bg-surface-2 hover:bg-surface-3 border-line text-ink-soft"
            onClick={() => onViewDetails?.(receipt)}
          >
            <Info className="w-3.5 h-3.5 text-ink-muted" />
            <span>{t('admin.receipts.details')}</span>
          </button>

          {receipt.photoFileId && onViewPhoto ? (
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-ctl border text-xs font-semibold press rs-focus cursor-pointer bg-brand-soft hover:bg-brand/15 border-brand/25 text-brand-fg"
              onClick={() => onViewPhoto(receipt)}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>{t('admin.receipts.viewPhoto')}</span>
            </button>
          ) : (
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-ctl border text-xs font-semibold press rs-focus cursor-pointer bg-brand-soft hover:bg-brand/15 border-brand/25 text-brand-fg"
              onClick={() => onInspectUser(receipt.telegramId)}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{t('admin.users.btnDetails')}</span>
            </button>
          )}
        </div>
      )}
    </Card>
  );
};
