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
    <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-200/60 dark:border-white/5">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={`btn btn-xs sm:btn-sm gap-1 rounded-xl text-xs font-medium cursor-pointer transition-all ${
          isDark
            ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/10 disabled:opacity-30'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-30 shadow-2xs'
        }`}
      >
        {prevIcon}
        <span>{t('admin.users.paginationPrev')}</span>
      </button>

      <span className="text-xs text-slate-500 dark:text-zinc-400 font-medium">
        {t('admin.users.paginationPage', { page, totalPages })}
      </span>

      <button
        type="button"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={`btn btn-xs sm:btn-sm gap-1 rounded-xl text-xs font-medium cursor-pointer transition-all ${
          isDark
            ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/10 disabled:opacity-30'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-30 shadow-2xs'
        }`}
      >
        <span>{t('admin.users.paginationNext')}</span>
        {nextIcon}
      </button>
    </div>
  );
};
