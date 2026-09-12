import React from 'react';
import {
  Receipt,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  Wallet,
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
  const { isDark, subCardClass, textPrimary, textSecondary, textMuted } = useThemeTokens();

  if (!receipt) return null;

  const isPending = receipt.status === 'pending';
  const isApproved = receipt.status === 'approved';
  const isRejected = receipt.status === 'rejected';

  const userDisplayName =
    [receipt.user?.firstName, receipt.user?.lastName].filter(Boolean).join(' ') ||
    receipt.user?.username ||
    `ID: ${receipt.telegramId}`;

  return (
    <Modal
      isOpen={Boolean(receipt)}
      onClose={onClose}
      title={`${t('admin.receipts.detailModalTitle')} #${receipt.id}`}
      icon={<Receipt className="w-5 h-5 text-indigo-500" />}
      maxWidth="md"
    >
      <div className="space-y-4">
        {/* Top Summary Banner */}
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${
            isApproved
              ? isDark
                ? 'bg-emerald-500/10 border-emerald-500/25'
                : 'bg-emerald-50 border-emerald-200'
              : isRejected
                ? isDark
                  ? 'bg-rose-500/10 border-rose-500/25'
                  : 'bg-rose-50 border-rose-200'
                : isDark
                  ? 'bg-amber-500/10 border-amber-500/25'
                  : 'bg-amber-50 border-amber-200'
          }`}
        >
          <div className="space-y-1">
            <span className={`text-xs block ${textMuted}`}>{t('common.amount')}</span>
            <div
              className={`text-xl sm:text-2xl font-bold font-mono ${
                isApproved
                  ? isDark
                    ? 'text-emerald-300'
                    : 'text-emerald-700'
                  : isRejected
                    ? isDark
                      ? 'text-rose-300'
                      : 'text-rose-700'
                    : isDark
                      ? 'text-amber-300'
                      : 'text-amber-700'
              }`}
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
          <div className="flex items-center justify-between border-b pb-2 border-slate-200/60 dark:border-white/5">
            <div className="flex items-center gap-2 font-semibold">
              <User className="w-4 h-4 text-indigo-400" />
              <span className={textPrimary}>{t('common.customer')}</span>
            </div>
            {onInspectUser && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
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
              <span dir="ltr" className={`font-mono ${textPrimary}`}>
                {receipt.telegramId}
              </span>
            </div>
            {receipt.user?.username && (
              <div>
                <span className={`block ${textMuted}`}>{t('admin.users.colUsername')}</span>
                <span dir="ltr" className="font-mono text-indigo-400">
                  @{receipt.user.username}
                </span>
              </div>
            )}
            {receipt.user?.balance !== undefined && (
              <div>
                <span className={`block ${textMuted}`}>{t('admin.receipts.userBalance')}</span>
                <span className={`font-mono font-semibold ${textPrimary}`}>
                  {formatMoney(receipt.user.balance)} {t('common.currency')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Receipt Audit & Metadata */}
        <div className={`p-3.5 rounded-xl border space-y-2 text-xs font-mono ${subCardClass}`}>
          <div className="flex justify-between items-center text-[11px]">
            <span className={`font-sans flex items-center gap-1.5 ${textMuted}`}>
              <FileText className="w-3.5 h-3.5" />
              <span>{t('common.receiptCode')}</span>
            </span>
            <span dir="ltr" className={textPrimary}>
              {receipt.id}
            </span>
          </div>

          <div className="flex justify-between items-center text-[11px]">
            <span className={`font-sans flex items-center gap-1.5 ${textMuted}`}>
              <Clock className="w-3.5 h-3.5" />
              <span>{t('admin.receipts.date')}</span>
            </span>
            <span className={textSecondary}>{formatIsoDate(receipt.createdAt)}</span>
          </div>

          {receipt.reviewedBy && (
            <div className="flex justify-between items-center text-[11px]">
              <span className={`font-sans flex items-center gap-1.5 ${textMuted}`}>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t('admin.receipts.reviewedBy')}</span>
              </span>
              <span dir="ltr" className={textPrimary}>
                {receipt.reviewedBy}
              </span>
            </div>
          )}

          {receipt.updatedAt && !isPending && (
            <div className="flex justify-between items-center text-[11px]">
              <span className={`font-sans flex items-center gap-1.5 ${textMuted}`}>
                <Clock className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.reviewedAt')}</span>
              </span>
              <span className={textSecondary}>{formatIsoDate(receipt.updatedAt)}</span>
            </div>
          )}

          {isRejected && receipt.rejectReason && (
            <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-200/50 dark:border-white/5">
              <span className="font-sans flex items-center gap-1 text-rose-400 font-semibold text-[11px]">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.rejectionReason')}:</span>
              </span>
              <span className="text-rose-300 font-sans text-xs bg-rose-500/10 p-2 rounded-lg">
                {receipt.rejectReason}
              </span>
            </div>
          )}
        </div>

        {/* Photo Proof Action */}
        {receipt.photoFileId && onViewPhoto && (
          <button
            type="button"
            className={`w-full h-11 px-4 rounded-xl font-semibold text-xs border flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer ${
              isDark
                ? 'bg-indigo-500/15 hover:bg-indigo-500/25 border-indigo-500/30 text-indigo-300'
                : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700'
            }`}
            onClick={() => onViewPhoto(receipt)}
          >
            <Wallet className="w-4 h-4" />
            <span>{t('admin.receipts.viewPhoto')}</span>
          </button>
        )}

        {/* Bottom Actions for Pending */}
        <div className="modal-action mt-5 flex gap-2.5">
          {isPending && onApprove && onReject ? (
            <>
              <button
                type="button"
                className={`flex-1 h-10 px-4 rounded-xl text-xs font-medium border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 ${
                  isDark
                    ? 'bg-rose-500/15 hover:bg-rose-500/25 border-rose-500/25 text-rose-300'
                    : 'bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700'
                }`}
                onClick={() => onReject(receipt)}
                disabled={loading}
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.reject')}</span>
              </button>

              <button
                type="button"
                className={`flex-1 h-10 px-4 rounded-xl font-semibold text-xs border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 ${
                  isDark
                    ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/30 text-emerald-300 shadow-xs'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600 shadow-xs'
                }`}
                onClick={() => onApprove(receipt)}
                disabled={loading}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.approve')}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`w-full h-10 px-4 rounded-xl text-xs font-medium border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 shadow-xs'
              }`}
              onClick={onClose}
            >
              {t('common.close')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
