import React, { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Input } from '@/shared/components/ui/Input.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import type {
  CreateVolumeTierPayload,
  UpdateVolumeTierPayload,
  VolumePricingTierDto,
} from '@/shared/types/admin.js';
import {
  validateVolumeTierForm,
  type TierPricingMode,
  type ValidationIssue,
  type VolumeTierFormValues,
} from '../packageValidation.js';

interface VolumeTierModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialTier: VolumePricingTierDto | null;
  existingTiers: readonly VolumePricingTierDto[];
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (payload: CreateVolumeTierPayload) => Promise<void>;
  onUpdate: (id: string, payload: UpdateVolumeTierPayload) => Promise<void>;
}

export const VolumeTierModal: React.FC<VolumeTierModalProps> = ({
  isOpen,
  mode,
  initialTier,
  existingTiers,
  isSubmitting,
  onClose,
  onCreate,
  onUpdate,
}) => {
  const { t } = useLanguage();
  const [values, setValues] = useState<VolumeTierFormValues>({
    id: '',
    minGb: '50',
    maxGb: '',
    mode: 'discountPercent',
    pricePerGb: '',
    discountPercent: '10',
  });
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  useTelegramBackButton(onClose, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    setIssues([]);
    if (mode === 'edit' && initialTier) {
      const resolvedMode: TierPricingMode =
        initialTier.discountPercent != null ? 'discountPercent' : 'pricePerGb';
      setValues({
        id: initialTier.id,
        minGb: String(initialTier.minGb),
        maxGb: initialTier.maxGb != null ? String(initialTier.maxGb) : '',
        mode: resolvedMode,
        pricePerGb: initialTier.pricePerGb != null ? String(initialTier.pricePerGb) : '',
        discountPercent:
          initialTier.discountPercent != null ? String(initialTier.discountPercent) : '',
      });
    } else {
      setValues({
        id: `tier-${existingTiers.length + 1}`,
        minGb: '50',
        maxGb: '',
        mode: 'discountPercent',
        pricePerGb: '',
        discountPercent: '10',
      });
    }
  }, [isOpen, mode, initialTier, existingTiers.length]);

  const fieldError = (field: string): string | null => {
    const issue = issues.find((item) => item.field === field);
    return issue ? t(issue.messageKey, issue.params) : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateVolumeTierForm(values, {
      mode,
      currentTierId: initialTier?.id,
      existingTiers,
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
          minGb: parsed.minGb,
          maxGb: parsed.maxGb ?? null,
          pricePerGb: parsed.pricePerGb ?? null,
          discountPercent: parsed.discountPercent ?? null,
        });
        onClose();
        return;
      }

      if (!initialTier) {
        onClose();
        return;
      }

      await onUpdate(initialTier.id, {
        minGb: parsed.minGb,
        maxGb: parsed.maxGb ?? null,
        pricePerGb: parsed.pricePerGb ?? null,
        discountPercent: parsed.discountPercent ?? null,
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
      maxWidth="md"
      icon={<Layers className="w-5 h-5 text-brand" />}
      title={
        mode === 'edit'
          ? t('admin.packages.tiers.formEditTitle')
          : t('admin.packages.tiers.formCreateTitle')
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            {t('admin.packages.actions.cancel')}
          </Button>
          <Button
            type="submit"
            form="volume-tier-form"
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
      <form id="volume-tier-form" onSubmit={handleSubmit} className="space-y-4">
        {fieldError('form') && (
          <p className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-ctl p-2.5">
            {fieldError('form')}
          </p>
        )}

        <div>
          <label htmlFor="tier-id-input" className="block text-xs font-semibold text-ink-soft mb-1">
            {t('admin.packages.tiers.idLabel')}
          </label>
          <Input
            id="tier-id-input"
            dir="ltr"
            disabled={mode === 'edit'}
            className="font-mono text-xs"
            value={values.id}
            placeholder={t('admin.packages.tiers.idPlaceholder')}
            onChange={(e) => setValues((prev) => ({ ...prev, id: e.target.value }))}
          />
          {fieldError('id') && <p className="text-xs text-danger mt-1">{fieldError('id')}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="tier-min-gb" className="block text-xs font-semibold text-ink-soft mb-1">
              {t('admin.packages.tiers.minGbLabel')}
            </label>
            <Input
              id="tier-min-gb"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.minGb}
              onChange={(e) => setValues((prev) => ({ ...prev, minGb: e.target.value }))}
            />
            {fieldError('minGb') && (
              <p className="text-xs text-danger mt-1">{fieldError('minGb')}</p>
            )}
          </div>

          <div>
            <label htmlFor="tier-max-gb" className="block text-xs font-semibold text-ink-soft mb-1">
              {t('admin.packages.tiers.maxGbLabel')}
            </label>
            <Input
              id="tier-max-gb"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.maxGb}
              placeholder={t('admin.packages.tiers.maxGbPlaceholder')}
              onChange={(e) => setValues((prev) => ({ ...prev, maxGb: e.target.value }))}
            />
            {fieldError('maxGb') && (
              <p className="text-xs text-danger mt-1">{fieldError('maxGb')}</p>
            )}
          </div>
        </div>

        {/* Strict XOR Mode Switch */}
        <div>
          <span className="block text-xs font-semibold text-ink-soft mb-1.5">
            {t('admin.packages.tiers.modeLabel')}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setValues((prev) => ({ ...prev, mode: 'pricePerGb' }))}
              className={`px-3 py-2 rounded-ctl border text-xs font-semibold transition-colors ${
                values.mode === 'pricePerGb'
                  ? 'bg-brand-soft border-brand text-brand-fg'
                  : 'bg-surface-2 border-line text-ink-soft'
              }`}
            >
              {t('admin.packages.tiers.modePricePerGb')}
            </button>
            <button
              type="button"
              onClick={() => setValues((prev) => ({ ...prev, mode: 'discountPercent' }))}
              className={`px-3 py-2 rounded-ctl border text-xs font-semibold transition-colors ${
                values.mode === 'discountPercent'
                  ? 'bg-brand-soft border-brand text-brand-fg'
                  : 'bg-surface-2 border-line text-ink-soft'
              }`}
            >
              {t('admin.packages.tiers.modeDiscount')}
            </button>
          </div>
        </div>

        {values.mode === 'pricePerGb' ? (
          <div>
            <label
              htmlFor="tier-price-per-gb"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.tiers.pricePerGbLabel')}
            </label>
            <Input
              id="tier-price-per-gb"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.pricePerGb}
              onChange={(e) => setValues((prev) => ({ ...prev, pricePerGb: e.target.value }))}
            />
            {fieldError('pricePerGb') && (
              <p className="text-xs text-danger mt-1">{fieldError('pricePerGb')}</p>
            )}
          </div>
        ) : (
          <div>
            <label
              htmlFor="tier-discount-pct"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.tiers.discountPercentLabel')}
            </label>
            <Input
              id="tier-discount-pct"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.discountPercent}
              onChange={(e) => setValues((prev) => ({ ...prev, discountPercent: e.target.value }))}
            />
            {fieldError('discountPercent') && (
              <p className="text-xs text-danger mt-1">{fieldError('discountPercent')}</p>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
};
