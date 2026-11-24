import React from 'react';
import { Search, X, Users, Filter, ArrowUpDown, Tags } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Select } from '@/shared/components/ui/Input.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
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
  onOpenUserGroups?: () => void;
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
  onOpenUserGroups,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();

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
      <div className="flex flex-row justify-between items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <SectionHeader icon={<Users />} title={t('admin.users.title')} />
          <Badge variant="neutral" size="sm" className="shrink-0">
            {t('admin.users.totalCount', { count: formatNumber(totalCount) })}
          </Badge>
        </div>
        {onOpenUserGroups && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenUserGroups}
            className="shrink-0"
          >
            <Tags className="w-3.5 h-3.5 text-brand-fg shrink-0" />
            <span>{t('admin.users.manageGroupsBtn')}</span>
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute start-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-ink-muted" />
          <input
            type="text"
            className="w-full h-11 ps-10 pe-10 text-xs sm:text-sm rounded-tile border border-line bg-surface text-ink placeholder:text-ink-muted outline-none rs-focus"
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
              className="absolute end-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-ctl text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer rs-focus"
              onClick={onClear}
              aria-label={t('common.clearSearch')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Button type="button" variant="primary" size="md" onClick={() => onSearch()}>
          <Search className="w-4 h-4" />
          <span>{t('admin.users.searchBtn')}</span>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 no-scrollbar overscroll-x-contain touch-pan-x">
          <Filter className="w-3.5 h-3.5 shrink-0 me-0.5 text-ink-muted" />
          {filterOptions.map((opt) => {
            const isSelected = filter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onFilterChange?.(opt.id)}
                className={`h-8 px-3 rounded-ctl text-xs shrink-0 select-none cursor-pointer border rs-focus press transition-colors ${
                  isSelected
                    ? 'bg-brand-soft border-brand/35 text-brand-fg font-semibold'
                    : 'bg-surface border-line text-ink-soft hover:border-line-strong hover:text-ink font-medium'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
          <ArrowUpDown className="w-3.5 h-3.5 text-ink-muted shrink-0" />
          <Select
            compact
            value={sort}
            onChange={(e) => onSortChange?.(e.target.value as UserSortType)}
            className="w-auto min-w-[140px]"
          >
            {sortOptions.map((s) => (
              <option key={s.id} value={s.id} className="bg-surface text-ink">
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
};
