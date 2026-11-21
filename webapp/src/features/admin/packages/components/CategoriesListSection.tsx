import React from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { AdminCategoryDto } from '@/shared/types/admin.js';
import { CategoryCard } from './CategoryCard.js';

interface CategoriesListSectionProps {
  categories: readonly AdminCategoryDto[];
  uncategorizedCount: number;
  isReordering: boolean;
  onNewCategory: () => void;
  onEditCategory: (cat: AdminCategoryDto) => void;
  onDeleteCategory: (cat: AdminCategoryDto) => void;
  onToggleCategory: (cat: AdminCategoryDto) => void;
  onMoveCategory: (cat: AdminCategoryDto, direction: 'up' | 'down') => void;
}

export const CategoriesListSection: React.FC<CategoriesListSectionProps> = ({
  categories,
  uncategorizedCount,
  isReordering,
  onNewCategory,
  onEditCategory,
  onDeleteCategory,
  onToggleCategory,
  onMoveCategory,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <SectionHeader
          title={t('admin.packages.categories.title')}
          count={formatNumber(categories.length)}
          icon={<FolderOpen />}
        />
        <p className="text-xs text-ink-muted m-0">{t('admin.packages.categories.subtitle')}</p>
      </div>

      {uncategorizedCount > 0 && (
        <AlertBanner tone="info">
          <span className="tnum">
            {t('admin.packages.categories.uncategorizedBanner', {
              count: formatNumber(uncategorizedCount),
            })}
          </span>
        </AlertBanner>
      )}

      {categories.length === 0 ? (
        <EmptyState
          tone="brand"
          icon={<FolderOpen />}
          title={t('admin.packages.categories.emptyTitle')}
          description={t('admin.packages.categories.emptyDesc')}
          action={
            <Button variant="primary" size="sm" onClick={onNewCategory}>
              <Plus className="w-4 h-4" />
              <span>{t('admin.packages.categories.newCategory')}</span>
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {categories.map((cat, idx) => (
            <CategoryCard
              key={cat.id}
              category={cat}
              index={idx}
              totalCount={categories.length}
              isReordering={isReordering}
              onToggle={onToggleCategory}
              onMove={onMoveCategory}
              onEdit={onEditCategory}
              onDelete={onDeleteCategory}
            />
          ))}
        </div>
      )}
    </div>
  );
};
