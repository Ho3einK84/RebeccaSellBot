import React from 'react';
import { ArrowDown, ArrowUp, Folder, Pencil, Trash2 } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { AdminCategoryDto } from '@/shared/types/admin.js';
import { formatBilingualPackageName } from '../packageValidation.js';

interface CategoryCardProps {
  category: AdminCategoryDto;
  index: number;
  totalCount: number;
  isReordering: boolean;
  onToggle: (category: AdminCategoryDto) => void;
  onMove: (category: AdminCategoryDto, direction: 'up' | 'down') => void;
  onEdit: (category: AdminCategoryDto) => void;
  onDelete: (category: AdminCategoryDto) => void;
}

export const CategoryCard: React.FC<CategoryCardProps> = ({
  category,
  index,
  totalCount,
  isReordering,
  onToggle,
  onMove,
  onEdit,
  onDelete,
}) => {
  const { t, locale } = useLanguage();
  const { formatNumber } = useFormatters();
  const { primary, secondary } = formatBilingualPackageName(category.name, locale);

  return (
    <Card padding="md" className={!category.enabled ? 'opacity-80 bg-surface-2/60' : ''}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-7 h-7 rounded-ctl bg-surface-2 border border-line flex items-center justify-center text-sm shrink-0">
              {category.icon ? category.icon : <Folder className="w-4 h-4 text-brand" />}
            </span>
            <h3 className="text-sm font-bold text-ink truncate">{primary}</h3>
            <Badge variant={category.enabled ? 'success' : 'neutral'} size="xs" dot>
              {category.enabled
                ? t('admin.packages.card.activeBadge')
                : t('admin.packages.card.inactiveBadge')}
            </Badge>
            <Badge variant="info" size="xs">
              {t('admin.packages.categories.packageCount', {
                count: formatNumber(category.linkedPackagesCount),
              })}
            </Badge>
          </div>

          {secondary && <p className="text-2xs text-ink-muted mt-1 truncate">{secondary}</p>}

          <p className="text-xs text-ink-soft mt-1.5 line-clamp-2">
            {category.description || t('admin.packages.categories.noDescription')}
          </p>
        </div>

        <input
          type="checkbox"
          checked={category.enabled}
          onChange={() => onToggle(category)}
          aria-label={
            category.enabled
              ? t('admin.packages.actions.deactivate')
              : t('admin.packages.actions.activate')
          }
          className="rs-switch shrink-0 mt-0.5 cursor-pointer"
        />
      </div>

      <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap text-2xs text-ink-muted">
          <span
            dir="ltr"
            className="font-mono bg-surface-2 border border-line rounded px-1.5 py-0.5"
          >
            {category.id}
          </span>
          <span className="tnum">
            {t('admin.packages.categories.displayOrderLabel', {
              order: formatNumber(category.displayOrder),
            })}
          </span>
        </div>

        <div className="flex items-center gap-1 ms-auto">
          <Button
            variant="ghost"
            size="xs"
            disabled={index === 0 || isReordering}
            onClick={() => onMove(category, 'up')}
            title={t('admin.packages.actions.moveUp')}
            aria-label={t('admin.packages.actions.moveUp')}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={index === totalCount - 1 || isReordering}
            onClick={() => onMove(category, 'down')}
            title={t('admin.packages.actions.moveDown')}
            aria-label={t('admin.packages.actions.moveDown')}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </Button>
          <Button variant="secondary" size="xs" onClick={() => onEdit(category)}>
            <Pencil className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('admin.packages.actions.edit')}</span>
          </Button>
          <Button
            variant="danger"
            size="xs"
            onClick={() => onDelete(category)}
            aria-label={t('admin.packages.actions.delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
};
