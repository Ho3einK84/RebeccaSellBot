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
  const { isDark, subCardClass } = useThemeTokens();
  const { formatToman } = useFormatters();

  const isCredit = tx.amount > 0;
  const Icon = isCredit ? ArrowDownLeft : ArrowUpRight;
  const displayCurrency = currency || t('common.currency');
  const typeLabel = getTransactionTypeLabel(tx.type, tx.description, t);
  const friendlyDescription = formatTransactionDescription(tx.description, locale);

  return (
    <div
      className={`p-3.5 rounded-2xl border flex items-center justify-between text-start gap-2.5 transition-all ${
        isDark
          ? `${subCardClass} hover:border-line/[0.12]`
          : 'bg-surface border-line/80 shadow-2xs hover:border-line-strong'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
            isCredit
              ? 'bg-ok/10 text-ok border border-ok/20'
              : 'bg-danger/10 text-danger border border-danger/20'
          }`}
        >
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold truncate text-ink">{typeLabel}</span>
            <span className="text-[10px] text-ink-muted tnum">
              {new Date(tx.createdAt).toLocaleDateString(isRtl ? 'fa-IR' : 'en-US')}
            </span>
          </div>
          <span className="text-[11px] text-ink-muted truncate" title={friendlyDescription}>
            {friendlyDescription}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end shrink-0">
        <span
          dir="ltr"
          className={`tnum font-bold text-xs sm:text-sm ${isCredit ? 'text-ok' : 'text-danger'}`}
        >
          {isCredit ? '+' : ''}
          {formatToman(tx.amount)} {displayCurrency}
        </span>
        <span className="text-[10px] text-ink-muted tnum">
          {t('user.wallet.balanceAfterLabel').replace('{amount}', formatToman(tx.balanceAfter))}
        </span>
      </div>
    </div>
  );
};
