import React, { useEffect, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Input } from '@/shared/components/ui/Input.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import type {
  AdminCategoryDto,
  CreateAdminCategoryPayload,
  UpdateAdminCategoryPayload,
} from '@/shared/types/admin.js';
import {
  validateCategoryForm,
  type CategoryFormValues,
  type ValidationIssue,
} from '../packageValidation.js';

interface CategoryFormModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialCategory: AdminCategoryDto | null;
  nextOrder: number;
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (payload: CreateAdminCategoryPayload) => Promise<void>;
  onUpdate: (id: string, payload: UpdateAdminCategoryPayload) => Promise<void>;
}

export const CategoryFormModal: React.FC<CategoryFormModalProps> = ({
  isOpen,
  mode,
  initialCategory,
  nextOrder,
  isSubmitting,
  onClose,
  onCreate,
  onUpdate,
}) => {
  const { t } = useLanguage();
  const { inputClass } = useThemeTokens();

  const [values, setValues] = useState<CategoryFormValues>({
    name: '',
    icon: '',
    description: '',
    displayOrder: '0',
    enabled: true,
  });
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  useTelegramBackButton(onClose, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    setIssues([]);
    if (mode === 'edit' && initialCategory) {
      setValues({
        name: initialCategory.name,
        icon: initialCategory.icon ?? '',
        description: initialCategory.description ?? '',
        displayOrder: String(initialCategory.displayOrder),
        enabled: initialCategory.enabled,
      });
    } else {
      setValues({
        name: '',
        icon: '',
        description: '',
        displayOrder: String(nextOrder),
        enabled: true,
      });
    }
  }, [isOpen, mode, initialCategory, nextOrder]);

  const fieldError = (field: string): string | null => {
    const issue = issues.find((item) => item.field === field);
    return issue ? t(issue.messageKey, issue.params) : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateCategoryForm(values);
    if (!validation.valid || !validation.parsed) {
      setIssues(validation.errors);
      return;
    }
    setIssues([]);
    const parsed = validation.parsed;

    try {
      if (mode === 'create') {
        await onCreate({
          name: parsed.name,
          icon: parsed.icon ?? null,
          description: parsed.description ?? null,
          displayOrder: parsed.displayOrder,
          enabled: parsed.enabled,
        });
        onClose();
        return;
      }

      if (!initialCategory) {
        onClose();
        return;
      }

      const patch: UpdateAdminCategoryPayload = {};
      if (parsed.name !== initialCategory.name) patch.name = parsed.name;
      if ((parsed.icon ?? null) !== (initialCategory.icon ?? null)) {
        patch.icon = parsed.icon ?? null;
      }
      if ((parsed.description ?? null) !== (initialCategory.description ?? null)) {
        patch.description = parsed.description ?? null;
      }
      if (parsed.displayOrder !== initialCategory.displayOrder) {
        patch.displayOrder = parsed.displayOrder;
      }
      if (parsed.enabled !== initialCategory.enabled) patch.enabled = parsed.enabled;

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      await onUpdate(initialCategory.id, patch);
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
      icon={<FolderPlus className="w-5 h-5 text-brand" />}
      title={
        mode === 'edit'
          ? t('admin.packages.categories.formEditTitle')
          : t('admin.packages.categories.formCreateTitle')
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            {t('admin.packages.actions.cancel')}
          </Button>
          <Button
            type="submit"
            form="admin-category-form"
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
      <form id="admin-category-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="cat-name-input"
            className="block text-xs font-semibold text-ink-soft mb-1"
          >
            {t('admin.packages.categories.nameLabel')}
          </label>
          <Input
            id="cat-name-input"
            value={values.name}
            placeholder={t('admin.packages.categories.namePlaceholder')}
            onChange={(e) => setValues((prev) => ({ ...prev, name: e.target.value }))}
          />
          {fieldError('name') && <p className="text-xs text-danger mt-1">{fieldError('name')}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="cat-icon-input"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.categories.iconLabel')}
            </label>
            <Input
              id="cat-icon-input"
              value={values.icon}
              placeholder={t('admin.packages.categories.iconPlaceholder')}
              onChange={(e) => setValues((prev) => ({ ...prev, icon: e.target.value }))}
            />
            <p className="text-2xs text-ink-muted mt-1">
              {t('admin.packages.categories.iconHint')}
            </p>
            {fieldError('icon') && <p className="text-xs text-danger mt-1">{fieldError('icon')}</p>}
          </div>

          <div>
            <label
              htmlFor="cat-order-input"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.categories.orderLabel')}
            </label>
            <Input
              id="cat-order-input"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={values.displayOrder}
              placeholder={t('admin.packages.categories.orderPlaceholder')}
              onChange={(e) => setValues((prev) => ({ ...prev, displayOrder: e.target.value }))}
            />
            {fieldError('displayOrder') && (
              <p className="text-xs text-danger mt-1">{fieldError('displayOrder')}</p>
            )}
          </div>
        </div>

        <div>
          <label
            htmlFor="cat-desc-input"
            className="block text-xs font-semibold text-ink-soft mb-1"
          >
            {t('admin.packages.categories.descLabel')}
          </label>
          <textarea
            id="cat-desc-input"
            rows={3}
            value={values.description}
            placeholder={t('admin.packages.categories.descPlaceholder')}
            onChange={(e) => setValues((prev) => ({ ...prev, description: e.target.value }))}
            className={`${inputClass} w-full rounded-ctl px-3 py-2 text-xs`}
          />
          {fieldError('description') && (
            <p className="text-xs text-danger mt-1">{fieldError('description')}</p>
          )}
        </div>

        <label className="flex items-center justify-between gap-3 p-3 rounded-ctl bg-surface-2 border border-line cursor-pointer">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-ink">
              {t('admin.packages.categories.enabledLabel')}
            </div>
            <div className="text-2xs text-ink-muted mt-0.5">
              {t('admin.packages.categories.enabledHint')}
            </div>
          </div>
          <input
            type="checkbox"
            checked={values.enabled}
            onChange={(e) => setValues((prev) => ({ ...prev, enabled: e.target.checked }))}
            className="rs-switch shrink-0"
          />
        </label>
      </form>
    </Modal>
  );
};
