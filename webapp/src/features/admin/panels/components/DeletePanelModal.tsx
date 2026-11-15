import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type { PanelSummary } from '@/shared/types/admin.js';

interface DeletePanelModalProps {
  panel: PanelSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (panelId: string) => Promise<void>;
  loading: boolean;
}

export const DeletePanelModal: React.FC<DeletePanelModalProps> = ({
  panel,
  isOpen,
  onClose,
  onConfirm,
  loading,
}) => {
  const { t } = useLanguage();
  const { textPrimary } = useThemeTokens();

  if (!panel) return null;

  const handleDelete = async () => {
    try {
      await onConfirm(panel.id);
      onClose();
    } catch {
      // Handled by caller notification
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.panels.deleteModalTitle')}
      icon={<AlertTriangle className="w-5 h-5 text-danger-fg" />}
      maxWidth="sm"
      closeOnBackdrop={!loading}
    >
      <div className="space-y-4 text-start">
        <p className={`text-sm m-0 ${textPrimary}`}>
          {t('admin.panels.deleteConfirmPrompt', { name: panel.name })}
        </p>

        <div className="p-3 rounded-tile bg-danger-soft border border-danger/25 text-xs text-danger-fg space-y-1">
          <p className="font-semibold m-0">{t('admin.panels.deleteWarningTitle')}</p>
          <p className="m-0 text-xs leading-relaxed">{t('admin.panels.deleteWarningDesc')}</p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="danger" onClick={handleDelete} loading={loading}>
            <Trash2 className="w-4 h-4" />
            <span>{t('admin.panels.confirmDeleteBtn')}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
