import React from 'react';
import { Check, X, Clock, User, Image as ImageIcon } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Card } from '@/shared/components/ui/Card.js';
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
    <Card className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 transition-all hover:border-indigo-500/40">
      <div className="space-y-1.5 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-base font-bold font-mono ${
              isDark ? 'text-emerald-400' : 'text-emerald-600'
            }`}
          >
            {formatMoney(receipt.amount)} {t('common.currency')}
          </span>
          <span className="badge badge-warning badge-sm text-[10px] font-medium">
            {receipt.status}
          </span>
          {receipt.photoFileId && (
            <button
              type="button"
              className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full border transition-all cursor-pointer ${
                isDark
                  ? 'bg-indigo-500/10 border-indigo-500/20 hover:bg-indigo-500/20 text-indigo-300'
                  : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 text-indigo-700'
              }`}
              onClick={() => onViewPhoto(receipt)}
            >
              <ImageIcon className="w-3 h-3" />
              <span>{t('admin.receipts.viewPhoto')}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="flex items-center gap-1">
            <User className={`w-3.5 h-3.5 ${textMuted}`} />
            <button
              type="button"
              className="underline font-mono text-indigo-500 hover:text-indigo-400 cursor-pointer"
              onClick={() => onInspectUser(receipt.telegramId)}
            >
              <span dir="ltr">{receipt.telegramId}</span>
            </button>
          </span>
          <span className={textMuted}>·</span>
          <span className={`font-mono text-[11px] ${textSecondary}`}>
            ID: <span dir="ltr">{receipt.id}</span>
          </span>
        </div>

        <div className={`flex items-center gap-1.5 text-[11px] ${textMuted}`}>
          <Clock className="w-3 h-3" />
          <span>{formatIsoDate(receipt.createdAt)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 w-full sm:w-auto self-end">
        <button
          type="button"
          className="btn btn-success btn-sm flex-1 sm:flex-none gap-1 text-xs text-white shadow-sm cursor-pointer"
          disabled={disabled}
          onClick={() => onApprove(receipt)}
        >
          <Check className="w-3.5 h-3.5" />
          <span>{t('admin.receipts.approve')}</span>
        </button>

        <button
          type="button"
          className="btn btn-error btn-sm flex-1 sm:flex-none gap-1 text-xs text-white shadow-sm cursor-pointer"
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
