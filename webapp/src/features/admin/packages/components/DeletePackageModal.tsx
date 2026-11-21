import React from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import type { AdminPackageDto } from '@/shared/types/admin.js';
import { formatBilingualPackageName } from '../packageValidation.js';

interface DeletePackageModalProps {
  pkg: AdminPackageDto | null;
  isLastPackage: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}

export const DeletePackageModal: React.FC<DeletePackageModalProps> = ({
  pkg,
  isLastPackage,
  isDeleting,
  onClose,
  onConfirm,
}) => {
  const { t, locale } = useLanguage();

  if (!pkg) return null;

  const displayName = formatBilingualPackageName(pkg.name, locale).primary;

  const handleConfirm = async () => {
    if (isLastPackage) return;
    try {
      await onConfirm(pkg.id);
      onClose();
    } catch {
      // error toast handled by useAdminPackages onError; keep modal open
    }
  };

  return (
    <Modal
      isOpen={pkg !== null}
      onClose={onClose}
      closeOnBackdrop={!isDeleting}
      maxWidth="sm"
      icon={
        <IconTile tone="danger" size="sm">
          <Trash2 />
        </IconTile>
      }
      title={t('admin.packages.deleteModal.title')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isDeleting}>
            {t('admin.packages.actions.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={isDeleting}
            disabled={isLastPackage || isDeleting}
            onClick={() => void handleConfirm()}
          >
            {isDeleting
              ? t('admin.packages.deleteModal.deleting')
              : t('admin.packages.deleteModal.confirmButton')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm font-medium text-ink m-0">
          {t('admin.packages.deleteModal.confirmText', { name: displayName })}
        </p>

        {isLastPackage ? (
          <AlertBanner tone="danger">
            {t('admin.packages.deleteModal.lastPackageBlocked')}
          </AlertBanner>
        ) : (
          <AlertBanner tone="warn">{t('admin.packages.deleteModal.warning')}</AlertBanner>
        )}
      </div>
    </Modal>
  );
};
