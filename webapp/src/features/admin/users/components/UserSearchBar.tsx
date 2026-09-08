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
  const { inputClass, textPrimary, textSecondary, textMuted } = useThemeTokens();

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-500" />
          <h2 className={`text-base font-bold m-0 ${textPrimary}`}>{t('admin.users.title')}</h2>
        </div>
        <span className={`text-xs ${textSecondary}`}>
          {t('admin.users.totalCount', { count: formatNumber(totalCount) })}
        </span>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className={`w-4 h-4 absolute start-3.5 top-3 pointer-events-none ${textMuted}`} />
          <input
            type="text"
            className={`input input-bordered w-full text-xs sm:text-sm ps-10 pe-10 rounded-xl ${inputClass}`}
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
              className={`absolute end-3 top-3 p-0.5 hover:text-white cursor-pointer ${textMuted}`}
              onClick={onClear}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm h-10 px-4 text-xs gap-1.5 text-white shadow-sm rounded-xl shrink-0 cursor-pointer"
          onClick={() => onSearch()}
        >
          <Search className="w-3.5 h-3.5" />
          <span>{t('admin.users.searchBtn')}</span>
        </button>
      </div>
    </div>
  );
};
