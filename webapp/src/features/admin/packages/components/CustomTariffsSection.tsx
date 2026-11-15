import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Info,
  Layers,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Sliders,
  Trash2,
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Input } from '@/shared/components/ui/Input.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type {
  AdminCustomPricingResponse,
  AdminPackagePoliciesDto,
  AdminPricingQuoteResponse,
  CustomPriceOverrideDto,
  UpdateCustomPricingSettingsPayload,
  VolumePricingTierDto,
} from '@/shared/types/admin.js';
import {
  computeTierEffectivePricePerGb,
  MAX_PRICE_RULES,
  parseNonNegativeIntInput,
  parsePositiveIntInput,
  validateCustomSettingsForm,
  validatePoliciesForm,
  WEB_MAX_DURATION_DAYS,
  type CustomSettingsFormValues,
  type PoliciesFormValues,
  type ValidationIssue,
} from '../packageValidation.js';
import { QuoteSimulatorCard } from './QuoteSimulatorCard.js';
import type { PendingRuleDelete } from './DeleteRuleModal.js';

interface CustomTariffsSectionProps {
  customPricing: AdminCustomPricingResponse;
  policies: AdminPackagePoliciesDto;
  isUpdatingCustomSettings: boolean;
  isUpdatingPolicies: boolean;
  isReorderingOverrides: boolean;
  isSimulatingQuote: boolean;
  quoteResult: AdminPricingQuoteResponse | undefined;
  onSaveCustomSettings: (payload: UpdateCustomPricingSettingsPayload) => Promise<void>;
  onSavePolicies: (payload: Partial<AdminPackagePoliciesDto>) => Promise<void>;
  onAddTier: () => void;
  onEditTier: (tier: VolumePricingTierDto) => void;
  onDeleteRule: (target: NonNullable<PendingRuleDelete>) => void;
  onAddOverride: () => void;
  onEditOverride: (rule: CustomPriceOverrideDto) => void;
  onMoveOverride: (rule: CustomPriceOverrideDto, direction: 'up' | 'down') => void;
  onSimulateQuote: (input: {
    gbAmount: number;
    durationDays: number;
  }) => Promise<AdminPricingQuoteResponse>;
}

