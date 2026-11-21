import React from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import type { AdminCategoryDto } from '@/shared/types/admin.js';
import { formatBilingualPackageName } from '../packageValidation.js';

interface DeleteCategoryModalProps {
  category: AdminCategoryDto | null;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}

export const DeleteCategoryModal: React.FC<DeleteCategoryModalProps> = ({
  category,
  isDeleting,
  onClose,
  onConfirm,
}) => {
  const { t, locale } = useLanguage();

  if (!category) return null;

  const displayName = formatBilingualPackageName(category.name, locale).primary;

  const handleConfirm = async () => {
    try {
      await onConfirm(category.id);
      onClose();
    } catch {
      // error toast handled by useAdminPackages onError; keep modal open
    }
  };

  return (
    <Modal
      isOpen={category !== null}
      onClose={onClose}
      closeOnBackdrop={!isDeleting}
      maxWidth="sm"
      icon={
        <IconTile tone="danger" size="sm">
          <Trash2 />
        </IconTile>
      }
      title={t('admin.packages.categories.deleteTitle')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isDeleting}>
            {t('admin.packages.actions.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={isDeleting}
            onClick={() => void handleConfirm()}
          >
            {isDeleting
              ? t('admin.packages.deleteModal.deleting')
              : t('admin.packages.actions.delete')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm font-medium text-ink m-0">
          {t('admin.packages.categories.deleteConfirm', { name: displayName })}
        </p>

        <AlertBanner tone="info">{t('admin.packages.categories.deleteSafeNote')}</AlertBanner>
      </div>
    </Modal>
  );
};
