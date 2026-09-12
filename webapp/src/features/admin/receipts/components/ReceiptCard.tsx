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
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
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
  const { formatMoney, formatIsoDate, sanitizeDisplayName } = useFormatters();
  const { isDark, subCardClass, textPrimary, textSecondary, textMuted } = useThemeTokens();
  const { copy, isCopied } = useCopy();

  const isPending = receipt.status === 'pending';
  const isApproved = receipt.status === 'approved';
  const isRejected = receipt.status === 'rejected';

  const { displayName } = sanitizeDisplayName(
    receipt.user?.firstName,
    receipt.user?.lastName,
    receipt.user?.username || `ID: ${receipt.telegramId}`
  );

  return (
    <Card
      className={`p-3.5 sm:p-4 space-y-3 transition-all duration-200 hover:-translate-y-0.5 group ${
        isSelected
          ? isDark
            ? 'border-indigo-500/80 bg-indigo-500/[0.04]'
            : 'border-indigo-400 bg-indigo-50/40'
          : 'hover:border-slate-300 dark:hover:border-white/20'
      }`}
    >
      {/* User Info Header */}
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* Selection Checkbox (for batch operations in pending mode) */}
          {isPending && onToggleSelect && (
            <input
              type="checkbox"
              className="checkbox checkbox-primary checkbox-sm rounded-md cursor-pointer shrink-0"
              checked={isSelected}
              onChange={() => onToggleSelect(receipt)}
            />
          )}

          <div
            className="cursor-pointer shrink-0"
            onClick={() => onInspectUser(receipt.telegramId)}
            title={t('admin.users.btnDetails')}
          >
            <Avatar
              name={receipt.user?.firstName || displayName}
              username={receipt.user?.username}
              size="md"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                className={`font-bold text-sm tracking-tight truncate text-start hover:underline cursor-pointer ${textPrimary}`}
                onClick={() => onInspectUser(receipt.telegramId)}
                title={t('admin.users.btnDetails')}
              >
                {displayName}
              </button>
            </div>
            <div className="text-xs font-mono mt-0.5">
              {receipt.user?.username ? (
                <span
                  dir="ltr"
                  className="inline-block unicode-isolate font-medium text-indigo-600 dark:text-indigo-400"
                >
                  @{receipt.user.username}
                </span>
              ) : (
                <span className={`font-sans ${textMuted}`}>{t('admin.users.noUsername')}</span>
              )}
            </div>
          </div>
        </div>

        {/* Telegram ID Chip */}
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded-lg border transition-all active:scale-95 shrink-0 cursor-pointer ${
            isDark
              ? 'bg-white/[0.04] border-white/10 hover:border-white/20 text-zinc-300'
              : 'bg-slate-50 border-slate-200/80 hover:border-slate-300 text-slate-700 shadow-xs'
          }`}
          onClick={() => copy(String(receipt.telegramId), `receipt-user-${receipt.telegramId}`)}
          title={t('common.copy')}
        >
          <span className="text-[10px] opacity-50">#</span>
          <span dir="ltr">{receipt.telegramId}</span>
          {isCopied(`receipt-user-${receipt.telegramId}`) ? (
            <span className="text-[10px] text-emerald-500 font-sans font-medium">
              {t('common.copied')}
            </span>
          ) : (
            <Copy className={`w-2.5 h-2.5 ${textMuted}`} />
          )}
        </button>
      </div>

      {/* Financial & Status Metrics */}
      <div
        className={`flex items-center justify-between py-2 px-3 rounded-xl border text-xs ${subCardClass}`}
      >
        <div className="flex items-center gap-1.5">
          <Wallet
            className={`w-3.5 h-3.5 ${
              isApproved
                ? isDark
                  ? 'text-emerald-400'
                  : 'text-emerald-600'
                : isRejected
                  ? isDark
                    ? 'text-rose-400'
                    : 'text-rose-600'
                  : isDark
                    ? 'text-emerald-400'
                    : 'text-emerald-600'
            }`}
          />
          <span
            className={`font-bold text-sm font-mono ${
              isApproved
                ? isDark
                  ? 'text-emerald-400'
                  : 'text-emerald-600'
                : isRejected
                  ? isDark
                    ? 'text-rose-400'
                    : 'text-rose-600'
                  : isDark
                    ? 'text-emerald-400'
                    : 'text-emerald-600'
            }`}
          >
            {formatMoney(receipt.amount)}
          </span>
          <span className={`text-[11px] ${textMuted}`}>{t('common.currency')}</span>
        </div>

        <div>
          <Badge
            variant={isApproved ? 'success' : isRejected ? 'error' : 'warning'}
            dot
            pulse={isPending}
            className="text-[10px]"
          >
            {isApproved
              ? t('common.statusApproved')
              : isRejected
                ? t('common.statusRejected')
                : t('common.statusPending')}
          </Badge>
        </div>
      </div>

      {/* Metadata Row: ID, Time, Review Status */}
      <div
        className={`flex items-center justify-between gap-2 text-[11px] px-0.5 flex-wrap ${textMuted}`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <span>{t('common.idLabel')}</span>
            <span dir="ltr" className="font-mono text-slate-400 dark:text-zinc-400">
              #{receipt.id.slice(-6)}
            </span>
          </div>

          <span className="opacity-40">·</span>

          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 opacity-70" />
            <span>{formatIsoDate(receipt.createdAt)}</span>
          </div>
        </div>

        {receipt.user?.balance !== undefined && (
          <div className="flex items-center gap-1 ms-auto">
            <span>{t('admin.receipts.userBalance')}:</span>
            <span className={`font-mono font-medium ${textSecondary}`}>
              {formatMoney(receipt.user.balance)} {t('common.currency')}
            </span>
          </div>
        )}
      </div>

      {receipt.reviewedBy && (
        <div className="flex items-center gap-1 text-[11px] px-0.5 text-indigo-400/90 font-sans">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          <span>
            {t('admin.receipts.reviewedBy')}: {receipt.reviewedBy}
          </span>
        </div>
      )}

      {isRejected && receipt.rejectReason && (
        <div className="flex items-center gap-1 text-[11px] px-0.5 text-rose-400 font-sans">
          <AlertCircle className="w-3 h-3" />
          <span>
            {t('admin.receipts.rejectionReason')}: {receipt.rejectReason}
          </span>
        </div>
      )}

      {/* Action Buttons */}
      {isPending ? (
        <div className="space-y-2 pt-0.5">
          {/* Inspection row: Details & Photo proof */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`flex items-center justify-center gap-1.5 h-8.5 px-3 rounded-xl border text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
                isDark
                  ? 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-zinc-200'
                  : 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-800 shadow-xs'
              }`}
              onClick={() => onViewDetails?.(receipt)}
            >
              <Info className={`w-3.5 h-3.5 ${textMuted}`} />
              <span>{t('admin.receipts.details')}</span>
            </button>

            {receipt.photoFileId && onViewPhoto ? (
              <button
                type="button"
                className={`flex items-center justify-center gap-1.5 h-8.5 px-3 rounded-xl border text-xs font-semibold transition-all active:scale-[0.98] cursor-pointer ${
                  isDark
                    ? 'bg-indigo-500/15 hover:bg-indigo-500/25 border-indigo-500/25 text-indigo-300 shadow-xs'
                    : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200/80 text-indigo-700 shadow-xs'
                }`}
                onClick={() => onViewPhoto(receipt)}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>{t('admin.receipts.viewPhoto')}</span>
              </button>
            ) : (
              <button
                type="button"
                className={`flex items-center justify-center gap-1.5 h-8.5 px-3 rounded-xl border text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
                  isDark
                    ? 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-zinc-300'
                    : 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-700 shadow-xs'
                }`}
                onClick={() => onInspectUser(receipt.telegramId)}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{t('admin.users.btnDetails')}</span>
              </button>
            )}
          </div>

          {/* Decision row: Reject & Approve */}
          <div className="grid grid-cols-2 gap-2">
            {onReject && (
              <button
                type="button"
                className={`flex items-center justify-center gap-1.5 h-8.5 px-3 rounded-xl border text-xs font-semibold transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 ${
                  isDark
                    ? 'bg-rose-500/15 hover:bg-rose-500/25 border-rose-500/25 text-rose-300 shadow-xs'
                    : 'bg-rose-50 hover:bg-rose-100 border-rose-200/80 text-rose-700 shadow-xs'
                }`}
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
                className={`flex items-center justify-center gap-1.5 h-8.5 px-3 rounded-xl border text-xs font-semibold transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 ${
                  isDark
                    ? 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/25 text-emerald-300 shadow-xs'
                    : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200/80 text-emerald-700 shadow-xs'
                }`}
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
            className={`flex items-center justify-center gap-1.5 h-8.5 px-3 rounded-xl border text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-zinc-200'
                : 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-800 shadow-xs'
            }`}
            onClick={() => onViewDetails?.(receipt)}
          >
            <Info className={`w-3.5 h-3.5 ${textMuted}`} />
            <span>{t('admin.receipts.details')}</span>
          </button>

          {receipt.photoFileId && onViewPhoto ? (
            <button
              type="button"
              className={`flex items-center justify-center gap-1.5 h-8.5 px-3 rounded-xl border text-xs font-semibold transition-all active:scale-[0.98] cursor-pointer ${
                isDark
                  ? 'bg-indigo-500/15 hover:bg-indigo-500/25 border-indigo-500/25 text-indigo-300 shadow-xs'
                  : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200/80 text-indigo-700 shadow-xs'
              }`}
              onClick={() => onViewPhoto(receipt)}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>{t('admin.receipts.viewPhoto')}</span>
            </button>
          ) : (
            <button
              type="button"
              className={`flex items-center justify-center gap-1.5 h-8.5 px-3 rounded-xl border text-xs font-semibold transition-all active:scale-[0.98] cursor-pointer ${
                isDark
                  ? 'bg-indigo-500/15 hover:bg-indigo-500/25 border-indigo-500/25 text-indigo-300 shadow-xs'
                  : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200/80 text-indigo-700 shadow-xs'
              }`}
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