export const CustomTariffsSection: React.FC<CustomTariffsSectionProps> = ({
  customPricing,
  policies,
  isUpdatingCustomSettings,
  isUpdatingPolicies,
  isReorderingOverrides,
  isSimulatingQuote,
  quoteResult,
  onSaveCustomSettings,
  onSavePolicies,
  onAddTier,
  onEditTier,
  onDeleteRule,
  onAddOverride,
  onEditOverride,
  onMoveOverride,
  onSimulateQuote,
}) => {
  const { t } = useLanguage();
  const { formatNumber, formatMoney } = useFormatters();
  const { inputClass } = useThemeTokens();

  const { settings, tiers, overrides, targets, bounds } = customPricing;

  const [customForm, setCustomForm] = useState<CustomSettingsFormValues>({
    enabled: settings.enabled,
    pricePerGb: String(settings.pricePerGb),
    pricePerDay: String(settings.pricePerDay),
    minGb: String(settings.minGb),
    maxGb: String(settings.maxGb),
    defaultDays: String(settings.defaultDays),
    panelId: settings.target?.panelId ?? '',
    serviceId: settings.target ? String(settings.target.serviceId) : '',
  });
  const [customIssues, setCustomIssues] = useState<ValidationIssue[]>([]);

  const [policiesForm, setPoliciesForm] = useState<PoliciesFormValues>({
    packageDisplayMode: policies.packageDisplayMode,
    lowTrafficThresholdGb: String(policies.lowTrafficThresholdGb),
    expiryWarningDays: String(policies.expiryWarningDays),
    refundWindowHours: String(policies.refundWindowHours),
  });
  const [policyIssues, setPolicyIssues] = useState<ValidationIssue[]>([]);

  useEffect(() => {
    setCustomForm({
      enabled: settings.enabled,
      pricePerGb: String(settings.pricePerGb),
      pricePerDay: String(settings.pricePerDay),
      minGb: String(settings.minGb),
      maxGb: String(settings.maxGb),
      defaultDays: String(settings.defaultDays),
      panelId: settings.target?.panelId ?? '',
      serviceId: settings.target ? String(settings.target.serviceId) : '',
    });
    setCustomIssues([]);
  }, [settings]);

  useEffect(() => {
    setPoliciesForm({
      packageDisplayMode: policies.packageDisplayMode,
      lowTrafficThresholdGb: String(policies.lowTrafficThresholdGb),
      expiryWarningDays: String(policies.expiryWarningDays),
      refundWindowHours: String(policies.refundWindowHours),
    });
    setPolicyIssues([]);
  }, [policies]);

  const targetsById = useMemo(
    () => new Map(targets.map((panel) => [panel.panelId, panel])),
    [targets]
  );

  const selectedPanel = customForm.panelId ? targetsById.get(customForm.panelId) : undefined;
  const availableServices = selectedPanel?.services ?? [];

  const liveCustomDays = parsePositiveIntInput(customForm.defaultDays);
  const livePerGb = parseNonNegativeIntInput(customForm.pricePerGb);
  const livePerDay = parseNonNegativeIntInput(customForm.pricePerDay);

  const handlePanelChange = (nextPanelId: string) => {
    if (!nextPanelId) {
      setCustomForm((prev) => ({ ...prev, panelId: '', serviceId: '' }));
      return;
    }
    const panel = targetsById.get(nextPanelId);
    const fallbackSvc =
      panel?.defaultServiceId ??
      panel?.services.find((s) => s.isDefault)?.serviceId ??
      panel?.services[0]?.serviceId;
    setCustomForm((prev) => ({
      ...prev,
      panelId: nextPanelId,
      serviceId: fallbackSvc !== undefined ? String(fallbackSvc) : '',
    }));
  };

  const customError = (field: string): string | null => {
    const issue = customIssues.find((item) => item.field === field);
    return issue ? t(issue.messageKey, issue.params) : null;
  };

  const policyError = (field: string): string | null => {
    const issue = policyIssues.find((item) => item.field === field);
    return issue ? t(issue.messageKey, issue.params) : null;
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateCustomSettingsForm(customForm);
    if (!validation.valid || !validation.parsed) {
      setCustomIssues(validation.errors);
      return;
    }
    setCustomIssues([]);
    const parsed = validation.parsed;

    try {
      await onSaveCustomSettings({
        enabled: parsed.enabled,
        pricePerGb: parsed.pricePerGb,
        pricePerDay: parsed.pricePerDay,
        minGb: parsed.minGb,
        maxGb: parsed.maxGb,
        defaultDays: parsed.defaultDays,
        target:
          parsed.panelId && parsed.serviceId !== undefined
            ? { panelId: parsed.panelId, serviceId: parsed.serviceId }
            : null,
      });
    } catch {
      // error toast handled by useAdminPackages onError
    }
  };

  const handlePoliciesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validatePoliciesForm(policiesForm);
    if (!validation.valid || !validation.parsed) {
      setPolicyIssues(validation.errors);
      return;
    }
    setPolicyIssues([]);
    try {
      await onSavePolicies(validation.parsed);
    } catch {
      // error toast handled by useAdminPackages onError
    }
  };

  const formatOverrideRange = (min?: number | null, max?: number | null): string | null => {
    if (min == null && max == null) return null;
    if (min != null && max != null) return `${formatNumber(min)} – ${formatNumber(max)}`;
    if (min != null) return `>= ${formatNumber(min)}`;
    return `<= ${formatNumber(max as number)}`;
  };

  const maxRules = bounds.maxRules || MAX_PRICE_RULES;

  return (
    <div className="space-y-4">
      {/* 1. Custom Volume Settings */}
      <Card padding="md" className="space-y-4">
        <div>
          <h3 className="text-sm font-bold text-ink">{t('admin.packages.custom.title')}</h3>
          <p className="text-2xs text-ink-muted mt-0.5">{t('admin.packages.custom.subtitle')}</p>
        </div>

        <form onSubmit={handleCustomSubmit} className="space-y-3.5">
          <label className="flex items-center justify-between gap-3 p-3 rounded-ctl bg-surface-2 border border-line cursor-pointer">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-ink">
                {t('admin.packages.custom.enabledLabel')}
              </div>
              <div className="text-2xs text-ink-muted mt-0.5">
                {t('admin.packages.custom.enabledHint')}
              </div>
            </div>
            <input
              type="checkbox"
              checked={customForm.enabled}
              onChange={(e) => setCustomForm((prev) => ({ ...prev, enabled: e.target.checked }))}
              className="rs-switch shrink-0"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="custom-per-gb"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.custom.pricePerGbLabel')}
              </label>
              <Input
                id="custom-per-gb"
                dir="ltr"
                inputMode="numeric"
                className="tnum"
                value={customForm.pricePerGb}
                onChange={(e) => setCustomForm((prev) => ({ ...prev, pricePerGb: e.target.value }))}
              />
              {customError('pricePerGb') && (
                <p className="text-xs text-danger mt-1">{customError('pricePerGb')}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="custom-per-day"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.custom.pricePerDayLabel')}
              </label>
              <Input
                id="custom-per-day"
                dir="ltr"
                inputMode="numeric"
                className="tnum"
                value={customForm.pricePerDay}
                onChange={(e) =>
                  setCustomForm((prev) => ({ ...prev, pricePerDay: e.target.value }))
                }
              />
              {customError('pricePerDay') && (
                <p className="text-xs text-danger mt-1">{customError('pricePerDay')}</p>
              )}
            </div>
          </div>

          {(livePerGb === 0 && livePerDay === 0) ||
          settings.warnings.includes('ZERO_BASE_RATES') ? (
            <div className="p-2.5 rounded-ctl bg-warn-soft border border-warn/30 text-warn text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t('admin.packages.custom.zeroBothRatesWarning')}</span>
            </div>
          ) : livePerGb === 0 ? (
            <div className="p-2.5 rounded-ctl bg-warn-soft border border-warn/30 text-warn text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t('admin.packages.custom.zeroPriceWarning')}</span>
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="custom-min-gb"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.custom.minGbLabel')}
              </label>
              <Input
                id="custom-min-gb"
                dir="ltr"
                inputMode="numeric"
                className="tnum"
                value={customForm.minGb}
                onChange={(e) => setCustomForm((prev) => ({ ...prev, minGb: e.target.value }))}
              />
            </div>

            <div>
              <label
                htmlFor="custom-max-gb"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.custom.maxGbLabel')}
              </label>
              <Input
                id="custom-max-gb"
                dir="ltr"
                inputMode="numeric"
                className="tnum"
                value={customForm.maxGb}
                onChange={(e) => setCustomForm((prev) => ({ ...prev, maxGb: e.target.value }))}
              />
            </div>

            <div>
              <label
                htmlFor="custom-default-days"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.custom.defaultDaysLabel')}
              </label>
              <Input
                id="custom-default-days"
                dir="ltr"
                inputMode="numeric"
                className="tnum"
                value={customForm.defaultDays}
                onChange={(e) =>
                  setCustomForm((prev) => ({ ...prev, defaultDays: e.target.value }))
                }
              />
            </div>
          </div>

          {customError('minGb') && <p className="text-xs text-danger">{customError('minGb')}</p>}
          {customError('defaultDays') && (
            <p className="text-xs text-danger">{customError('defaultDays')}</p>
          )}

          {((liveCustomDays !== null && liveCustomDays > WEB_MAX_DURATION_DAYS) ||
            settings.warnings.includes('DEFAULT_DAYS_EXCEEDS_WEB_LIMIT')) && (
            <div className="p-2.5 rounded-ctl bg-warn-soft border border-warn/30 text-warn text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t('admin.packages.custom.webDaysWarning')}</span>
            </div>
          )}

          {/* Custom Target Panel & Service */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="custom-panel-select"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.custom.targetPanelLabel')}
              </label>
              <select
                id="custom-panel-select"
                value={customForm.panelId}
                onChange={(e) => handlePanelChange(e.target.value)}
                className={`${inputClass} w-full rounded-ctl px-3 py-2 text-xs`}
              >
                <option value="">{t('admin.packages.form.panelDefaultOption')}</option>
                {targets.map((panel) => (
                  <option
                    key={panel.panelId}
                    value={panel.panelId}
                    disabled={!panel.enabled && panel.panelId !== customForm.panelId}
                  >
                    {panel.panelName}
                    {!panel.enabled ? ` (${t('admin.packages.card.panelDisabledWarning')})` : ''}
                  </option>
                ))}
                {customForm.panelId && !targetsById.has(customForm.panelId) && (
                  <option value={customForm.panelId}>
                    {t('admin.packages.card.panelMissing', { id: customForm.panelId })}
                  </option>
                )}
              </select>
            </div>

            <div>
              <label
                htmlFor="custom-service-select"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.custom.targetServiceLabel')}
              </label>
              <select
                id="custom-service-select"
                value={customForm.serviceId}
                disabled={!customForm.panelId}
                onChange={(e) => setCustomForm((prev) => ({ ...prev, serviceId: e.target.value }))}
                className={`${inputClass} w-full rounded-ctl px-3 py-2 text-xs disabled:opacity-60`}
              >
                {!customForm.panelId ? (
                  <option value="">{t('admin.packages.form.serviceDefaultOption')}</option>
                ) : availableServices.length === 0 ? (
                  <option value={customForm.serviceId}>
                    {customForm.serviceId
                      ? t('admin.packages.card.serviceMissing', { id: customForm.serviceId })
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
                    {customForm.serviceId &&
                      !availableServices.some(
                        (s) => String(s.serviceId) === customForm.serviceId
                      ) && (
                        <option value={customForm.serviceId}>
                          {t('admin.packages.card.serviceMissing', { id: customForm.serviceId })}
                        </option>
                      )}
                  </>
                )}
              </select>
            </div>
          </div>
          {customError('target') && <p className="text-xs text-danger">{customError('target')}</p>}

          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" loading={isUpdatingCustomSettings}>
              <Save className="w-4 h-4" />
              <span>
                {isUpdatingCustomSettings
                  ? t('admin.packages.custom.savingSettings')
                  : t('admin.packages.custom.saveSettings')}
              </span>
            </Button>
          </div>
        </form>
      </Card>

      {/* 2. Live Quote Simulator */}
      <QuoteSimulatorCard
        defaultGb={settings.minGb}
        defaultDays={settings.defaultDays}
        isSimulating={isSimulatingQuote}
        result={quoteResult}
        onSimulate={onSimulateQuote}
      />

      {/* 3. Volume Pricing Tiers */}
      <Card padding="md" className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-brand shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-ink">{t('admin.packages.tiers.title')}</h3>
              <p className="text-2xs text-ink-muted">{t('admin.packages.tiers.subtitle')}</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={tiers.length >= maxRules}
            onClick={onAddTier}
          >
            <Plus className="w-4 h-4" />
            <span>{t('admin.packages.tiers.addButton')}</span>
          </Button>
        </div>

        <div className="p-2.5 rounded-ctl bg-surface-2 border border-line text-2xs text-ink-muted flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-info shrink-0" />
          <span>{t('admin.packages.tiers.sortNotice')}</span>
        </div>

        {tiers.length === 0 ? (
          <EmptyState
            icon={<Layers className="w-5 h-5 text-brand" />}
            title={t('admin.packages.tiers.emptyTitle')}
            description={t('admin.packages.tiers.emptyDesc')}
          />
        ) : (
          <div className="space-y-2">
            {tiers.map((tier) => {
              const effectivePerGb = computeTierEffectivePricePerGb(
                {
                  pricePerGb: tier.pricePerGb ?? undefined,
                  discountPercent: tier.discountPercent ?? undefined,
                },
                settings.pricePerGb
              );
              const rangeLabel =
                tier.maxGb != null
                  ? t('admin.packages.tiers.rangeFormat', {
                      min: formatNumber(tier.minGb),
                      max: formatNumber(tier.maxGb),
                    })
                  : t('admin.packages.tiers.rangeOpenFormat', {
                      min: formatNumber(tier.minGb),
                    });

              return (
                <div
                  key={tier.id}
                  className="p-3 rounded-ctl bg-surface-2 border border-line flex items-center justify-between gap-2 flex-wrap"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-ink tnum">{rangeLabel}</span>
                      {tier.pricePerGb != null ? (
                        <Badge variant="info" size="xs">
                          {t('admin.packages.tiers.fixedRateBadge', {
                            price: formatMoney(tier.pricePerGb),
                          })}
                        </Badge>
                      ) : (
                        <Badge variant="success" size="xs">
                          {t('admin.packages.tiers.discountBadge', {
                            percent: formatNumber(tier.discountPercent ?? 0),
                          })}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-2xs text-ink-muted flex-wrap">
                      <span dir="ltr" className="font-mono">
                        {tier.id}
                      </span>
                      <span className="tnum">
                        → {formatMoney(effectivePerGb)} {t('admin.packages.card.perGbSuffix')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 ms-auto">
                    <Button variant="ghost" size="xs" onClick={() => onEditTier(tier)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="danger"
                      size="xs"
                      onClick={() => onDeleteRule({ kind: 'tier', id: tier.id })}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 4. Custom Price Overrides */}
      <Card padding="md" className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Sliders className="w-4 h-4 text-brand shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-ink">{t('admin.packages.overrides.title')}</h3>
              <p className="text-2xs text-ink-muted">{t('admin.packages.overrides.subtitle')}</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={overrides.length >= maxRules}
            onClick={onAddOverride}
          >
            <Plus className="w-4 h-4" />
            <span>{t('admin.packages.overrides.addButton')}</span>
          </Button>
        </div>

        <div className="p-2.5 rounded-ctl bg-info-soft border border-info/30 text-info text-2xs flex items-center gap-2">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>{t('admin.packages.overrides.priorityNotice')}</span>
        </div>

        {overrides.length === 0 ? (
          <EmptyState
            icon={<Sliders className="w-5 h-5 text-brand" />}
            title={t('admin.packages.overrides.emptyTitle')}
            description={t('admin.packages.overrides.emptyDesc')}
          />
        ) : (
          <div className="space-y-2">
            {overrides.map((rule, idx) => {
              const gbCond = formatOverrideRange(rule.minGb, rule.maxGb);
              const daysCond = formatOverrideRange(rule.minDays, rule.maxDays);

              return (
                <div
                  key={rule.id}
                  className="p-3 rounded-ctl bg-surface-2 border border-line flex items-start justify-between gap-2 flex-wrap"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-2xs font-bold px-1.5 py-0.5 rounded bg-surface-3 text-ink-soft tnum">
                        #{formatNumber(idx + 1)}
                      </span>
                      <span dir="ltr" className="text-xs font-mono font-semibold text-ink">
                        {rule.id}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" size="xs">
                        {gbCond
                          ? t('admin.packages.overrides.gbRange', { range: gbCond })
                          : t('admin.packages.overrides.conditionAllGb')}
                      </Badge>
                      <Badge variant="outline" size="xs">
                        {daysCond
                          ? t('admin.packages.overrides.daysRange', { range: daysCond })
                          : t('admin.packages.overrides.conditionAllDays')}
                      </Badge>
                      {rule.price != null && (
                        <Badge variant="warning" size="xs">
                          {t('admin.packages.overrides.fixedTotalBadge', {
                            price: formatMoney(rule.price),
                          })}
                        </Badge>
                      )}
                      {rule.pricePerGb != null && (
                        <Badge variant="info" size="xs">
                          {t('admin.packages.overrides.ratePerGbBadge', {
                            price: formatMoney(rule.pricePerGb),
                          })}
                        </Badge>
                      )}
                      {rule.pricePerDay != null && (
                        <Badge variant="info" size="xs">
                          {t('admin.packages.overrides.ratePerDayBadge', {
                            price: formatMoney(rule.pricePerDay),
                          })}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 ms-auto">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={idx === 0 || isReorderingOverrides}
                      onClick={() => onMoveOverride(rule, 'up')}
                      aria-label={t('admin.packages.actions.moveUp')}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={idx === overrides.length - 1 || isReorderingOverrides}
                      onClick={() => onMoveOverride(rule, 'down')}
                      aria-label={t('admin.packages.actions.moveDown')}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => onEditOverride(rule)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="danger"
                      size="xs"
                      onClick={() => onDeleteRule({ kind: 'override', id: rule.id })}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 5. Storefront Display & Subscription Policies */}
      <Card padding="md" className="space-y-4">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-tile bg-surface-2 border border-line flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-ok" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-ink">{t('admin.packages.policies.title')}</h3>
            <p className="text-2xs text-ink-muted mt-0.5">
              {t('admin.packages.policies.subtitle')}
            </p>
          </div>
        </div>

        <form onSubmit={handlePoliciesSubmit} className="space-y-3.5">
          <div>
            <span className="block text-xs font-semibold text-ink-soft mb-1.5">
              {t('admin.packages.policies.displayModeLabel')}
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  setPoliciesForm((prev) => ({ ...prev, packageDisplayMode: 'specs' }))
                }
                className={`px-3 py-2 rounded-ctl border text-xs font-semibold transition-colors text-start ${
                  policiesForm.packageDisplayMode === 'specs'
                    ? 'bg-brand-soft border-brand text-brand-fg'
                    : 'bg-surface-2 border-line text-ink-soft'
                }`}
              >
                {t('admin.packages.policies.displayModeSpecs')}
              </button>
              <button
                type="button"
                onClick={() => setPoliciesForm((prev) => ({ ...prev, packageDisplayMode: 'name' }))}
                className={`px-3 py-2 rounded-ctl border text-xs font-semibold transition-colors text-start ${
                  policiesForm.packageDisplayMode === 'name'
                    ? 'bg-brand-soft border-brand text-brand-fg'
                    : 'bg-surface-2 border-line text-ink-soft'
                }`}
              >
                {t('admin.packages.policies.displayModeName')}
              </button>
            </div>
            <p className="text-2xs text-ink-muted mt-1">
              {t('admin.packages.policies.displayModeHint')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="policy-low-traffic"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.policies.lowTrafficLabel')}
              </label>
              <Input
                id="policy-low-traffic"
                dir="ltr"
                inputMode="decimal"
                className="tnum"
                value={policiesForm.lowTrafficThresholdGb}
                onChange={(e) =>
                  setPoliciesForm((prev) => ({ ...prev, lowTrafficThresholdGb: e.target.value }))
                }
              />
              <p className="text-2xs text-ink-muted mt-1">
                {t('admin.packages.policies.lowTrafficHint')}
              </p>
              {policyError('lowTrafficThresholdGb') && (
                <p className="text-xs text-danger mt-1">{policyError('lowTrafficThresholdGb')}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="policy-expiry-days"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.policies.expiryWarningLabel')}
              </label>
              <Input
                id="policy-expiry-days"
                dir="ltr"
                inputMode="numeric"
                className="tnum"
                value={policiesForm.expiryWarningDays}
                onChange={(e) =>
                  setPoliciesForm((prev) => ({ ...prev, expiryWarningDays: e.target.value }))
                }
              />
              <p className="text-2xs text-ink-muted mt-1">
                {t('admin.packages.policies.expiryWarningHint')}
              </p>
              {policyError('expiryWarningDays') && (
                <p className="text-xs text-danger mt-1">{policyError('expiryWarningDays')}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="policy-refund-hours"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.policies.refundWindowLabel')}
              </label>
              <Input
                id="policy-refund-hours"
                dir="ltr"
                inputMode="numeric"
                className="tnum"
                value={policiesForm.refundWindowHours}
                onChange={(e) =>
                  setPoliciesForm((prev) => ({ ...prev, refundWindowHours: e.target.value }))
                }
              />
              <p className="text-2xs text-ink-muted mt-1">
                {t('admin.packages.policies.refundWindowHint')}
              </p>
              {policyError('refundWindowHours') && (
                <p className="text-xs text-danger mt-1">{policyError('refundWindowHours')}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" loading={isUpdatingPolicies}>
              <Save className="w-4 h-4" />
              <span>{t('admin.packages.policies.savePolicies')}</span>
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
