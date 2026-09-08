import React from 'react';
import { Check, X, Clock, User, Image as ImageIcon } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import type { TopupReceipt } from '@/shared/types/admin.js';

interface ReceiptCardProps {
  receipt: TopupReceipt;
  onApprove: (receipt: TopupReceipt) => void;
  onReject: (receipt: TopupReceipt) => void;
  onViewPhoto: (receipt: TopupReceipt) => void;
  onInspectUser: (telegramId: number) => void;
  disabled?: boolean;
}

export const ReceiptCard: React.FC<ReceiptCardProps> = ({
  receipt,
  onApprove,
  onReject,
  onViewPhoto,
  onInspectUser,
  disabled = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatIsoDate } = useFormatters();
  const { isDark, textSecondary, textMuted } = useThemeTokens();

  return (
    <Card className="p-3.5 sm:p-4.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-white/20 group">
      <div className="space-y-2 flex-1 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span
            className={`text-lg sm:text-xl font-bold font-mono tracking-tight ${
              isDark ? 'text-emerald-400' : 'text-emerald-600'
            }`}
          >
            {formatMoney(receipt.amount)} {t('common.currency')}
          </span>
          <Badge variant="warning" dot pulse className="text-[10px]">
            {receipt.status === 'approved'
              ? t('common.statusApproved')
              : receipt.status === 'rejected'
                ? t('common.statusRejected')
                : t('common.statusPending')}
          </Badge>
          {receipt.photoFileId && (
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-xl border transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-indigo-500/10 border-indigo-500/25 hover:bg-indigo-500/20 text-indigo-300'
                  : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 text-indigo-700'
              }`}
              onClick={() => onViewPhoto(receipt)}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>{t('admin.receipts.viewPhoto')}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs flex-wrap">
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border font-mono text-xs transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 hover:border-indigo-400/40 text-indigo-400 hover:bg-white/[0.08]'
                : 'bg-indigo-50/60 border-indigo-200/80 hover:border-indigo-300 text-indigo-700 hover:bg-indigo-50'
            }`}
            onClick={() => onInspectUser(receipt.telegramId)}
            title={t('admin.users.btnDetails')}
          >
            <User className="w-3 h-3 opacity-70" />
            <span dir="ltr">{receipt.telegramId}</span>
          </button>
          <span className={textMuted}>·</span>
          <span className={`font-mono text-xs ${textSecondary}`}>
            {t('common.idLabel')} <span dir="ltr">{receipt.id}</span>
          </span>
        </div>

        <div className={`flex items-center gap-1.5 text-[11px] ${textMuted}`}>
          <Clock className="w-3 h-3" />
          <span>{formatIsoDate(receipt.createdAt)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 self-stretch sm:self-center pt-2 sm:pt-0 border-t sm:border-0 border-slate-200/50 dark:border-white/5">
        <button
          type="button"
          className={`inline-flex items-center justify-center gap-1.5 h-8.5 px-3.5 rounded-xl font-semibold text-xs border transition-all active:scale-95 cursor-pointer flex-1 sm:flex-none disabled:opacity-50 ${
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

        <button
          type="button"
          className={`inline-flex items-center justify-center gap-1.5 h-8.5 px-3.5 rounded-xl font-semibold text-xs border transition-all active:scale-95 cursor-pointer flex-1 sm:flex-none disabled:opacity-50 ${
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
      </div>
    </Card>
  );
};
