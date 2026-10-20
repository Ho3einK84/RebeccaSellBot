import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  disabled?: boolean;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  disabled = false,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();

  if (totalPages <= 1) return null;

  const prevIcon = <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180 shrink-0" />;
  const nextIcon = <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180 shrink-0" />;

  return (
    <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-line">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium cursor-pointer transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 border bg-surface/[0.04] border-line/10 text-ink-soft hover:bg-surface/[0.08] disabled:opacity-30 disabled:pointer-events-none shadow-xs`}
      >
        {prevIcon}
        <span>{t('admin.users.paginationPrev')}</span>
      </button>

      <span
        className={`text-xs font-medium px-2.5 py-1 rounded-lg border bg-surface/[0.03] border-line/10 text-ink-muted`}
      >
        {t('admin.users.paginationPage', {
          page: formatNumber(page),
          totalPages: formatNumber(totalPages),
        })}
      </span>

      <button
        type="button"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium cursor-pointer transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 border bg-surface/[0.04] border-line/10 text-ink-soft hover:bg-surface/[0.08] disabled:opacity-30 disabled:pointer-events-none shadow-xs`}
      >
        <span>{t('admin.users.paginationNext')}</span>
        {nextIcon}
      </button>
    </div>
  );
};
