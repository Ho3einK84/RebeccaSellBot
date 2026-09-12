import React, { useState } from 'react';
import { AlertTriangle, RotateCw, Check } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
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
  const { isDark, inputClass, textPrimary, textSecondary } = useThemeTokens();
  const [reason, setReason] = useState('');

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm(reason.trim() || undefined);
  };

  const handleClose = () => {
    setReason('');
    onClose();
  };

  const confirmBtnClass =
    variant === 'danger'
      ? 'bg-rose-600 hover:bg-rose-700 text-white'
      : variant === 'warning'
        ? 'bg-amber-600 hover:bg-amber-700 text-white'
        : 'bg-indigo-600 hover:bg-indigo-700 text-white';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} maxWidth="sm">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
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
              {t('admin.modals.balanceReasonLabel')}
            </label>
            <input
              type="text"
              className={`w-full h-9 px-3 text-xs rounded-xl border outline-none transition-all ${inputClass}`}
              placeholder={reasonPlaceholder || t('admin.users.banReasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60 dark:border-white/[0.06]">
          <button
            type="button"
            className={`flex-1 h-9 px-3 rounded-xl text-xs font-medium border transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
            }`}
            onClick={handleClose}
            disabled={loading}
          >
            {cancelLabel || t('common.cancel')}
          </button>

          <button
            type="button"
            className={`flex-1 h-9 px-3 rounded-xl text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer ${confirmBtnClass}`}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? (
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
