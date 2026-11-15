import React, { useEffect, useState } from 'react';
import { Info, Sliders } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Input } from '@/shared/components/ui/Input.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import type {
  CreatePriceOverridePayload,
  CustomPriceOverrideDto,
  UpdatePriceOverridePayload,
} from '@/shared/types/admin.js';
import {
  validatePriceOverrideForm,
  type PriceOverrideFormValues,
  type ValidationIssue,
} from '../packageValidation.js';

interface PriceOverrideModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialOverride: CustomPriceOverrideDto | null;
  existingOverrides: readonly CustomPriceOverrideDto[];
  defaultDays?: number;
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (payload: CreatePriceOverridePayload) => Promise<void>;
  onUpdate: (id: string, payload: UpdatePriceOverridePayload) => Promise<void>;
}

export const PriceOverrideModal: React.FC<PriceOverrideModalProps> = ({
  isOpen,
  mode,
  initialOverride,
  existingOverrides,
  defaultDays = 30,
  isSubmitting,
  onClose,
  onCreate,
  onUpdate,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();
  const daysDisplay = formatNumber(defaultDays);
  const [values, setValues] = useState<PriceOverrideFormValues>({
    id: '',
    minGb: '',
    maxGb: '',
    minDays: '',
    maxDays: '',
    price: '',
    pricePerGb: '',
    pricePerDay: '',
  });
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  useTelegramBackButton(onClose, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    setIssues([]);
    if (mode === 'edit' && initialOverride) {
      setValues({
        id: initialOverride.id,
        minGb: initialOverride.minGb != null ? String(initialOverride.minGb) : '',
        maxGb: initialOverride.maxGb != null ? String(initialOverride.maxGb) : '',
        minDays: initialOverride.minDays != null ? String(initialOverride.minDays) : '',
        maxDays: initialOverride.maxDays != null ? String(initialOverride.maxDays) : '',
        price: initialOverride.price != null ? String(initialOverride.price) : '',
        pricePerGb: initialOverride.pricePerGb != null ? String(initialOverride.pricePerGb) : '',
        pricePerDay: initialOverride.pricePerDay != null ? String(initialOverride.pricePerDay) : '',
      });
    } else {
      setValues({
        id: `rule-${existingOverrides.length + 1}`,
        minGb: '',
        maxGb: '',
        minDays: '',
        maxDays: '',
        price: '',
        pricePerGb: '',
        pricePerDay: '',
      });
    }
  }, [isOpen, mode, initialOverride, existingOverrides.length]);

  const fieldError = (field: string): string | null => {
    const issue = issues.find((item) => item.field === field);
    return issue ? t(issue.messageKey, issue.params) : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validatePriceOverrideForm(values, {
      mode,
      currentOverrideId: initialOverride?.id,
      existingOverrides,
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
          minGb: parsed.minGb ?? null,
          maxGb: parsed.maxGb ?? null,
          minDays: parsed.minDays ?? null,
          maxDays: parsed.maxDays ?? null,
          price: parsed.price ?? null,
          pricePerGb: parsed.pricePerGb ?? null,
          pricePerDay: parsed.pricePerDay ?? null,
        });
        onClose();
        return;
      }

      if (!initialOverride) {
        onClose();
        return;
      }

      await onUpdate(initialOverride.id, {
        minGb: parsed.minGb ?? null,
        maxGb: parsed.maxGb ?? null,
        minDays: parsed.minDays ?? null,
        maxDays: parsed.maxDays ?? null,
        price: parsed.price ?? null,
        pricePerGb: parsed.pricePerGb ?? null,
        pricePerDay: parsed.pricePerDay ?? null,
      });
      onClose();
    } catch {
      // error toast handled by useAdminPackages onError; keep modal open
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="lg"
      icon={<Sliders className="w-5 h-5 text-brand" />}
      title={
        mode === 'edit'
          ? t('admin.packages.overrides.formEditTitle')
          : t('admin.packages.overrides.formCreateTitle')
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            {t('admin.packages.actions.cancel')}
          </Button>
          <Button
            type="submit"
            form="price-override-form"
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
      <form id="price-override-form" onSubmit={handleSubmit} className="space-y-4">
        {fieldError('form') && (
          <p className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-ctl p-2.5">
            {fieldError('form')}
          </p>
        )}

        <div>
          <label
            htmlFor="override-id-input"
            className="block text-xs font-semibold text-ink-soft mb-1"
          >
            {t('admin.packages.overrides.idLabel')}
          </label>
          <Input
            id="override-id-input"
            dir="ltr"
            disabled={mode === 'edit'}
            className="font-mono text-xs"
            value={values.id}
            placeholder={t('admin.packages.overrides.idPlaceholder')}
            onChange={(e) => setValues((prev) => ({ ...prev, id: e.target.value }))}
          />
          {fieldError('id') && <p className="text-xs text-danger mt-1">{fieldError('id')}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="override-min-gb"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.overrides.minGbLabel')}
            </label>
            <Input
              id="override-min-gb"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.minGb}
              placeholder={t('admin.packages.overrides.optionalPlaceholder')}
              onChange={(e) => setValues((prev) => ({ ...prev, minGb: e.target.value }))}
            />
          </div>

          <div>
            <label
              htmlFor="override-max-gb"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.overrides.maxGbLabel')}
            </label>
            <Input
              id="override-max-gb"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.maxGb}
              placeholder={t('admin.packages.overrides.optionalPlaceholder')}
              onChange={(e) => setValues((prev) => ({ ...prev, maxGb: e.target.value }))}
            />
          </div>
        </div>
        {fieldError('gbRange') && (
          <p className="text-xs text-danger -mt-2">{fieldError('gbRange')}</p>
        )}

        {/* Duration bounds — dashed/dimmed while buyers stay on fixed Default Duration */}
        <div className="p-3 rounded-ctl border border-dashed border-line-strong bg-surface-2/50 opacity-90 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-ink-soft">
              {t('admin.packages.overrides.daysBoundsDimTitle')}
            </span>
            <Badge variant="outline" size="xs" className="border-dashed">
              {t('admin.packages.custom.fixedDaysStatusBadge')}
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="override-min-days"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.overrides.minDaysLabel')}
              </label>
              <Input
                id="override-min-days"
                dir="ltr"
                inputMode="numeric"
                className="tnum"
                value={values.minDays}
                placeholder={t('admin.packages.overrides.optionalPlaceholder')}
                onChange={(e) => setValues((prev) => ({ ...prev, minDays: e.target.value }))}
              />
            </div>

            <div>
              <label
                htmlFor="override-max-days"
                className="block text-xs font-semibold text-ink-soft mb-1"
              >
                {t('admin.packages.overrides.maxDaysLabel')}
              </label>
              <Input
                id="override-max-days"
                dir="ltr"
                inputMode="numeric"
                className="tnum"
                value={values.maxDays}
                placeholder={t('admin.packages.overrides.optionalPlaceholder')}
                onChange={(e) => setValues((prev) => ({ ...prev, maxDays: e.target.value }))}
              />
            </div>
          </div>

          <p className="text-[11px] text-ink-muted flex items-start gap-1.5 leading-relaxed">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ink-muted" />
            <span>{t('admin.packages.overrides.daysBoundsDimHint', { days: daysDisplay })}</span>
          </p>
        </div>
        {fieldError('daysRange') && (
          <p className="text-xs text-danger -mt-2">{fieldError('daysRange')}</p>
        )}

        <div>
          <label
            htmlFor="override-fixed-price"
            className="block text-xs font-semibold text-ink-soft mb-1"
          >
            {t('admin.packages.overrides.fixedPriceLabel')}
          </label>
          <Input
            id="override-fixed-price"
            dir="ltr"
            inputMode="numeric"
            className="tnum"
            value={values.price}
            placeholder={t('admin.packages.overrides.optionalPlaceholder')}
            onChange={(e) => setValues((prev) => ({ ...prev, price: e.target.value }))}
          />
          <p className="text-[11px] text-ink-muted mt-1">
            {t('admin.packages.overrides.fixedPriceHint')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          <div>
            <label
              htmlFor="override-per-gb"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.overrides.pricePerGbLabel')}
            </label>
            <Input
              id="override-per-gb"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.pricePerGb}
              placeholder={t('admin.packages.overrides.optionalPlaceholder')}
              onChange={(e) => setValues((prev) => ({ ...prev, pricePerGb: e.target.value }))}
            />
          </div>

          <div className="p-2.5 rounded-ctl border border-dashed border-line-strong bg-surface-2/50 opacity-90 space-y-1.5">
            <div className="flex items-center justify-between gap-1.5 flex-wrap">
              <label htmlFor="override-per-day" className="text-xs font-semibold text-ink-soft">
                {t('admin.packages.overrides.pricePerDayLabel')}
              </label>
              <Badge variant="outline" size="xs" className="border-dashed">
                {t('admin.packages.custom.fixedDaysStatusBadge')}
              </Badge>
            </div>
            <Input
              id="override-per-day"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.pricePerDay}
              placeholder={t('admin.packages.overrides.optionalPlaceholder')}
              onChange={(e) => setValues((prev) => ({ ...prev, pricePerDay: e.target.value }))}
            />
            <p className="text-[11px] text-ink-muted leading-relaxed">
              {t('admin.packages.overrides.pricePerDayDimHint', { days: daysDisplay })}
            </p>
          </div>
        </div>
        {fieldError('pricing') && (
          <p className="text-xs text-danger -mt-2">{fieldError('pricing')}</p>
        )}
      </form>
    </Modal>
  );
};
