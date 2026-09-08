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
        className={`rounded-2xl overflow-hidden border flex items-center justify-center min-h-[260px] max-h-[70vh] p-2 ${
          isDark ? 'bg-black/60 border-white/10' : 'bg-slate-100/80 border-slate-200'
        }`}
      >
        <img
          src={photoUrl}
          alt="Receipt proof"
          className="max-h-[65vh] w-auto object-contain mx-auto rounded-xl shadow-md"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
            onErrorNotify?.();
          }}
        />
      </div>
      <div className="modal-action mt-4">
        <button
          type="button"
          className={`w-full h-10 px-4 rounded-xl text-xs font-medium border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center ${
            isDark
              ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 shadow-xs'
          }`}
          onClick={onClose}
        >
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
};
