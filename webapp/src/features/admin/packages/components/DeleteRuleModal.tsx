import React from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';

export type PendingRuleDelete =
  { kind: 'tier'; id: string } | { kind: 'override'; id: string } | null;

interface DeleteRuleModalProps {
  target: PendingRuleDelete;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: (target: NonNullable<PendingRuleDelete>) => Promise<void>;
}

export const DeleteRuleModal: React.FC<DeleteRuleModalProps> = ({
  target,
  isDeleting,
  onClose,
  onConfirm,
}) => {
  const { t } = useLanguage();

  if (!target) return null;

  const title =
    target.kind === 'tier'
      ? t('admin.packages.tiers.deleteTitle')
      : t('admin.packages.overrides.deleteTitle');
  const confirmText =
    target.kind === 'tier'
      ? t('admin.packages.tiers.deleteConfirm', { id: target.id })
      : t('admin.packages.overrides.deleteConfirm', { id: target.id });

  const handleConfirm = async () => {
    try {
      await onConfirm(target);
      onClose();
    } catch {
      // error toast handled by useAdminPackages onError; keep modal open
    }
  };

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      closeOnBackdrop={!isDeleting}
      maxWidth="sm"
      icon={
        <IconTile tone="danger" size="sm">
          <Trash2 />
        </IconTile>
      }
      title={title}
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
        <p className="text-sm font-medium text-ink m-0">{confirmText}</p>
        <AlertBanner tone="warn">{t('admin.packages.deleteModal.warning')}</AlertBanner>
      </div>
    </Modal>
  );
};
