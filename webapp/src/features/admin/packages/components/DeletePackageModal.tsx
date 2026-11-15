import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
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
  useTelegramBackButton(onClose, pkg !== null);

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
      maxWidth="sm"
      icon={<Trash2 className="w-5 h-5 text-danger" />}
      title={t('admin.packages.deleteModal.title')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isDeleting}>
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
        <p className="text-sm font-medium text-ink">
          {t('admin.packages.deleteModal.confirmText', { name: displayName })}
        </p>

        {isLastPackage ? (
          <div className="p-3 rounded-ctl bg-danger-soft border border-danger/30 text-danger text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t('admin.packages.deleteModal.lastPackageBlocked')}</span>
          </div>
        ) : (
          <div className="p-3 rounded-ctl bg-warn-soft border border-warn/30 text-warn text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t('admin.packages.deleteModal.warning')}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};
