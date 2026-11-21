import React from 'react';
import { ArrowDown, ArrowUp, Folder, Pencil, Trash2 } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Switch } from '@/shared/components/ui/Switch.js';
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
    <Card
      padding="md"
      className={`transition-colors text-start ${
        category.enabled ? 'hover:border-line-strong' : 'opacity-80 bg-surface-2/60 border-line'
      }`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-8 h-8 rounded-ctl bg-surface-2 border border-line flex items-center justify-center text-base shrink-0">
              {category.icon ? category.icon : <Folder className="w-4 h-4 text-brand-fg" />}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="text-sm font-bold text-ink truncate m-0">{primary}</h3>
                <Badge variant={category.enabled ? 'success' : 'neutral'} size="xs" dot>
                  {category.enabled
                    ? t('admin.packages.card.activeBadge')
                    : t('admin.packages.card.inactiveBadge')}
                </Badge>
                <Badge variant={category.linkedPackagesCount > 0 ? 'info' : 'neutral'} size="xs">
                  {category.linkedPackagesCount > 0
                    ? t('admin.packages.categories.packageCount', {
                        count: formatNumber(category.linkedPackagesCount),
                      })
                    : t('admin.packages.categories.packageCountZero')}
                </Badge>
              </div>
              {secondary && (
                <p className="text-[11px] text-ink-muted mt-0.5 truncate m-0">{secondary}</p>
              )}
            </div>
          </div>

          <p className="text-xs text-ink-soft mt-2 line-clamp-2 m-0">
            {category.description || t('admin.packages.categories.noDescription')}
          </p>
        </div>

        <Switch
          checked={category.enabled}
          onChange={() => onToggle(category)}
          ariaLabel={
            category.enabled
              ? t('admin.packages.actions.deactivate')
              : t('admin.packages.actions.activate')
          }
          className="mt-0.5"
        />
      </div>

      <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-ink-muted">
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
