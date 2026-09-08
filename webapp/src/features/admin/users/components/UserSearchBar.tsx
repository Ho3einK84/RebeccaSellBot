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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-500" />
          <h2 className={`text-base font-bold m-0 tracking-tight ${textPrimary}`}>
            {t('admin.users.title')}
          </h2>
        </div>
        <span
          className={`text-xs px-2.5 py-1 rounded-full border font-mono font-medium ${
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
          className="h-10 px-4 rounded-xl font-medium text-xs text-white bg-gradient-to-b from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 border border-indigo-400/30 shadow-xs active:scale-95 transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0"
          onClick={() => onSearch()}
        >
          <Search className="w-3.5 h-3.5" />
          <span>{t('admin.users.searchBtn')}</span>
        </button>
      </div>
    </div>
  );
};
