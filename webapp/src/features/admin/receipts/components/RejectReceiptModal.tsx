import React, { useState, useEffect } from 'react';
import { XCircle, X } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
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
  const { inputClass, textPrimary, textSecondary } = useThemeTokens();
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  // Reset state whenever a different receipt is opened: the parent closes
  // the modal via setRejectTarget(null) which bypasses handleClose.
  useEffect(() => {
    setSelectedPreset('');
    setReason('');
  }, [receipt?.id]);

  if (!receipt) return null;

  const presets = [
    { key: 'unclear', label: t('admin.receipts.reasons.unclear') },
    { key: 'not_received', label: t('admin.receipts.reasons.notReceived') },
    { key: 'duplicate', label: t('admin.receipts.reasons.duplicate') },
    { key: 'amount_mismatch', label: t('admin.receipts.reasons.mismatch') },
    { key: 'other', label: t('admin.receipts.reasons.other') },
  ];

  const handleSelectPreset = (presetKey: string) => {
    setSelectedPreset(presetKey);
    if (presetKey !== 'other') {
      setReason('');
    }
  };

  const handleConfirm = () => {
    const presetObj = presets.find((p) => p.key === selectedPreset);
    const finalReason =
      reason.trim() || (selectedPreset && selectedPreset !== 'other' ? presetObj?.label : '') || '';
    if (!finalReason) return;
    onConfirm(receipt, finalReason);
  };

  const handleClose = () => {
    setSelectedPreset('');
    setReason('');
    onClose();
  };

  return (
    <Modal
      isOpen={Boolean(receipt)}
      onClose={handleClose}
      maxWidth="md"
      title={t('admin.modals.rejectTitle')}
      icon={<XCircle className="w-5 h-5 text-danger" />}
    >
      <div className="space-y-4">
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
                  className={`px-3 py-1.5 rounded-xl text-xs transition-all active:scale-95 cursor-pointer border ${isSelected ? 'bg-danger/20 border-danger/40 text-danger font-semibold shadow-xs' : 'bg-surface/[0.04] border-line/10 text-ink-soft hover:bg-surface/[0.08]'}`}
                  onClick={() => handleSelectPreset(preset.key)}
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

        <div className="flex items-center gap-2.5 pt-3 mt-4 border-t border-line">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={handleClose}
            disabled={loading}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            className="flex-1"
            disabled={
              loading ||
              (!selectedPreset && !reason.trim()) ||
              (selectedPreset === 'other' && !reason.trim())
            }
            loading={loading}
            onClick={handleConfirm}
          >
            <X className="w-3.5 h-3.5" />
            <span>
              {loading ? t('admin.modals.rejectSubmitting') : t('admin.modals.rejectSubmit')}
            </span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
