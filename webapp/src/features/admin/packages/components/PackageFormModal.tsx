import React, { useEffect, useMemo, useState } from 'react';
import { Package, Wand2 } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Input, Select } from '@/shared/components/ui/Input.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { Switch } from '@/shared/components/ui/Switch.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type {
  AdminCategoryDto,
  AdminPackageDto,
  AdminTargetPanelDto,
  CreateAdminPackagePayload,
  UpdateAdminPackagePayload,
} from '@/shared/types/admin.js';
import {
  computePackageUnitPrice,
  formatBilingualPackageName,
  parsePositiveIntInput,
  suggestPackageId,
  validatePackageForm,
  type OverrideTriState,
  type PackageFormValues,
  type ValidationIssue,
} from '../packageValidation.js';

interface PackageFormModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialPackage: AdminPackageDto | null;
  existingPackages: readonly AdminPackageDto[];
  categories: readonly AdminCategoryDto[];
  targets: readonly AdminTargetPanelDto[];
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (payload: CreateAdminPackagePayload) => Promise<void>;
  onUpdate: (id: string, payload: UpdateAdminPackagePayload) => Promise<void>;
}

const toTriState = (val?: boolean): OverrideTriState =>
  val === true ? 'true' : val === false ? 'false' : 'default';

const DEFAULT_VALUES: PackageFormValues = {
  id: '',
  name: '',
  gbAmount: '50',
  durationDays: '30',
  price: '',
  categoryId: '',
  panelId: '',
  serviceId: '',
  enabled: true,
  startOnFirstUse: 'default',
  rolloverQuota: 'default',
};

