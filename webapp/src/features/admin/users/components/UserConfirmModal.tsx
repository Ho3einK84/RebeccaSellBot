import React, { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Input } from '@/shared/components/ui/Input.js';
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
  const { textPrimary, textSecondary } = useThemeTokens();
  const [reason, setReason] = useState('');

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm(reason.trim() || undefined);
  };

  const handleClose = () => {
    setReason('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} maxWidth="sm" closeOnBackdrop={!loading}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
              variant === 'danger'
                ? 'bg-rose-500/15 border-rose-500/25 text-rose-500'
                : variant === 'warning'
                  ? 'bg-amber-500/15 border-amber-500/25 text-amber-500'
                  : 'bg-indigo-500/15 border-indigo-500/25 text-indigo-500'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className={`font-bold text-sm sm:text-base m-0 ${textPrimary}`}>{title}</h3>
            <p className={`text-xs mt-1 leading-relaxed ${textSecondary}`}>{description}</p>
          </div>
        </div>

        {/* Reason Input if requested */}
        {showReasonInput && (
          <div className="space-y-1.5 pt-1">
            <label className={`text-[11px] font-medium block ${textSecondary}`}>
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

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
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
      </div>
    </Modal>
  );
};
