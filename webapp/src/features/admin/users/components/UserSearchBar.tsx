import React from 'react';
import { Search, X, Users, Filter, ArrowUpDown } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type { UserFilterType, UserSortType } from '@/shared/types/admin.js';

interface UserSearchBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearch: (value?: string) => void;
  onClear: () => void;
  totalCount: number;
  filter?: UserFilterType;
  onFilterChange?: (filter: UserFilterType) => void;
  sort?: UserSortType;
  onSortChange?: (sort: UserSortType) => void;
}

export const UserSearchBar: React.FC<UserSearchBarProps> = ({
  searchQuery,
  onSearchChange,
  onSearch,
  onClear,
  totalCount,
  filter = 'all',
  onFilterChange,
  sort = 'newest',
  onSortChange,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();
  const { isDark, inputClass, textPrimary, textMuted } = useThemeTokens();

  const filterOptions: Array<{ id: UserFilterType; label: string }> = [
    { id: 'all', label: t('admin.users.filterAll') },
    { id: 'active_subs', label: t('admin.users.filterActiveSubs') },
    { id: 'has_balance', label: t('admin.users.filterHasBalance') },
    { id: 'banned', label: t('admin.users.filterBanned') },
  ];

  const sortOptions: Array<{ id: UserSortType; label: string }> = [
    { id: 'newest', label: t('admin.users.sortNewest') },
    { id: 'balance_desc', label: t('admin.users.sortBalanceDesc') },
    { id: 'subs_desc', label: t('admin.users.sortSubsDesc') },
    { id: 'spend_desc', label: t('admin.users.sortSpendDesc') },
  ];

  return (
    <div className="space-y-3">
      {/* Top Header */}
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
          className={`text-xs px-2.5 py-0.5 rounded-full border font-medium shrink-0 ${
            isDark
              ? 'bg-white/[0.04] border-white/10 text-zinc-300'
              : 'bg-slate-100 border-slate-200 text-slate-700'
          }`}
        >
          {t('admin.users.totalCount', { count: formatNumber(totalCount) })}
        </span>
      </div>

      {/* Search Input and Button */}
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

      {/* Filters and Sort Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-0.5">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <Filter className={`w-3.5 h-3.5 shrink-0 me-0.5 ${textMuted}`} />
          {filterOptions.map((opt) => {
            const isSelected = filter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onFilterChange?.(opt.id)}
                className={`h-7 px-2.5 rounded-lg text-xs font-medium shrink-0 transition-all select-none cursor-pointer border ${
                  isSelected
                    ? isDark
                      ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300 font-semibold shadow-xs'
                      : 'bg-indigo-50 border-indigo-300 text-indigo-700 font-semibold shadow-xs'
                    : isDark
                      ? 'bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:text-zinc-200'
                      : 'bg-slate-100/70 border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Sort Selector */}
        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
          <ArrowUpDown className={`w-3.5 h-3.5 ${textMuted}`} />
          <select
            value={sort}
            onChange={(e) => onSortChange?.(e.target.value as UserSortType)}
            className={`h-7 px-2 text-xs font-medium rounded-lg border outline-none transition-colors cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 text-zinc-300'
                : 'bg-white border-slate-200 text-slate-700 shadow-xs'
            }`}
          >
            {sortOptions.map((s) => (
              <option key={s.id} value={s.id} className={isDark ? 'bg-zinc-900 text-white' : ''}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
