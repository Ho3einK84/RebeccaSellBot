import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTheme } from '@/shared/theme/ThemeContext.js';

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
  const { t, isRtl } = useLanguage();
  const { isDark } = useTheme();

  if (totalPages <= 1) return null;

  const prevIcon = isRtl ? (
    <ChevronRight className="w-3.5 h-3.5" />
  ) : (
    <ChevronLeft className="w-3.5 h-3.5" />
  );
  const nextIcon = isRtl ? (
    <ChevronLeft className="w-3.5 h-3.5" />
  ) : (
    <ChevronRight className="w-3.5 h-3.5" />
  );

  return (
    <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-200/60 dark:border-white/[0.06]">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium cursor-pointer transition-all active:scale-[0.98] border ${
          isDark
            ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08] disabled:opacity-30 disabled:pointer-events-none'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none shadow-xs'
        }`}
      >
        {prevIcon}
        <span>{t('admin.users.paginationPrev')}</span>
      </button>

      <span
        className={`text-xs font-medium px-2.5 py-1 rounded-lg border font-mono ${
          isDark
            ? 'bg-white/[0.03] border-white/10 text-zinc-400'
            : 'bg-slate-100 border-slate-200/80 text-slate-600'
        }`}
      >
        {t('admin.users.paginationPage', { page, totalPages })}
      </span>

      <button
        type="button"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium cursor-pointer transition-all active:scale-[0.98] border ${
          isDark
            ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08] disabled:opacity-30 disabled:pointer-events-none'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none shadow-xs'
        }`}
      >
        <span>{t('admin.users.paginationNext')}</span>
        {nextIcon}
      </button>
    </div>
  );
};
