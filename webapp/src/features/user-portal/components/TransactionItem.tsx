import React from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { UserTransactionRecord } from '@/shared/types/userPortal.js';
import {
  getTransactionTypeLabel,
  formatTransactionDescription,
} from '@/shared/lib/transactionFormatters.js';

interface TransactionItemProps {
  tx: UserTransactionRecord;
  currency?: string;
}

export const TransactionItem: React.FC<TransactionItemProps> = ({ tx, currency }) => {
  const { t, locale, isRtl } = useLanguage();
  const { subCardClass } = useThemeTokens();
  const { formatToman } = useFormatters();

  const isCredit = tx.amount > 0;
  const Icon = isCredit ? ArrowDownLeft : ArrowUpRight;
  const displayCurrency = currency || t('common.currency');
  const typeLabel = getTransactionTypeLabel(tx.type, tx.description, t);
  const friendlyDescription = formatTransactionDescription(tx.description, locale);
  const parsedCreatedAt = new Date(tx.createdAt);
  const formattedCreatedAt = Number.isNaN(parsedCreatedAt.getTime())
    ? '—'
    : parsedCreatedAt.toLocaleDateString(isRtl ? 'fa-IR' : 'en-US');

  return (
    <div
      className={`p-3.5 rounded-tile border flex items-center justify-between text-start gap-3 transition-colors ${subCardClass} hover:border-line-strong`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`w-8 h-8 rounded-ctl flex items-center justify-center shrink-0 ${
            isCredit
              ? 'bg-ok-soft text-ok-fg border border-ok/20'
              : 'bg-danger-soft text-danger-fg border border-danger/20'
          }`}
        >
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold truncate text-ink">{typeLabel}</span>
            <bdi dir="ltr" className="text-[11px] text-ink-muted tnum shrink-0">
              {formattedCreatedAt}
            </bdi>
          </div>
          <span className="text-[11px] text-ink-muted truncate" title={friendlyDescription}>
            {friendlyDescription}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end shrink-0">
        <bdi
          dir="ltr"
          className={`tnum font-semibold text-xs sm:text-sm ${isCredit ? 'text-ok-fg' : 'text-danger-fg'}`}
        >
          {isCredit ? '+' : ''}
          {formatToman(tx.amount)} {displayCurrency}
        </bdi>
        <span className="text-[11px] text-ink-muted tnum">
          {t('user.wallet.balanceAfterLabel').replace('{amount}', formatToman(tx.balanceAfter))}
        </span>
      </div>
    </div>
  );
};
