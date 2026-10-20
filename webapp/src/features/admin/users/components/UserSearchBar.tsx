import React from 'react';
import { Search, X, Users, Filter, ArrowUpDown } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
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
  const { inputClass, textPrimary, textMuted } = useThemeTokens();

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
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-brand/10 border-brand/20 text-brand shadow-xs`}
          >
            <Users className="w-4 h-4" />
          </div>
          <h2 className={`text-base font-bold m-0 tracking-tight truncate ${textPrimary}`}>
            {t('admin.users.title')}
          </h2>
        </div>
        <Badge variant="neutral" size="sm" className="shrink-0">
          {t('admin.users.totalCount', { count: formatNumber(totalCount) })}
        </Badge>
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
              className={`absolute end-2.5 top-2 p-1 rounded-lg hover:bg-ink/[0.06] transition-colors cursor-pointer ${textMuted}`}
              onClick={onClear}
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Button
          type="button"
          variant="primary"
          size="md"
          className="h-10 px-3.5 sm:px-4 text-xs shrink-0"
          onClick={() => onSearch()}
        >
          <Search className="w-3.5 h-3.5" />
          <span>{t('admin.users.searchBtn')}</span>
        </Button>
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
                className={`h-7 px-2.5 rounded-lg text-xs font-medium shrink-0 transition-all select-none cursor-pointer border ${isSelected ? 'bg-brand/20 border-brand/40 text-brand font-semibold shadow-xs' : 'bg-surface/[0.03] border-line/[0.06] text-ink-muted hover:text-ink-soft'}`}
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
            className={`h-7 px-2 text-xs font-medium rounded-lg border outline-none transition-colors cursor-pointer bg-surface/[0.04] border-line/10 text-ink-soft shadow-xs`}
          >
            {sortOptions.map((s) => (
              <option key={s.id} value={s.id} className={'bg-surface text-ink'}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
