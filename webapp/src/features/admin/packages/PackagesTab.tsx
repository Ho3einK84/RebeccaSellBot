import React, { useMemo, useState } from 'react';
import {
  FolderOpen,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Sliders,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { Button } from '@/shared/components/ui/Button.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { SegmentedControl, type SegmentedOption } from '@/shared/components/ui/SegmentedControl.js';
import { SkeletonList, SkeletonStatsGrid } from '@/shared/components/ui/Skeleton.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import type {
  AdminCategoryDto,
  AdminPackageDto,
  CustomPriceOverrideDto,
  VolumePricingTierDto,
} from '@/shared/types/admin.js';
import { useAdminPackages } from './hooks/useAdminPackages.js';
import { computePackagesKpiSummary, reorderItemsByDelta } from './packageValidation.js';
import { PackagesListSection } from './components/PackagesListSection.js';
import { PackageFormModal } from './components/PackageFormModal.js';
import { ClonePackageModal } from './components/ClonePackageModal.js';
import { DeletePackageModal } from './components/DeletePackageModal.js';
import { CategoriesListSection } from './components/CategoriesListSection.js';
import { CategoryFormModal } from './components/CategoryFormModal.js';
import { DeleteCategoryModal } from './components/DeleteCategoryModal.js';
import { CustomTariffsSection } from './components/CustomTariffsSection.js';
import { VolumeTierModal } from './components/VolumeTierModal.js';
import { PriceOverrideModal } from './components/PriceOverrideModal.js';
import { DeleteRuleModal, type PendingRuleDelete } from './components/DeleteRuleModal.js';

interface PackagesTabProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

type PackagesSubTab = 'packages' | 'categories' | 'pricing';

