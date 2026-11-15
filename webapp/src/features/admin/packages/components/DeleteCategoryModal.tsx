import React from 'react';
import { Info, Trash2 } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
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
  useTelegramBackButton(onClose, category !== null);

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
      maxWidth="sm"
      icon={<Trash2 className="w-5 h-5 text-danger" />}
      title={t('admin.packages.categories.deleteTitle')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isDeleting}>
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
        <p className="text-sm font-medium text-ink">
          {t('admin.packages.categories.deleteConfirm', { name: displayName })}
        </p>

        <div className="p-3 rounded-ctl bg-info-soft border border-info/30 text-info text-xs flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t('admin.packages.categories.deleteSafeNote')}</span>
        </div>
      </div>
    </Modal>
  );
};
