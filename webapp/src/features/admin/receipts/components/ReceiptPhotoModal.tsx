import { Image as ImageIcon } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';

interface ReceiptPhotoModalProps {
  photoUrl: string | null;
  receiptId: string | null;
  onClose: () => void;
  onErrorNotify?: () => void;
}

export const ReceiptPhotoModal: React.FC<ReceiptPhotoModalProps> = ({
  photoUrl,
  receiptId,
  onClose,
  onErrorNotify,
}) => {
  const { t } = useLanguage();
  const { isDark } = useThemeTokens();

  if (!photoUrl) return null;

  return (
    <Modal
      isOpen={Boolean(photoUrl)}
      onClose={onClose}
      title={`${t('admin.receipts.photoModalTitle')} #${receiptId || ''}`}
      icon={<ImageIcon className="w-4 h-4 text-indigo-500" />}
      maxWidth="lg"
    >
      <div
        className={`rounded-xl overflow-hidden border flex items-center justify-center min-h-[260px] max-h-[70vh] ${
          isDark ? 'bg-black/50 border-white/10' : 'bg-slate-100 border-slate-200'
        }`}
      >
        <img
          src={photoUrl}
          alt="Receipt proof"
          className="max-h-[65vh] w-auto object-contain mx-auto"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
            onErrorNotify?.();
          }}
        />
      </div>
      <div className="modal-action mt-4">
        <button
          type="button"
          className={`btn btn-ghost btn-sm text-xs border rounded-xl cursor-pointer ${
            isDark ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-700'
          }`}
          onClick={onClose}
        >
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
};
