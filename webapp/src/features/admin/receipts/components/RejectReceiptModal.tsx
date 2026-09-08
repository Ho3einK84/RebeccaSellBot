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
        <div className="space-y-2">
          <label className={`text-xs font-semibold block ${textPrimary}`}>
            {t('admin.modals.rejectReasonLabel')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => {
              const isSelected = selectedPreset === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  className={`px-3 py-1.5 rounded-xl text-xs transition-all active:scale-95 cursor-pointer border ${
                    isSelected
                      ? isDark
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 font-semibold shadow-xs'
                        : 'bg-rose-50 border-rose-300 text-rose-800 font-semibold shadow-xs'
                      : isDark
                        ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]'
                        : 'bg-slate-100 border-slate-200/80 text-slate-700 hover:bg-slate-200'
                  }`}
                  onClick={() => handleSelectPreset(preset.key, preset.label)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <textarea
          className={`w-full p-3 text-xs sm:text-sm rounded-xl border outline-none resize-none transition-all ${inputClass}`}
          rows={2}
          placeholder={t('admin.modals.rejectReasonPlaceholder')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        <div className="modal-action mt-5 flex gap-2.5">
          <button
            type="button"
            className={`flex-1 h-10 px-4 rounded-xl text-xs font-medium border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center ${
              isDark
                ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 shadow-xs'
            }`}
            onClick={handleClose}
            disabled={loading}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`flex-1 h-10 px-4 rounded-xl font-semibold text-xs border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 ${
              isDark
                ? 'bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/30 text-rose-300 shadow-xs'
                : 'bg-rose-600 hover:bg-rose-500 text-white border-rose-600 shadow-xs'
            }`}
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