export const PackagesTab: React.FC<PackagesTabProps> = ({ onNotify }) => {
  const { t } = useLanguage();
  const { formatNumber, formatMoney } = useFormatters();
  const { triggerHaptic } = useHaptic();

  const [subTab, setSubTab] = useState<PackagesSubTab>('packages');

  // Package modals state
  const [pkgModalOpen, setPkgModalOpen] = useState(false);
  const [pkgModalMode, setPkgModalMode] = useState<'create' | 'edit'>('create');
  const [editingPackage, setEditingPackage] = useState<AdminPackageDto | null>(null);
  const [cloningPackage, setCloningPackage] = useState<AdminPackageDto | null>(null);
  const [deletingPackage, setDeletingPackage] = useState<AdminPackageDto | null>(null);

  // Category modals state
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catModalMode, setCatModalMode] = useState<'create' | 'edit'>('create');
  const [editingCategory, setEditingCategory] = useState<AdminCategoryDto | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<AdminCategoryDto | null>(null);

  // Pricing rule modals state
  const [tierModalOpen, setTierModalOpen] = useState(false);
  const [tierModalMode, setTierModalMode] = useState<'create' | 'edit'>('create');
  const [editingTier, setEditingTier] = useState<VolumePricingTierDto | null>(null);

  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideModalMode, setOverrideModalMode] = useState<'create' | 'edit'>('create');
  const [editingOverride, setEditingOverride] = useState<CustomPriceOverrideDto | null>(null);

  const [deletingRule, setDeletingRule] = useState<PendingRuleDelete>(null);

  const adminPkg = useAdminPackages(onNotify);
  const { packagesData, categoriesData, customPricingData } = adminPkg;

  const packages = useMemo(() => packagesData?.packages ?? [], [packagesData?.packages]);
  const categories = useMemo(
    () => categoriesData?.categories ?? packagesData?.categories ?? [],
    [categoriesData?.categories, packagesData?.categories]
  );
  const targets = useMemo(
    () => packagesData?.targets ?? customPricingData?.targets ?? [],
    [packagesData?.targets, customPricingData?.targets]
  );
  const policies = packagesData?.policies ?? {
    packageDisplayMode: 'specs' as const,
    lowTrafficThresholdGb: 5,
    expiryWarningDays: 3,
    refundWindowHours: 0,
  };
  const customSettings = customPricingData?.settings ?? {
    enabled: false,
    pricePerGb: 0,
    pricePerDay: 0,
    minGb: 1,
    maxGb: 1000,
    defaultDays: 30,
    target: null,
    warnings: [],
  };
  const tiers = useMemo(() => customPricingData?.tiers ?? [], [customPricingData?.tiers]);
  const overrides = useMemo(
    () => customPricingData?.overrides ?? [],
    [customPricingData?.overrides]
  );

  const kpis = useMemo(
    () =>
      computePackagesKpiSummary({
        packages,
        categories,
        customVolume: {
          enabled: customSettings.enabled,
          pricePerGb: customSettings.pricePerGb,
          pricePerDay: customSettings.pricePerDay,
        },
        tiersCount: tiers.length,
        overridesCount: overrides.length,
      }),
    [packages, categories, customSettings, tiers.length, overrides.length]
  );

  const subTabOptions: SegmentedOption<PackagesSubTab>[] = useMemo(
    () => [
      {
        id: 'packages',
        label: t('admin.packages.subtabs.packages'),
        icon: Package,
        count: formatNumber(packages.length),
        tone: 'brand',
      },
      {
        id: 'categories',
        label: t('admin.packages.subtabs.categories'),
        icon: FolderOpen,
        count: formatNumber(categories.length),
        tone: 'brand',
      },
      {
        id: 'pricing',
        label: t('admin.packages.subtabs.pricing'),
        icon: Layers,
        count: formatNumber(tiers.length + overrides.length),
        tone: 'brand',
      },
    ],
    [t, formatNumber, packages.length, categories.length, tiers.length, overrides.length]
  );

  const openCreatePackage = () => {
    triggerHaptic('light');
    setPkgModalMode('create');
    setEditingPackage(null);
    setPkgModalOpen(true);
  };

  const openEditPackage = (pkg: AdminPackageDto) => {
    triggerHaptic('light');
    setPkgModalMode('edit');
    setEditingPackage(pkg);
    setPkgModalOpen(true);
  };

  const handleTogglePackage = async (pkg: AdminPackageDto) => {
    triggerHaptic('selection');
    try {
      await adminPkg.togglePackage(pkg.id, !pkg.enabled);
    } catch {
      // error toast handled by useAdminPackages onError
    }
  };

  const handleMovePackage = async (pkg: AdminPackageDto, direction: 'up' | 'down') => {
    const next = reorderItemsByDelta(packages, pkg.id, direction);
    if (!next) return;
    triggerHaptic('selection');
    try {
      await adminPkg.reorderPackages(next.map((item) => item.id));
    } catch {
      // error toast handled by useAdminPackages onError
    }
  };

  const openCreateCategory = () => {
    triggerHaptic('light');
    setCatModalMode('create');
    setEditingCategory(null);
    setCatModalOpen(true);
  };

  const openEditCategory = (cat: AdminCategoryDto) => {
    triggerHaptic('light');
    setCatModalMode('edit');
    setEditingCategory(cat);
    setCatModalOpen(true);
  };

  const handleToggleCategory = async (cat: AdminCategoryDto) => {
    triggerHaptic('selection');
    try {
      await adminPkg.toggleCategory(cat.id, !cat.enabled);
    } catch {
      // error toast handled by useAdminPackages onError
    }
  };

  const handleMoveCategory = async (cat: AdminCategoryDto, direction: 'up' | 'down') => {
    const next = reorderItemsByDelta(categories, cat.id, direction);
    if (!next) return;
    triggerHaptic('selection');
    try {
      await adminPkg.reorderCategories(next.map((item) => item.id));
    } catch {
      // error toast handled by useAdminPackages onError
    }
  };

  const openCreateTier = () => {
    triggerHaptic('light');
    setTierModalMode('create');
    setEditingTier(null);
    setTierModalOpen(true);
  };

  const openEditTier = (tier: VolumePricingTierDto) => {
    triggerHaptic('light');
    setTierModalMode('edit');
    setEditingTier(tier);
    setTierModalOpen(true);
  };

  const openCreateOverride = () => {
    triggerHaptic('light');
    setOverrideModalMode('create');
    setEditingOverride(null);
    setOverrideModalOpen(true);
  };

  const openEditOverride = (rule: CustomPriceOverrideDto) => {
    triggerHaptic('light');
    setOverrideModalMode('edit');
    setEditingOverride(rule);
    setOverrideModalOpen(true);
  };

  const handleMoveOverride = async (rule: CustomPriceOverrideDto, direction: 'up' | 'down') => {
    const next = reorderItemsByDelta(overrides, rule.id, direction);
    if (!next) return;
    triggerHaptic('selection');
    try {
      await adminPkg.reorderOverrides(next.map((item) => item.id));
    } catch {
      // error toast handled by useAdminPackages onError
    }
  };

  const handleConfirmRuleDelete = async (target: NonNullable<PendingRuleDelete>) => {
    if (target.kind === 'tier') {
      await adminPkg.deleteTier(target.id);
    } else {
      await adminPkg.deleteOverride(target.id);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="min-w-0">
          <SectionHeader
            title={t('admin.packages.title')}
            icon={<Package />}
            count={
              packages.length > 0 ? <bdi dir="ltr">{formatNumber(packages.length)}</bdi> : undefined
            }
          />
          <p className="text-xs text-ink-muted mt-0.5 m-0">{t('admin.packages.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          {subTab === 'packages' && (
            <Button
              variant="primary"
              size="sm"
              disabled={packages.length >= (packagesData?.bounds.maxPackages ?? 50)}
              onClick={openCreatePackage}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('admin.packages.actions.newPackage')}</span>
            </Button>
          )}
          {subTab === 'categories' && (
            <Button variant="primary" size="sm" onClick={openCreateCategory}>
              <Plus className="w-3.5 h-3.5" />
              <span>{t('admin.packages.actions.newCategory')}</span>
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            loading={adminPkg.isFetching}
            onClick={() => void adminPkg.refetchAll()}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t('admin.packages.refresh')}</span>
          </Button>
        </div>
      </div>

      {/* Loading Skeleton */}
      {adminPkg.isLoading && (
        <div className="space-y-3">
          <SkeletonStatsGrid count={4} />
          <SkeletonList count={3} />
        </div>
      )}

      {/* Error State */}
      {!adminPkg.isLoading && adminPkg.isError && !packagesData && (
        <EmptyState
          tone="danger"
          icon={<XCircle />}
          title={t('admin.packages.loadErrorTitle')}
          description={t('admin.packages.loadErrorDesc')}
          className="border-danger/25"
          action={
            <Button variant="primary" size="sm" onClick={() => void adminPkg.refetchAll()}>
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t('admin.packages.retry')}</span>
            </Button>
          }
        />
      )}

      {/* Loaded Content */}
      {!adminPkg.isLoading && packagesData && (
        <>
          {/* 4-Card KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <Card subCard padding="sm" className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted font-medium">
                <Package className="w-3.5 h-3.5 text-brand-fg shrink-0" />
                <span className="truncate">{t('admin.packages.kpi.activePackages')}</span>
              </div>
              <div className="text-lg font-semibold tnum text-ink">
                <bdi dir="ltr">{formatNumber(kpis.activePackages)}</bdi>
              </div>
              <div className="text-[11px] text-ink-muted tnum truncate">
                {t('admin.packages.kpi.activePackagesHint', {
                  total: formatNumber(kpis.totalPackages),
                })}
              </div>
            </Card>

            <Card subCard padding="sm" className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted font-medium">
                <FolderOpen className="w-3.5 h-3.5 text-info-fg shrink-0" />
                <span className="truncate">{t('admin.packages.kpi.categories')}</span>
              </div>
              <div className="text-lg font-semibold tnum text-ink">
                <bdi dir="ltr">{formatNumber(kpis.totalCategories)}</bdi>
              </div>
              <div className="text-[11px] text-ink-muted tnum truncate">
                {t('admin.packages.kpi.categoriesHint', {
                  active: formatNumber(kpis.activeCategories),
                })}
              </div>
            </Card>

            <Card subCard padding="sm" className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted font-medium">
                <Sparkles className="w-3.5 h-3.5 text-ok-fg shrink-0" />
                <span className="truncate">{t('admin.packages.kpi.customStatus')}</span>
              </div>
              <div
                className={`text-sm font-bold pt-0.5 ${
                  kpis.customEnabled ? 'text-ok-fg' : 'text-ink-muted'
                }`}
              >
                {kpis.customEnabled
                  ? t('admin.packages.kpi.customEnabled')
                  : t('admin.packages.kpi.customDisabled')}
              </div>
              <div className="text-[11px] text-ink-muted tnum truncate">
                {kpis.pricePerDay > 0
                  ? t('admin.packages.kpi.customRatePlusDayHint', {
                      perGb: formatMoney(kpis.pricePerGb),
                      perDay: formatMoney(kpis.pricePerDay),
                    })
                  : t('admin.packages.kpi.customRateOnlyHint', {
                      perGb: formatMoney(kpis.pricePerGb),
                      days: formatNumber(customSettings.defaultDays),
                    })}
              </div>
            </Card>

            <Card subCard padding="sm" className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted font-medium">
                <Sliders className="w-3.5 h-3.5 text-warn-fg shrink-0" />
                <span className="truncate">{t('admin.packages.kpi.rulesCount')}</span>
              </div>
              <div className="text-lg font-semibold tnum text-ink">
                <bdi dir="ltr">{formatNumber(kpis.tiersCount + kpis.overridesCount)}</bdi>
              </div>
              <div className="text-[11px] text-ink-muted tnum truncate">
                {t('admin.packages.kpi.rulesHint', {
                  tiers: formatNumber(kpis.tiersCount),
                  overrides: formatNumber(kpis.overridesCount),
                })}
              </div>
            </Card>
          </div>

          {/* Unified 3-Segment Sub-Tab Switcher */}
          <SegmentedControl
            options={subTabOptions}
            value={subTab}
            onChange={setSubTab}
            ariaLabel={t('admin.packages.subtabsAriaLabel')}
          />

          {/* Sub-Views */}
          {subTab === 'packages' && (
            <PackagesListSection
              packages={packages}
              categories={categories}
              targets={targets}
              maxPackages={packagesData.bounds.maxPackages}
              isFallbackActive={packagesData.isFallbackActive}
              isTogglingPackage={adminPkg.isTogglingPackage}
              togglingPackageId={adminPkg.togglingPackageId}
              isReorderingPackages={adminPkg.isReorderingPackages}
              onNewPackage={openCreatePackage}
              onEditPackage={openEditPackage}
              onClonePackage={(pkg) => {
                triggerHaptic('light');
                setCloningPackage(pkg);
              }}
              onDeletePackage={(pkg) => {
                triggerHaptic('light');
                setDeletingPackage(pkg);
              }}
              onTogglePackage={(pkg) => void handleTogglePackage(pkg)}
              onMovePackage={(pkg, dir) => void handleMovePackage(pkg, dir)}
            />
          )}

          {subTab === 'categories' &&
            (adminPkg.isCategoriesLoading && !categoriesData ? (
              <SkeletonList count={3} />
            ) : adminPkg.isCategoriesError && !categoriesData ? (
              <EmptyState
                tone="danger"
                icon={<XCircle />}
                title={t('admin.packages.loadErrorTitle')}
                description={t('admin.packages.loadErrorDesc')}
                className="border-danger/25"
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void adminPkg.refetchCategories()}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{t('admin.packages.retry')}</span>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                {adminPkg.isCategoriesError && (
                  <AlertBanner
                    tone="danger"
                    action={
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => void adminPkg.refetchCategories()}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>{t('admin.packages.retry')}</span>
                      </Button>
                    }
                  >
                    {t('admin.packages.loadErrorDesc')}
                  </AlertBanner>
                )}
                <CategoriesListSection
                  categories={categories}
                  uncategorizedCount={
                    categoriesData?.uncategorizedPackagesCount ??
                    packages.filter((p) => !p.categoryId).length
                  }
                  isReordering={adminPkg.isReorderingCategories}
                  onNewCategory={openCreateCategory}
                  onEditCategory={openEditCategory}
                  onDeleteCategory={(cat) => {
                    triggerHaptic('light');
                    setDeletingCategory(cat);
                  }}
                  onToggleCategory={(cat) => void handleToggleCategory(cat)}
                  onMoveCategory={(cat, dir) => void handleMoveCategory(cat, dir)}
                />
              </div>
            ))}

          {subTab === 'pricing' &&
            (adminPkg.isCustomPricingLoading && !customPricingData ? (
              <SkeletonList count={3} />
            ) : adminPkg.isCustomPricingError && !customPricingData ? (
              <EmptyState
                tone="danger"
                icon={<XCircle />}
                title={t('admin.packages.loadErrorTitle')}
                description={t('admin.packages.loadErrorDesc')}
                className="border-danger/25"
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void adminPkg.refetchCustomPricing()}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{t('admin.packages.retry')}</span>
                  </Button>
                }
              />
            ) : customPricingData ? (
              <div className="space-y-3">
                {adminPkg.isCustomPricingError && (
                  <AlertBanner
                    tone="danger"
                    action={
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => void adminPkg.refetchCustomPricing()}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>{t('admin.packages.retry')}</span>
                      </Button>
                    }
                  >
                    {t('admin.packages.loadErrorDesc')}
                  </AlertBanner>
                )}
                <CustomTariffsSection
                  customPricing={customPricingData}
                  policies={policies}
                  isUpdatingCustomSettings={adminPkg.isUpdatingCustomSettings}
                  isUpdatingPolicies={adminPkg.isUpdatingPolicies}
                  isReorderingOverrides={adminPkg.isReorderingOverrides}
                  isSimulatingQuote={adminPkg.isSimulatingQuote}
                  quoteResult={adminPkg.quoteResult}
                  onSaveCustomSettings={async (payload) => {
                    await adminPkg.updateCustomSettings(payload);
                  }}
                  onSavePolicies={async (payload) => {
                    await adminPkg.updatePolicies(payload);
                  }}
                  onAddTier={openCreateTier}
                  onEditTier={openEditTier}
                  onDeleteRule={(target) => {
                    triggerHaptic('light');
                    setDeletingRule(target);
                  }}
                  onAddOverride={openCreateOverride}
                  onEditOverride={openEditOverride}
                  onMoveOverride={(rule, dir) => void handleMoveOverride(rule, dir)}
                  onSimulateQuote={adminPkg.simulateQuote}
                />
              </div>
            ) : null)}
        </>
      )}

      {/* Modals */}
      <PackageFormModal
        isOpen={pkgModalOpen}
        mode={pkgModalMode}
        initialPackage={editingPackage}
        existingPackages={packages}
        categories={categories}
        targets={targets}
        isSubmitting={adminPkg.isCreatingPackage || adminPkg.isUpdatingPackage}
        onClose={() => setPkgModalOpen(false)}
        onCreate={async (payload) => {
          await adminPkg.createPackage(payload);
        }}
        onUpdate={async (id, payload) => {
          await adminPkg.updatePackage(id, payload);
        }}
      />

      <ClonePackageModal
        pkg={cloningPackage}
        isCloning={adminPkg.isCloningPackage}
        onClose={() => setCloningPackage(null)}
        onConfirm={async (id, name) => {
          await adminPkg.clonePackage(id, name);
        }}
      />

      <DeletePackageModal
        pkg={deletingPackage}
        isLastPackage={packages.length <= 1}
        isDeleting={adminPkg.isDeletingPackage}
        onClose={() => setDeletingPackage(null)}
        onConfirm={async (id) => {
          await adminPkg.deletePackage(id);
        }}
      />

      <CategoryFormModal
        isOpen={catModalOpen}
        mode={catModalMode}
        initialCategory={editingCategory}
        nextOrder={categories.length}
        isSubmitting={adminPkg.isCreatingCategory || adminPkg.isUpdatingCategory}
        onClose={() => setCatModalOpen(false)}
        onCreate={async (payload) => {
          await adminPkg.createCategory(payload);
        }}
        onUpdate={async (id, payload) => {
          await adminPkg.updateCategory(id, payload);
        }}
      />

      <DeleteCategoryModal
        category={deletingCategory}
        isDeleting={adminPkg.isDeletingCategory}
        onClose={() => setDeletingCategory(null)}
        onConfirm={async (id) => {
          await adminPkg.deleteCategory(id);
        }}
      />

      <VolumeTierModal
        isOpen={tierModalOpen}
        mode={tierModalMode}
        initialTier={editingTier}
        existingTiers={tiers}
        isSubmitting={adminPkg.isCreatingTier || adminPkg.isUpdatingTier}
        onClose={() => setTierModalOpen(false)}
        onCreate={async (payload) => {
          await adminPkg.createTier(payload);
        }}
        onUpdate={async (id, payload) => {
          await adminPkg.updateTier(id, payload);
        }}
      />

      <PriceOverrideModal
        isOpen={overrideModalOpen}
        mode={overrideModalMode}
        initialOverride={editingOverride}
        existingOverrides={overrides}
        defaultDays={customSettings.defaultDays}
        isSubmitting={adminPkg.isCreatingOverride || adminPkg.isUpdatingOverride}
        onClose={() => setOverrideModalOpen(false)}
        onCreate={async (payload) => {
          await adminPkg.createOverride(payload);
        }}
        onUpdate={async (id, payload) => {
          await adminPkg.updateOverride(id, payload);
        }}
      />

      <DeleteRuleModal
        target={deletingRule}
        isDeleting={adminPkg.isDeletingTier || adminPkg.isDeletingOverride}
        onClose={() => setDeletingRule(null)}
        onConfirm={handleConfirmRuleDelete}
      />
    </div>
  );
};
