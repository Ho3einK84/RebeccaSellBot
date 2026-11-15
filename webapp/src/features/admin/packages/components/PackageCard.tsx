import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FolderOpen,
  HardDrive,
  Pencil,
  Server,
  Trash2,
  AlertTriangle,
  Clock,
  Tag,
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type {
  AdminCategoryDto,
  AdminPackageDto,
  AdminTargetPanelDto,
} from '@/shared/types/admin.js';
import { computePackageUnitPrice, formatBilingualPackageName } from '../packageValidation.js';

interface PackageCardProps {
  pkg: AdminPackageDto;
  index: number;
  totalCount: number;
  reorderEnabled: boolean;
  categoriesById: ReadonlyMap<string, AdminCategoryDto>;
  targetsById: ReadonlyMap<string, AdminTargetPanelDto>;
  isToggling: boolean;
  isReordering: boolean;
  onToggle: (pkg: AdminPackageDto) => void;
  onMove: (pkg: AdminPackageDto, direction: 'up' | 'down') => void;
  onEdit: (pkg: AdminPackageDto) => void;
  onClone: (pkg: AdminPackageDto) => void;
  onDelete: (pkg: AdminPackageDto) => void;
}

export const PackageCard: React.FC<PackageCardProps> = ({
  pkg,
  index,
  totalCount,
  reorderEnabled,
  categoriesById,
  targetsById,
  isToggling,
  isReordering,
  onToggle,
  onMove,
  onEdit,
  onClone,
  onDelete,
}) => {
  const { t, locale } = useLanguage();
  const { formatNumber, formatMoney } = useFormatters();

  const { primary, secondary } = formatBilingualPackageName(pkg.name, locale);
  const unitPrice = computePackageUnitPrice(pkg.price, pkg.gbAmount);
  const category = pkg.categoryId ? categoriesById.get(pkg.categoryId) : undefined;
  const catName = category ? formatBilingualPackageName(category.name, locale).primary : null;

  const targetPanel = pkg.panelId ? targetsById.get(pkg.panelId) : undefined;
  const targetService =
    targetPanel && pkg.serviceId !== undefined
      ? targetPanel.services.find((s) => s.serviceId === pkg.serviceId)
      : undefined;

  const hasTargetWarning =
    pkg.panelId !== undefined && (!targetPanel || !targetPanel.enabled || !targetService);

  const isLastPackage = totalCount <= 1;

  return (
    <Card
      padding="md"
      className={`transition-colors ${!pkg.enabled ? 'opacity-80 bg-surface-2/60' : ''}`}
    >
      {/* Top Row: Name, Status, Toggle */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-surface-3 text-ink-muted tnum">
              #{formatNumber(index + 1)}
            </span>
            <h3 className="text-sm font-bold text-ink truncate">{primary}</h3>
            <Badge variant={pkg.enabled ? 'success' : 'neutral'} size="xs" dot>
              {pkg.enabled
                ? t('admin.packages.card.activeBadge')
                : t('admin.packages.card.inactiveBadge')}
            </Badge>
          </div>

          {secondary && <p className="text-2xs text-ink-muted mt-0.5 truncate">{secondary}</p>}

          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span
              dir="ltr"
              className="text-2xs font-mono text-ink-muted bg-surface-2 border border-line rounded px-1.5 py-0.5"
            >
              {pkg.id}
            </span>

            {catName ? (
              <Badge variant="info" size="xs">
                {category?.icon ? <span className="me-1">{category.icon}</span> : null}
                <span>{catName}</span>
              </Badge>
            ) : (
              <span className="inline-flex items-center gap-1 text-2xs text-ink-muted">
                <FolderOpen className="w-3 h-3 shrink-0" />
                {t('admin.packages.card.uncategorized')}
              </span>
            )}
          </div>
        </div>

        {/* Inline Active Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={pkg.enabled}
          aria-label={
            pkg.enabled
              ? t('admin.packages.actions.deactivate')
              : t('admin.packages.actions.activate')
          }
          disabled={isToggling}
          onClick={() => onToggle(pkg)}
          className="rs-switch shrink-0 mt-0.5"
        />
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-line">
        <div className="bg-surface-2 rounded-ctl px-2.5 py-2 border border-line/60 min-w-0">
          <div className="flex items-center gap-1 text-2xs text-ink-muted">
            <HardDrive className="w-3 h-3 shrink-0 text-brand" />
            <span className="truncate">{t('admin.packages.card.gbUnit')}</span>
          </div>
          <div className="text-sm font-bold text-ink tnum mt-0.5">{formatNumber(pkg.gbAmount)}</div>
        </div>

        <div className="bg-surface-2 rounded-ctl px-2.5 py-2 border border-line/60 min-w-0">
          <div className="flex items-center gap-1 text-2xs text-ink-muted">
            <Clock className="w-3 h-3 shrink-0 text-info" />
            <span className="truncate">{t('admin.packages.card.daysUnit')}</span>
          </div>
          <div className="text-sm font-bold text-ink tnum mt-0.5">
            {formatNumber(pkg.durationDays)}
          </div>
        </div>

        <div className="bg-surface-2 rounded-ctl px-2.5 py-2 border border-line/60 min-w-0">
          <div className="flex items-center gap-1 text-2xs text-ink-muted">
            <Tag className="w-3 h-3 shrink-0 text-ok" />
            <span className="truncate">{t('admin.packages.card.tomanUnit')}</span>
          </div>
          <div className="text-sm font-bold text-ink tnum mt-0.5 truncate">
            {formatMoney(pkg.price)}
          </div>
          <div className="text-2xs text-ink-muted tnum truncate">
            {formatMoney(unitPrice)} {t('admin.packages.card.perGbSuffix')}
          </div>
        </div>
      </div>

      {/* Provisioning Target & Footer Actions */}
      <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0 text-xs">
          {hasTargetWarning ? (
            <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0" />
          ) : (
            <Server className="w-3.5 h-3.5 text-ink-muted shrink-0" />
          )}

          {pkg.panelId === undefined ? (
            <span className="text-ink-muted truncate">
              {t('admin.packages.card.panelSystemDefault')}
            </span>
          ) : !targetPanel ? (
            <span className="text-warn font-medium truncate">
              {t('admin.packages.card.panelMissing', { id: pkg.panelId })}
            </span>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-ink-soft font-medium truncate">
                {targetPanel.panelName} ·{' '}
                {targetService
                  ? targetService.name
                  : t('admin.packages.card.serviceMissing', {
                      id: String(pkg.serviceId ?? ''),
                    })}
              </span>
              {!targetPanel.enabled && (
                <Badge variant="warning" size="xs">
                  {t('admin.packages.card.panelDisabledWarning')}
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 flex-wrap ms-auto">
          <Button
            variant="ghost"
            size="xs"
            disabled={!reorderEnabled || index === 0 || isReordering}
            onClick={() => onMove(pkg, 'up')}
            title={
              reorderEnabled
                ? t('admin.packages.actions.moveUp')
                : t('admin.packages.reorderFilteredHint')
            }
            aria-label={t('admin.packages.actions.moveUp')}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={!reorderEnabled || index === totalCount - 1 || isReordering}
            onClick={() => onMove(pkg, 'down')}
            title={
              reorderEnabled
                ? t('admin.packages.actions.moveDown')
                : t('admin.packages.reorderFilteredHint')
            }
            aria-label={t('admin.packages.actions.moveDown')}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onClone(pkg)}
            title={t('admin.packages.actions.clone')}
            aria-label={t('admin.packages.actions.clone')}
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => onEdit(pkg)}
            title={t('admin.packages.actions.edit')}
          >
            <Pencil className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('admin.packages.actions.edit')}</span>
          </Button>
          <Button
            variant="danger"
            size="xs"
            disabled={isLastPackage}
            onClick={() => onDelete(pkg)}
            title={
              isLastPackage
                ? t('admin.packages.card.lastPackageLocked')
                : t('admin.packages.actions.delete')
            }
            aria-label={t('admin.packages.actions.delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
};
