import React, { useMemo, useState } from 'react';
import { Plus, Search, X, Package } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button.js';
import { Input, Select } from '@/shared/components/ui/Input.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type {
  AdminCategoryDto,
  AdminPackageDto,
  AdminTargetPanelDto,
} from '@/shared/types/admin.js';
import {
  filterAdminPackages,
  formatBilingualPackageName,
  MAX_PACKAGE_COUNT,
  type PackageFilterCriteria,
  type PackageStatusFilter,
} from '../packageValidation.js';
import { PackageCard } from './PackageCard.js';

interface PackagesListSectionProps {
  packages: readonly AdminPackageDto[];
  categories: readonly AdminCategoryDto[];
  targets: readonly AdminTargetPanelDto[];
  maxPackages: number;
  isFallbackActive: boolean;
  isTogglingPackage: boolean;
  togglingPackageId: string | null;
  isReorderingPackages: boolean;
  onNewPackage: () => void;
  onEditPackage: (pkg: AdminPackageDto) => void;
  onClonePackage: (pkg: AdminPackageDto) => void;
  onDeletePackage: (pkg: AdminPackageDto) => void;
  onTogglePackage: (pkg: AdminPackageDto) => void;
  onMovePackage: (pkg: AdminPackageDto, direction: 'up' | 'down') => void;
}

export const PackagesListSection: React.FC<PackagesListSectionProps> = ({
  packages,
  categories,
  targets,
  maxPackages,
  isFallbackActive,
  isTogglingPackage,
  togglingPackageId,
  isReorderingPackages,
  onNewPackage,
  onEditPackage,
  onClonePackage,
  onDeletePackage,
  onTogglePackage,
  onMovePackage,
}) => {
  const { t, locale } = useLanguage();
  const { formatNumber } = useFormatters();

  const [criteria, setCriteria] = useState<PackageFilterCriteria>({
    search: '',
    status: 'all',
    categoryId: 'all',
    panelId: 'all',
  });

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const targetsById = useMemo(() => new Map(targets.map((p) => [p.panelId, p])), [targets]);

  const filteredPackages = useMemo(
    () => filterAdminPackages(packages, criteria),
    [packages, criteria]
  );

  const hasActiveFilters =
    Boolean(criteria.search.trim()) ||
    criteria.status !== 'all' ||
    criteria.categoryId !== 'all' ||
    criteria.panelId !== 'all';

  const limit = maxPackages || MAX_PACKAGE_COUNT;
  const atLimit = packages.length >= limit;

  const resetFilters = () => {
    setCriteria({
      search: '',
      status: 'all',
      categoryId: 'all',
      panelId: 'all',
    });
  };

  return (
    <div className="space-y-3">
      {isFallbackActive && (
        <AlertBanner tone="info">{t('admin.packages.fallbackBanner')}</AlertBanner>
      )}

      {atLimit && (
        <AlertBanner tone="warn">
          {t('admin.packages.maxCountBanner', { max: formatNumber(limit) })}
        </AlertBanner>
      )}

      {/* Search & Filters Card */}
      <div className="bg-surface border border-line rounded-card p-3 space-y-2.5 shadow-[var(--shadow-card)]">
        <div className="relative">
          <Search className="w-4 h-4 text-ink-muted absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={criteria.search}
            placeholder={t('admin.packages.filters.searchPlaceholder')}
            className="ps-9 pe-8 text-xs"
            onChange={(e) => setCriteria((prev) => ({ ...prev, search: e.target.value }))}
          />
          {criteria.search && (
            <button
              type="button"
              onClick={() => setCriteria((prev) => ({ ...prev, search: '' }))}
              aria-label={t('admin.packages.filters.clearSearch')}
              className="absolute end-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-ctl text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer rs-focus"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Select
            compact
            aria-label={t('admin.packages.filters.statusAll')}
            value={criteria.status}
            onChange={(e) =>
              setCriteria((prev) => ({
                ...prev,
                status: e.target.value as PackageStatusFilter,
              }))
            }
          >
            <option value="all">{t('admin.packages.filters.statusAll')}</option>
            <option value="active">{t('admin.packages.filters.statusActive')}</option>
            <option value="inactive">{t('admin.packages.filters.statusInactive')}</option>
          </Select>

          <Select
            compact
            aria-label={t('admin.packages.filters.categoryAll')}
            value={criteria.categoryId}
            onChange={(e) => setCriteria((prev) => ({ ...prev, categoryId: e.target.value }))}
          >
            <option value="all">{t('admin.packages.filters.categoryAll')}</option>
            <option value="uncategorized">
              {t('admin.packages.filters.categoryUncategorized')}
            </option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.icon ? `${cat.icon} ` : ''}
                {formatBilingualPackageName(cat.name, locale).primary}
              </option>
            ))}
          </Select>

          <Select
            compact
            aria-label={t('admin.packages.filters.panelAll')}
            value={criteria.panelId}
            onChange={(e) => setCriteria((prev) => ({ ...prev, panelId: e.target.value }))}
          >
            <option value="all">{t('admin.packages.filters.panelAll')}</option>
            <option value="default">{t('admin.packages.filters.panelDefault')}</option>
            {targets.map((panel) => (
              <option key={panel.panelId} value={panel.panelId}>
                {panel.panelName}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5 text-[11px] text-ink-muted">
          <span className="tnum">
            {t('admin.packages.filters.countShowing', {
              shown: formatNumber(filteredPackages.length),
              total: formatNumber(packages.length),
            })}
          </span>
          {hasActiveFilters && (
            <div className="flex items-center gap-3 flex-wrap">
              <span>{t('admin.packages.reorderFilteredHint')}</span>
              <button
                type="button"
                onClick={resetFilters}
                className="text-brand-fg font-semibold hover:underline cursor-pointer"
              >
                {t('admin.packages.empty.resetFilters')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Packages List or Empty States */}
      {packages.length === 0 ? (
        <EmptyState
          tone="brand"
          icon={<Package />}
          title={t('admin.packages.empty.title')}
          description={t('admin.packages.empty.desc')}
          action={
            <Button variant="primary" size="sm" onClick={onNewPackage}>
              <Plus className="w-4 h-4" />
              <span>{t('admin.packages.actions.newPackage')}</span>
            </Button>
          }
        />
      ) : filteredPackages.length === 0 ? (
        <EmptyState
          tone="neutral"
          icon={<Search />}
          title={t('admin.packages.empty.filteredTitle')}
          description={t('admin.packages.empty.filteredDesc')}
          action={
            <Button variant="secondary" size="sm" onClick={resetFilters}>
              {t('admin.packages.empty.resetFilters')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {filteredPackages.map((pkg, idx) => {
            const catalogIndex = hasActiveFilters
              ? Math.max(
                  0,
                  packages.findIndex((item) => item.id === pkg.id)
                )
              : idx;
            return (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                index={catalogIndex}
                totalCount={packages.length}
                reorderEnabled={!hasActiveFilters}
                categoriesById={categoriesById}
                targetsById={targetsById}
                isToggling={isTogglingPackage && togglingPackageId === pkg.id}
                isReordering={isReorderingPackages}
                onToggle={onTogglePackage}
                onMove={onMovePackage}
                onEdit={onEditPackage}
                onClone={onClonePackage}
                onDelete={onDeletePackage}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