export const PackageFormModal: React.FC<PackageFormModalProps> = ({
  isOpen,
  mode,
  initialPackage,
  existingPackages,
  categories,
  targets,
  isSubmitting,
  onClose,
  onCreate,
  onUpdate,
}) => {
  const { t, locale } = useLanguage();
  const { formatMoney } = useFormatters();

  const [values, setValues] = useState<PackageFormValues>(DEFAULT_VALUES);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setIssues([]);
    if (mode === 'edit' && initialPackage) {
      setValues({
        id: initialPackage.id,
        name: initialPackage.name,
        gbAmount: String(initialPackage.gbAmount),
        durationDays: String(initialPackage.durationDays),
        price: String(initialPackage.price),
        categoryId: initialPackage.categoryId ?? '',
        panelId: initialPackage.panelId ?? '',
        serviceId: initialPackage.serviceId !== undefined ? String(initialPackage.serviceId) : '',
        enabled: initialPackage.enabled,
        startOnFirstUse: toTriState(initialPackage.startOnFirstUse),
        rolloverQuota: toTriState(initialPackage.rolloverQuota),
      });
    } else {
      const existingIds = new Set(existingPackages.map((p) => p.id));
      setValues({
        ...DEFAULT_VALUES,
        id: suggestPackageId(DEFAULT_VALUES.gbAmount, DEFAULT_VALUES.durationDays, existingIds),
      });
    }
  }, [isOpen, mode, initialPackage, existingPackages]);

  const targetsById = useMemo(
    () => new Map(targets.map((panel) => [panel.panelId, panel])),
    [targets]
  );

  const selectedPanel = values.panelId ? targetsById.get(values.panelId) : undefined;
  const availableServices = useMemo(() => selectedPanel?.services ?? [], [selectedPanel]);

  const showDisabledTargetNotice = useMemo(() => {
    if (!values.panelId) return false;
    const panel = targetsById.get(values.panelId);
    if (!panel || !panel.enabled) return true;
    const svcId = Number(values.serviceId);
    if (!values.serviceId || !panel.services.some((s) => s.serviceId === svcId)) {
      return true;
    }
    return false;
  }, [values.panelId, values.serviceId, targetsById]);

  const liveUnitPrice = useMemo(() => {
    const gb = parsePositiveIntInput(values.gbAmount);
    const price = parsePositiveIntInput(values.price);
    if (!gb || !price) return null;
    return computePackageUnitPrice(price, gb);
  }, [values.gbAmount, values.price]);

  const fieldError = (field: string): string | null => {
    const issue = issues.find((item) => item.field === field);
    return issue ? t(issue.messageKey, issue.params) : null;
  };

  const handleAutoGenerateId = () => {
    const existingIds = new Set(existingPackages.map((p) => p.id));
    setValues((prev) => ({
      ...prev,
      id: suggestPackageId(prev.gbAmount, prev.durationDays, existingIds),
    }));
    setIssues((prev) => prev.filter((item) => item.field !== 'id'));
  };

  const handlePanelChange = (nextPanelId: string) => {
    if (!nextPanelId) {
      setValues((prev) => ({ ...prev, panelId: '', serviceId: '' }));
      return;
    }
    const panel = targetsById.get(nextPanelId);
    const fallbackSvc =
      panel?.defaultServiceId ??
      panel?.services.find((s) => s.isDefault)?.serviceId ??
      panel?.services[0]?.serviceId;
    setValues((prev) => ({
      ...prev,
      panelId: nextPanelId,
      serviceId: fallbackSvc !== undefined ? String(fallbackSvc) : '',
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validatePackageForm(values, {
      mode,
      currentPackageId: initialPackage?.id,
      existingPackages,
    });
    if (!validation.valid || !validation.parsed) {
      setIssues(validation.errors);
      return;
    }
    setIssues([]);
    const parsed = validation.parsed;

    try {
      if (mode === 'create') {
        await onCreate({
          id: parsed.id,
          name: parsed.name,
          gbAmount: parsed.gbAmount,
          durationDays: parsed.durationDays,
          price: parsed.price,
          enabled: parsed.enabled,
          categoryId: parsed.categoryId ?? null,
          panelId: parsed.panelId ?? null,
          serviceId: parsed.serviceId ?? null,
          ...(parsed.startOnFirstUse !== undefined
            ? { startOnFirstUse: parsed.startOnFirstUse }
            : {}),
          ...(parsed.rolloverQuota !== undefined ? { rolloverQuota: parsed.rolloverQuota } : {}),
        });
        onClose();
        return;
      }

      if (!initialPackage) {
        onClose();
        return;
      }

      const patch: UpdateAdminPackagePayload = {};
      if (parsed.name !== initialPackage.name) patch.name = parsed.name;
      if (parsed.gbAmount !== initialPackage.gbAmount) patch.gbAmount = parsed.gbAmount;
      if (parsed.durationDays !== initialPackage.durationDays) {
        patch.durationDays = parsed.durationDays;
      }
      if (parsed.price !== initialPackage.price) patch.price = parsed.price;
      if (parsed.enabled !== initialPackage.enabled) patch.enabled = parsed.enabled;

      const prevCat = initialPackage.categoryId ?? undefined;
      if (parsed.categoryId !== prevCat) {
        patch.categoryId = parsed.categoryId ?? null;
      }

      const prevPanel = initialPackage.panelId;
      const prevService = initialPackage.serviceId;
      if (parsed.panelId !== prevPanel || parsed.serviceId !== prevService) {
        patch.panelId = parsed.panelId ?? null;
        patch.serviceId = parsed.serviceId ?? null;
      }

      if (parsed.startOnFirstUse !== initialPackage.startOnFirstUse) {
        patch.startOnFirstUse = parsed.startOnFirstUse ?? null;
      }
      if (parsed.rolloverQuota !== initialPackage.rolloverQuota) {
        patch.rolloverQuota = parsed.rolloverQuota ?? null;
      }

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      await onUpdate(initialPackage.id, patch);
      onClose();
    } catch {
      // error toast handled by useAdminPackages onError; keep modal open
    }
  };

  const formBannerError = fieldError('form');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdrop={!isSubmitting}
      maxWidth="lg"
      icon={
        <IconTile tone="brand" size="sm">
          <Package />
        </IconTile>
      }
      title={
        mode === 'edit' ? t('admin.packages.form.editTitle') : t('admin.packages.form.createTitle')
      }
      subtitle={
        mode === 'edit'
          ? t('admin.packages.form.editSubtitle')
          : t('admin.packages.form.createSubtitle')
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isSubmitting}>
            {t('admin.packages.actions.cancel')}
          </Button>
          <Button
            type="submit"
            form="admin-package-form"
            variant="primary"
            size="sm"
            loading={isSubmitting}
          >
            {isSubmitting
              ? t('admin.packages.actions.saving')
              : mode === 'edit'
                ? t('admin.packages.actions.save')
                : t('admin.packages.actions.create')}
          </Button>
        </div>
      }
    >
      <form id="admin-package-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {formBannerError && <AlertBanner tone="danger">{formBannerError}</AlertBanner>}

        {/* Package ID */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="pkg-id-input" className="text-xs font-semibold text-ink-soft">
              {t('admin.packages.form.idLabel')}
            </label>
            {mode === 'create' && (
              <button
                type="button"
                onClick={handleAutoGenerateId}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-fg hover:underline cursor-pointer"
              >
                <Wand2 className="w-3 h-3" />
                {t('admin.packages.form.autoIdLabel')}
              </button>
            )}
          </div>
          <Input
            id="pkg-id-input"
            dir="ltr"
            value={values.id}
            disabled={mode === 'edit'}
            placeholder={t('admin.packages.form.idPlaceholder')}
            className="font-mono text-xs"
            onChange={(e) => setValues((prev) => ({ ...prev, id: e.target.value }))}
          />
          <p className="text-[11px] text-ink-muted mt-1 m-0">{t('admin.packages.form.idHint')}</p>
          {fieldError('id') && (
            <p className="text-xs text-danger-fg mt-1 m-0">{fieldError('id')}</p>
          )}
        </div>

        {/* Name */}
        <div>
          <label
            htmlFor="pkg-name-input"
            className="block text-xs font-semibold text-ink-soft mb-1"
          >
            {t('admin.packages.form.nameLabel')}
          </label>
          <Input
            id="pkg-name-input"
            value={values.name}
            placeholder={t('admin.packages.form.namePlaceholder')}
            onChange={(e) => setValues((prev) => ({ ...prev, name: e.target.value }))}
          />
          <p className="text-[11px] text-ink-muted mt-1 m-0">{t('admin.packages.form.nameHint')}</p>
          {fieldError('name') && (
            <p className="text-xs text-danger-fg mt-1 m-0">{fieldError('name')}</p>
          )}
        </div>

        {/* GB / Days / Price */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label
              htmlFor="pkg-gb-input"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.form.gbLabel')}
            </label>
            <Input
              id="pkg-gb-input"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.gbAmount}
              placeholder={t('admin.packages.form.gbPlaceholder')}
              onChange={(e) => setValues((prev) => ({ ...prev, gbAmount: e.target.value }))}
            />
            {fieldError('gbAmount') && (
              <p className="text-xs text-danger-fg mt-1 m-0">{fieldError('gbAmount')}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="pkg-days-input"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.form.daysLabel')}
            </label>
            <Input
              id="pkg-days-input"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.durationDays}
              placeholder={t('admin.packages.form.daysPlaceholder')}
              onChange={(e) => setValues((prev) => ({ ...prev, durationDays: e.target.value }))}
            />
            <div className="flex items-center gap-1 flex-wrap mt-1.5">
              {(['30', '60', '90', '365'] as const).map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setValues((prev) => ({ ...prev, durationDays: days }))}
                  className={`px-1.5 py-0.5 rounded border text-[11px] font-medium tnum transition-colors cursor-pointer ${
                    values.durationDays === days
                      ? 'bg-brand-soft border-brand/40 text-brand-fg'
                      : 'bg-surface-2 border-line text-ink-muted hover:text-ink'
                  }`}
                >
                  {t('admin.packages.form.presetDays', { days })}
                </button>
              ))}
            </div>
            {fieldError('durationDays') && (
              <p className="text-xs text-danger-fg mt-1 m-0">{fieldError('durationDays')}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="pkg-price-input"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.form.priceLabel')}
            </label>
            <Input
              id="pkg-price-input"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.price}
              placeholder={t('admin.packages.form.pricePlaceholder')}
              onChange={(e) => setValues((prev) => ({ ...prev, price: e.target.value }))}
            />
            {fieldError('price') && (
              <p className="text-xs text-danger-fg mt-1 m-0">{fieldError('price')}</p>
            )}
          </div>
        </div>

        {liveUnitPrice !== null && (
          <div className="px-3 py-2 rounded-ctl bg-surface-2 border border-line text-xs text-ink-soft tnum">
            {t('admin.packages.form.liveUnitPrice', {
              price: formatMoney(liveUnitPrice),
            })}
          </div>
        )}

        {/* Category */}
        <div>
          <label
            htmlFor="pkg-category-select"
            className="block text-xs font-semibold text-ink-soft mb-1"
          >
            {t('admin.packages.form.categoryLabel')}
          </label>
          <Select
            id="pkg-category-select"
            value={values.categoryId}
            onChange={(e) => setValues((prev) => ({ ...prev, categoryId: e.target.value }))}
          >
            <option value="">{t('admin.packages.form.categoryNone')}</option>
            {categories.map((cat) => {
              const label = formatBilingualPackageName(cat.name, locale).primary;
              return (
                <option key={cat.id} value={cat.id}>
                  {cat.icon ? `${cat.icon} ` : ''}
                  {label}
                  {!cat.enabled ? ` (${t('admin.packages.card.inactiveBadge')})` : ''}
                </option>
              );
            })}
          </Select>
        </div>

        {/* Panel & Service Target */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="pkg-panel-select"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.form.panelLabel')}
            </label>
            <Select
              id="pkg-panel-select"
              value={values.panelId}
              onChange={(e) => handlePanelChange(e.target.value)}
            >
              <option value="">{t('admin.packages.form.panelDefaultOption')}</option>
              {targets.map((panel) => (
                <option
                  key={panel.panelId}
                  value={panel.panelId}
                  disabled={!panel.enabled && panel.panelId !== values.panelId}
                >
                  {panel.panelName}
                  {!panel.enabled ? ` (${t('admin.packages.card.panelDisabledWarning')})` : ''}
                </option>
              ))}
              {values.panelId && !targetsById.has(values.panelId) && (
                <option value={values.panelId}>
                  {t('admin.packages.card.panelMissing', { id: values.panelId })}
                </option>
              )}
            </Select>
          </div>

          <div>
            <label
              htmlFor="pkg-service-select"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.form.serviceLabel')}
            </label>
            <Select
              id="pkg-service-select"
              value={values.serviceId}
              disabled={!values.panelId}
              onChange={(e) => setValues((prev) => ({ ...prev, serviceId: e.target.value }))}
            >
              {!values.panelId ? (
                <option value="">{t('admin.packages.form.serviceDefaultOption')}</option>
              ) : availableServices.length === 0 ? (
                <option value={values.serviceId}>
                  {values.serviceId
                    ? t('admin.packages.card.serviceMissing', { id: values.serviceId })
                    : t('admin.packages.form.noServicesInPanel')}
                </option>
              ) : (
                <>
                  <option value="">{t('admin.packages.form.serviceDefaultOption')}</option>
                  {availableServices.map((svc) => (
                    <option key={svc.serviceId} value={String(svc.serviceId)}>
                      {svc.name} (#{svc.serviceId})
                    </option>
                  ))}
                  {values.serviceId &&
                    !availableServices.some((s) => String(s.serviceId) === values.serviceId) && (
                      <option value={values.serviceId}>
                        {t('admin.packages.card.serviceMissing', { id: values.serviceId })}
                      </option>
                    )}
                </>
              )}
            </Select>
            {values.panelId && (
              <p className="text-[11px] text-ink-muted mt-1 m-0">
                {t('admin.packages.form.serviceRequiredHint')}
              </p>
            )}
          </div>
        </div>

        {showDisabledTargetNotice && (
          <AlertBanner tone="warn">{t('admin.packages.form.targetDisabledNotice')}</AlertBanner>
        )}
        {fieldError('target') && (
          <p className="text-xs text-danger-fg m-0">{fieldError('target')}</p>
        )}

        {/* Subscription Lifecycle Overrides (synced with Telegram adm:pkg:oh / adm:pkg:ro) */}
        <div className="p-3 rounded-tile bg-surface-2 border border-line space-y-3">
          <div className="text-xs font-semibold text-ink">
            {t('admin.packages.form.lifecycleTitle')}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium text-ink-soft">
                {t('admin.packages.form.startOnFirstUseLabel')}
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { val: 'default', label: t('admin.packages.form.overrideSystemDefault') },
                    { val: 'true', label: t('admin.packages.form.overrideEnable') },
                    { val: 'false', label: t('admin.packages.form.overrideDisable') },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => setValues((prev) => ({ ...prev, startOnFirstUse: opt.val }))}
                    className={`h-8 px-1.5 rounded-ctl border text-[11px] font-medium cursor-pointer transition-colors truncate ${
                      (values.startOnFirstUse ?? 'default') === opt.val
                        ? 'bg-brand-soft border-brand/40 text-brand-fg font-semibold'
                        : 'bg-surface border-line text-ink-muted hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium text-ink-soft">
                {t('admin.packages.form.rolloverQuotaLabel')}
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { val: 'default', label: t('admin.packages.form.overrideSystemDefault') },
                    { val: 'true', label: t('admin.packages.form.overrideEnable') },
                    { val: 'false', label: t('admin.packages.form.overrideDisable') },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => setValues((prev) => ({ ...prev, rolloverQuota: opt.val }))}
                    className={`h-8 px-1.5 rounded-ctl border text-[11px] font-medium cursor-pointer transition-colors truncate ${
                      (values.rolloverQuota ?? 'default') === opt.val
                        ? 'bg-brand-soft border-brand/40 text-brand-fg font-semibold'
                        : 'bg-surface border-line text-ink-muted hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Enabled Toggle */}
        <div className="flex items-center justify-between gap-3 p-3 rounded-tile bg-surface-2 border border-line">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-ink">
              {t('admin.packages.form.enabledLabel')}
            </div>
            <div className="text-[11px] text-ink-muted mt-0.5">
              {t('admin.packages.form.enabledHint')}
            </div>
          </div>
          <Switch
            checked={values.enabled}
            onChange={(checked) => setValues((prev) => ({ ...prev, enabled: checked }))}
            ariaLabel={t('admin.packages.form.enabledLabel')}
          />
        </div>
      </form>
    </Modal>
  );
};
