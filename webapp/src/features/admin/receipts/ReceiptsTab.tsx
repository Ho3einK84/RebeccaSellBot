import React, { useState } from 'react';
import { Receipt, RotateCw, CheckCircle2 } from 'lucide-react';
import { useAdminReceipts } from './hooks/useAdminReceipts.js';
import { ReceiptCard } from './components/ReceiptCard.js';
import { ReceiptPhotoModal } from './components/ReceiptPhotoModal.js';
import { ApproveReceiptModal } from './components/ApproveReceiptModal.js';
import { RejectReceiptModal } from './components/RejectReceiptModal.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Card } from '@/shared/components/ui/Card.js';
import type { TopupReceipt } from '@/shared/types/admin.js';

interface ReceiptsTabProps {
  onInspectUser: (telegramId: number) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const ReceiptsTab: React.FC<ReceiptsTabProps> = ({ onInspectUser, onNotify }) => {
  const { t } = useLanguage();
  const { receipts, isLoading, isProcessingAction, actionMutation } = useAdminReceipts();
  const { isDark, textPrimary, textSecondary } = useThemeTokens();

  // Modals state
  const [photoTarget, setPhotoTarget] = useState<TopupReceipt | null>(null);
  const [approveTarget, setApproveTarget] = useState<TopupReceipt | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TopupReceipt | null>(null);

  const handleConfirmApprove = async (receipt: TopupReceipt) => {
    try {
      await actionMutation.mutateAsync({ id: receipt.id, action: 'approve' });
      onNotify(t('admin.notifications.receiptApproved'), 'success');
      setApproveTarget(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.notifications.receiptActionFailed');
      onNotify(msg, 'error');
    }
  };

  const handleConfirmReject = async (receipt: TopupReceipt, reason: string) => {
    try {
      await actionMutation.mutateAsync({ id: receipt.id, action: 'reject', reason });
      onNotify(t('admin.notifications.receiptRejected'), 'success');
      setRejectTarget(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.notifications.receiptActionFailed');
      onNotify(msg, 'error');
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-indigo-500" />
          <h2 className={`text-base font-bold m-0 ${textPrimary}`}>
            {t('admin.receipts.queueTitle')}
          </h2>
        </div>
        <span
          className={`text-xs px-2.5 py-1 rounded-full border font-mono ${
            isDark
              ? 'bg-white/[0.04] border-white/10 text-zinc-300'
              : 'bg-slate-100 border-slate-200 text-slate-700'
          }`}
        >
          {receipts.length} {t('common.all')}
        </span>
      </div>

      {isLoading && (
        <div className={`flex items-center justify-center p-8 gap-3 ${textSecondary}`}>
          <RotateCw className="w-5 h-5 animate-spin text-indigo-500" />
          <span className="text-sm">{t('admin.receipts.loading')}</span>
        </div>
      )}

      {!isLoading && receipts.length === 0 && (
        <Card className="p-8 text-center flex flex-col items-center gap-3">
          <div
            className={`w-12 h-12 rounded-full border flex items-center justify-center ${
              isDark
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-emerald-50 border-emerald-200 text-emerald-600'
            }`}
          >
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <p className={`text-sm m-0 ${textSecondary}`}>{t('admin.receipts.empty')}</p>
        </Card>
      )}

      {!isLoading && receipts.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          {receipts.map((receipt) => (
            <ReceiptCard
              key={receipt.id}
              receipt={receipt}
              onApprove={setApproveTarget}
              onReject={setRejectTarget}
              onViewPhoto={setPhotoTarget}
              onInspectUser={onInspectUser}
              disabled={isProcessingAction}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <ReceiptPhotoModal
        photoUrl={photoTarget ? `/api/admin/receipts/${photoTarget.id}/photo` : null}
        receiptId={photoTarget?.id ?? null}
        onClose={() => setPhotoTarget(null)}
        onErrorNotify={() => onNotify(t('admin.receipts.noPhoto'), 'error')}
      />

      <ApproveReceiptModal
        receipt={approveTarget}
        onClose={() => setApproveTarget(null)}
        onConfirm={handleConfirmApprove}
        loading={isProcessingAction}
      />

      <RejectReceiptModal
        receipt={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleConfirmReject}
        loading={isProcessingAction}
      />
    </div>
  );
};
