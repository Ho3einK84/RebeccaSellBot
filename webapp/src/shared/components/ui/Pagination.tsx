import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  disabled?: boolean;
  prevLabel?: string;
  nextLabel?: string;
  pageLabel?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  disabled = false,
  prevLabel,
  nextLabel,
  pageLabel,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();

  if (totalPages <= 1) return null;

  const prevIcon = <ChevronLeft className="w-4 h-4 rtl:rotate-180 shrink-0" />;
  const nextIcon = <ChevronRight className="w-4 h-4 rtl:rotate-180 shrink-0" />;
  const resolvedPrev = prevLabel ?? t('admin.users.paginationPrev');
  const resolvedNext = nextLabel ?? t('admin.users.paginationNext');
  const resolvedPage =
    pageLabel ??
    t('admin.users.paginationPage', {
      page: formatNumber(page),
      totalPages: formatNumber(totalPages),
    });

  return (
    <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-line">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-ctl text-xs font-medium cursor-pointer border bg-surface-2 border-line-strong text-ink hover:bg-surface-3 rs-focus press disabled:opacity-40 disabled:pointer-events-none"
      >
        {prevIcon}
        <span>{resolvedPrev}</span>
      </button>

      <span className="tnum text-xs font-medium px-3 py-1.5 rounded-ctl border bg-surface border-line text-ink-soft">
        {resolvedPage}
      </span>

      <button
        type="button"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-ctl text-xs font-medium cursor-pointer border bg-surface-2 border-line-strong text-ink hover:bg-surface-3 rs-focus press disabled:opacity-40 disabled:pointer-events-none"
      >
        <span>{resolvedNext}</span>
        {nextIcon}
      </button>
    </div>
  );
};
