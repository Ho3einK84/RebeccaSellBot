import React from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import type { UserTransactionRecord } from '@/shared/types/userPortal.js';
import {
  getTransactionTypeLabel,
  formatTransactionDescription,
} from '@/shared/lib/transactionFormatters.js';

interface TransactionItemProps {
  tx: UserTransactionRecord;
  currency?: string;
  /** Renders as a borderless inset grouped row inside `.rs-grouped-list`. */
  grouped?: boolean;
}

export const TransactionItem: React.FC<TransactionItemProps> = ({
  tx,
  currency,
  grouped = false,
}) => {
  const { t, locale, isRtl } = useLanguage();
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
      className={
        grouped
          ? 'px-4 py-3 flex items-center justify-between text-start gap-3 hover:bg-surface-2/60 transition-colors'
          : 'p-3.5 rounded-tile border border-line bg-surface shadow-[var(--shadow-xs)] hover:border-line-strong hover:shadow-[var(--shadow-card)] flex items-center justify-between text-start gap-3 transition-all duration-200'
      }
    >
      <div className="flex items-center gap-3 min-w-0">
        <IconTile tone={isCredit ? 'ok' : 'danger'} size="sm">
          <Icon />
        </IconTile>

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
