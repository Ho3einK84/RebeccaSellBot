import React from 'react';
import { Search, X, Users } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

interface UserSearchBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearch: (value?: string) => void;
  onClear: () => void;
  totalCount: number;
}

export const UserSearchBar: React.FC<UserSearchBarProps> = ({
  searchQuery,
  onSearchChange,
  onSearch,
  onClear,
  totalCount,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();
  const { isDark, inputClass, textPrimary, textMuted } = useThemeTokens();

  return (
    <div className="space-y-3">
      <div className="flex flex-row justify-between items-center gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
              isDark
                ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 shadow-xs'
                : 'bg-indigo-50 border-indigo-200 text-indigo-600 shadow-xs'
            }`}
          >
            <Users className="w-4 h-4" />
          </div>
          <h2 className={`text-base font-bold m-0 tracking-tight truncate ${textPrimary}`}>
            {t('admin.users.title')}
          </h2>
        </div>
        <span
          className={`text-xs px-2.5 py-0.5 rounded-full border font-mono font-medium shrink-0 ${
            isDark
              ? 'bg-white/[0.04] border-white/10 text-zinc-300'
              : 'bg-slate-100 border-slate-200 text-slate-700'
          }`}
        >
          {t('admin.users.totalCount', { count: formatNumber(totalCount) })}
        </span>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className={`w-4 h-4 absolute start-3.5 top-3 pointer-events-none ${textMuted}`} />
          <input
            type="text"
            className={`w-full h-10 ps-10 pe-10 text-xs sm:text-sm rounded-xl border outline-none transition-all ${inputClass}`}
            placeholder={t('admin.users.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch();
            }}
          />
          {searchQuery && (
            <button
              type="button"
              className={`absolute end-2.5 top-2 p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer ${textMuted}`}
              onClick={onClear}
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          className={`h-10 px-3.5 sm:px-4 rounded-xl font-medium text-xs border transition-all active:scale-95 cursor-pointer inline-flex items-center gap-1.5 shrink-0 ${
            isDark
              ? 'bg-white/[0.06] hover:bg-white/[0.1] border-white/10 text-zinc-200 shadow-xs'
              : 'bg-slate-900 hover:bg-slate-800 text-white border-transparent shadow-xs'
          }`}
          onClick={() => onSearch()}
        >
          <Search className="w-3.5 h-3.5" />
          <span>{t('admin.users.searchBtn')}</span>
        </button>
      </div>
    </div>
  );
};
