import React from 'react';
import { FolderOpen, Info, Plus } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
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
          count={categories.length}
          icon={<FolderOpen className="w-4 h-4 text-brand" />}
        />
        <p className="text-xs text-ink-muted">{t('admin.packages.categories.subtitle')}</p>
      </div>

      {uncategorizedCount > 0 && (
        <div className="p-2.5 rounded-ctl bg-surface border border-line text-xs text-ink-soft flex items-center gap-2">
          <Info className="w-4 h-4 text-info shrink-0" />
          <span className="tnum">
            {t('admin.packages.categories.uncategorizedBanner', {
              count: formatNumber(uncategorizedCount),
            })}
          </span>
        </div>
      )}

      {categories.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="w-6 h-6 text-brand" />}
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
