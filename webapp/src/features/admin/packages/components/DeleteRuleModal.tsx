import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';

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
  useTelegramBackButton(onClose, target !== null);

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
      maxWidth="sm"
      icon={<Trash2 className="w-5 h-5 text-danger" />}
      title={title}
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
        <p className="text-sm font-medium text-ink">{confirmText}</p>
        <div className="p-2.5 rounded-ctl bg-warn-soft border border-warn/30 text-warn text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t('admin.packages.deleteModal.warning')}</span>
        </div>
      </div>
    </Modal>
  );
};
