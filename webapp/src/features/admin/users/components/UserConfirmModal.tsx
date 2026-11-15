import React, { useState } from 'react';
import { AlertTriangle, Check, ShieldCheck } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Input } from '@/shared/components/ui/Input.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';

interface UserConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  showReasonInput?: boolean;
  reasonPlaceholder?: string;
  loading?: boolean;
}

export const UserConfirmModal: React.FC<UserConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  showReasonInput = false,
  reasonPlaceholder,
  loading = false,
}) => {
  const { t } = useLanguage();
  const { textSecondary } = useThemeTokens();
  const [reason, setReason] = useState('');

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm(reason.trim() || undefined);
  };

  const handleClose = () => {
    setReason('');
    onClose();
  };

  const tileTone = variant === 'danger' ? 'danger' : variant === 'warning' ? 'warn' : 'ok';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="sm"
      closeOnBackdrop={!loading}
      title={title}
      icon={
        <IconTile tone={tileTone} size="sm">
          {variant === 'primary' ? <ShieldCheck /> : <AlertTriangle />}
        </IconTile>
      }
      footer={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={handleClose}
            disabled={loading}
          >
            {cancelLabel || t('common.cancel')}
          </Button>

          <Button
            type="button"
            variant={variant === 'danger' ? 'danger' : 'primary'}
            className="flex-1"
            onClick={handleConfirm}
            loading={loading}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{confirmLabel}</span>
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className={`text-xs leading-relaxed m-0 ${textSecondary}`}>{description}</p>

        {showReasonInput && (
          <div className="space-y-1.5">
            <label className={`text-xs font-medium block ${textSecondary}`}>
              {t('admin.users.banReasonLabel')}
            </label>
            <Input
              type="text"
              placeholder={reasonPlaceholder || t('admin.users.banReasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};
