import React, { useState } from 'react';
import { Image as ImageIcon, ExternalLink, ZoomIn, ZoomOut, Download } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';

interface ReceiptPhotoModalProps {
  photoUrl: string | null;
  receiptId: string | null;
  mediaType?: string;
  onClose: () => void;
  onErrorNotify?: () => void;
}

export const ReceiptPhotoModal: React.FC<ReceiptPhotoModalProps> = ({
  photoUrl,
  receiptId,
  mediaType = 'photo',
  onClose,
  onErrorNotify,
}) => {
  const { t } = useLanguage();
  const { isDark } = useThemeTokens();
  const [isZoomed, setIsZoomed] = useState(false);
  const [hasError, setHasError] = useState(false);

  if (!photoUrl) return null;

  const handleModalClose = () => {
    setIsZoomed(false);
    setHasError(false);
    onClose();
  };

  return (
    <Modal
      isOpen={Boolean(photoUrl)}
      onClose={handleModalClose}
      title={`${t('admin.receipts.photoModalTitle')} #${receiptId || ''}`}
      icon={<ImageIcon className="w-4 h-4 text-indigo-500" />}
      maxWidth="lg"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs text-slate-400 dark:text-zinc-500 font-mono">
          #{receiptId} {mediaType === 'document' ? `· ${t('admin.receipts.documentFile')}` : ''}
        </span>
        <div className="flex items-center gap-1.5">
          {!hasError && (
            <button
              type="button"
              className={`p-1.5 rounded-lg border text-xs transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08] text-zinc-300'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
              onClick={() => setIsZoomed(!isZoomed)}
              title={isZoomed ? t('admin.receipts.zoomOut') : t('admin.receipts.zoomIn')}
            >
              {isZoomed ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
            </button>
          )}
          <a
            href={photoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all active:scale-95 no-underline ${
              isDark
                ? 'bg-indigo-500/10 border-indigo-500/25 hover:bg-indigo-500/20 text-indigo-300'
                : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 text-indigo-700'
            }`}
          >
            <ExternalLink className="w-3 h-3" />
            <span>{t('admin.receipts.openInNewTab')}</span>
          </a>
        </div>
      </div>

      <div
        className={`rounded-2xl overflow-auto border flex items-center justify-center p-2 transition-all ${
          isZoomed ? 'max-h-[85vh]' : 'min-h-[260px] max-h-[65vh]'
        } ${isDark ? 'bg-black/60 border-white/10' : 'bg-slate-100/80 border-slate-200'}`}
      >
        {hasError ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-3">
            <ImageIcon className="w-10 h-10 text-slate-400 opacity-40" />
            <p className="text-xs text-slate-400 m-0">{t('admin.receipts.noPhoto')}</p>
            <a
              href={photoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('admin.receipts.downloadFile')}</span>
            </a>
          </div>
        ) : (
          <img
            key={photoUrl}
            src={photoUrl}
            alt="Receipt proof"
            className={`rounded-xl shadow-md transition-all ${
              isZoomed ? 'w-full object-contain' : 'max-h-[60vh] w-auto object-contain mx-auto'
            }`}
            onError={() => {
              setHasError(true);
              onErrorNotify?.();
            }}
          />
        )}
      </div>

      <div className="modal-action mt-4">
        <button
          type="button"
          className={`w-full h-10 px-4 rounded-xl text-xs font-medium border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center ${
            isDark
              ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 shadow-xs'
          }`}
          onClick={handleModalClose}
        >
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
};
