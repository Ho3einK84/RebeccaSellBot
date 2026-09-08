import React, { useState } from 'react';
import { XCircle, X, RotateCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import type { TopupReceipt } from '@/shared/types/admin.js';

interface RejectReceiptModalProps {
  receipt: TopupReceipt | null;
  onClose: () => void;
  onConfirm: (receipt: TopupReceipt, reason: string) => void;
  loading?: boolean;
}

export const RejectReceiptModal: React.FC<RejectReceiptModalProps> = ({
  receipt,
  onClose,
  onConfirm,
  loading = false,
}) => {
  const { t } = useLanguage();
  const { isDark, inputClass, textPrimary, textSecondary } = useThemeTokens();
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  if (!receipt) return null;

  const presets = [
    { key: 'unclear', label: t('admin.receipts.reasons.unclear') },
    { key: 'not_received', label: t('admin.receipts.reasons.notReceived') },
    { key: 'duplicate', label: t('admin.receipts.reasons.duplicate') },
    { key: 'mismatch', label: t('admin.receipts.reasons.mismatch') },
    { key: 'other', label: t('admin.receipts.reasons.other') },
  ];

  const handleSelectPreset = (presetKey: string, presetLabel: string) => {
    setSelectedPreset(presetKey);
    setReason(presetLabel);
  };

  const handleClose = () => {
    setSelectedPreset('');
    setReason('');
    onClose();
  };

  return (
    <Modal isOpen={Boolean(receipt)} onClose={handleClose} maxWidth="md">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className={`font-bold text-base flex items-center gap-2 ${textPrimary}`}>
            <XCircle className="w-5 h-5 text-rose-500" />
            <span>{t('admin.modals.rejectTitle')}</span>
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-xs cursor-pointer text-slate-400 hover:text-white"
            onClick={handleClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className={`text-xs m-0 ${textSecondary}`}>
          {t('admin.modals.rejectConfirm', {
            id: receipt.id,
            userId: receipt.telegramId,
          })}
        </p>

        {/* Presets Chips */}
        <div className="space-y-1.5">
          <label className={`text-xs font-medium block ${textPrimary}`}>
            {t('admin.modals.rejectReasonLabel')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={`badge badge-sm py-2 px-2.5 text-[11px] cursor-pointer transition-all border ${
                  selectedPreset === preset.key
                    ? 'badge-error text-white font-medium'
                    : isDark
                      ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/10'
                      : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                }`}
                onClick={() => handleSelectPreset(preset.key, preset.label)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <textarea
          className={`textarea textarea-bordered w-full text-xs rounded-xl ${inputClass}`}
          rows={2}
          placeholder={t('admin.modals.rejectReasonPlaceholder')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        <div className="modal-action mt-4 flex gap-2">
          <button
            type="button"
            className={`btn btn-ghost btn-sm flex-1 text-xs border rounded-xl cursor-pointer ${
              isDark ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-700'
            }`}
            onClick={handleClose}
            disabled={loading}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-error btn-sm flex-1 text-xs text-white shadow-sm rounded-xl cursor-pointer"
            disabled={loading}
            onClick={() => onConfirm(receipt, reason)}
          >
            {loading ? (
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <X className="w-3.5 h-3.5" />
            )}
            <span>
              {loading ? t('admin.modals.rejectSubmitting') : t('admin.modals.rejectSubmit')}
            </span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
