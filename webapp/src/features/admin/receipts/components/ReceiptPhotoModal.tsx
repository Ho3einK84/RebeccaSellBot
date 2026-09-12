import React, { useState } from 'react';
import { Image as ImageIcon, ZoomIn, ZoomOut, Download, RotateCw, Copy, Check } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
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
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const { copy, isCopied } = useCopy();

  if (!photoUrl) return null;

  const handleModalClose = () => {
    setIsZoomed(false);
    setIsDownloading(false);
    setHasError(false);
    onClose();
  };

  const handleDownload = async () => {
    if (!photoUrl || isDownloading) return;
    setIsDownloading(true);
    try {
      const downloadEndpoint = photoUrl.includes('?')
        ? `${photoUrl}&download=1`
        : `${photoUrl}?download=1`;
      const res = await fetch(downloadEndpoint, { credentials: 'include' });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `receipt-${receiptId || 'proof'}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch (err) {
      console.error('Download error:', err);
      onErrorNotify?.();
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Modal
      isOpen={Boolean(photoUrl)}
      onClose={handleModalClose}
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span>{t('admin.receipts.photoModalTitle')}</span>
          {receiptId && (
            <span dir="ltr" className="font-mono text-xs text-indigo-400 font-normal">
              #{receiptId.slice(-8)}
            </span>
          )}
        </div>
      }
      icon={<ImageIcon className="w-4 h-4 text-indigo-500" />}
      maxWidth="lg"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        {/* Receipt ID badge with click-to-copy */}
        <div className="flex items-center gap-1.5 min-w-0">
          {receiptId && (
            <button
              type="button"
              onClick={() => copy(receiptId, `receipt-photo-${receiptId}`)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-mono transition-all cursor-pointer ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08] text-zinc-300'
                  : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700'
              }`}
              title={isCopied(`receipt-photo-${receiptId}`) ? t('common.copied') : t('common.copy')}
            >
              {isCopied(`receipt-photo-${receiptId}`) ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 opacity-60" />
              )}
              <span dir="ltr">#{receiptId.slice(-8)}</span>
            </button>
          )}
          {mediaType === 'document' && (
            <span className="text-[10px] text-amber-500 font-medium shrink-0">
              {t('admin.receipts.documentFile')}
            </span>
          )}
        </div>

        {/* Action buttons: Zoom & Download */}
        <div className="flex items-center gap-1.5 shrink-0">
          {!hasError && (
            <button
              type="button"
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                isZoomed
                  ? isDark
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : 'bg-amber-50 border-amber-300 text-amber-800'
                  : isDark
                    ? 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08] text-zinc-300'
                    : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
              onClick={() => setIsZoomed(!isZoomed)}
              title={isZoomed ? t('admin.receipts.zoomReset') : t('admin.receipts.zoomIn')}
            >
              {isZoomed ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
              <span>{isZoomed ? t('admin.receipts.zoomReset') : t('admin.receipts.zoomIn')}</span>
            </button>
          )}

          <button
            type="button"
            disabled={isDownloading}
            onClick={handleDownload}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all active:scale-95 cursor-pointer disabled:opacity-50 ${
              isDark
                ? 'bg-indigo-500/20 border-indigo-500/40 hover:bg-indigo-500/30 text-indigo-300'
                : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 text-indigo-700'
            }`}
            title={t('admin.receipts.downloadReceipt')}
          >
            {isDownloading ? (
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{isDownloading ? t('common.loading') : t('admin.receipts.downloadReceipt')}</span>
          </button>
        </div>
      </div>

      <div
        className={`rounded-2xl overflow-auto border flex items-center justify-center p-2 transition-all relative select-none ${
          isZoomed ? 'min-h-[380px] max-h-[75vh]' : 'min-h-[260px] max-h-[60vh]'
        } ${isDark ? 'bg-black/70 border-white/10' : 'bg-slate-900/5 border-slate-200'}`}
        style={{
          touchAction: isZoomed ? 'pan-x pan-y' : 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {hasError ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-3">
            <ImageIcon className="w-10 h-10 text-slate-400 opacity-40" />
            <p className="text-xs text-slate-400 m-0">{t('admin.receipts.noPhoto')}</p>
            <button
              type="button"
              disabled={isDownloading}
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer disabled:opacity-50"
            >
              {isDownloading ? (
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{t('admin.receipts.downloadReceipt')}</span>
            </button>
          </div>
        ) : (
          <div
            className={`transition-all duration-200 ${
              isZoomed ? 'w-[220%] max-w-none flex-shrink-0' : 'w-auto max-w-full'
            }`}
          >
            <img
              key={photoUrl}
              src={photoUrl}
              alt="Receipt proof"
              className={`rounded-xl shadow-md transition-all mx-auto select-none ${
                isZoomed
                  ? 'w-full h-auto cursor-zoom-out'
                  : 'max-h-[55vh] w-auto max-w-full object-contain cursor-zoom-in'
              }`}
              onClick={() => setIsZoomed(!isZoomed)}
              onError={() => {
                setHasError(true);
                onErrorNotify?.();
              }}
            />
          </div>
        )}
      </div>

      <div className="modal-action mt-4 flex items-center justify-between gap-3">
        <span className="text-[11px] text-slate-400 dark:text-zinc-500">
          {!hasError &&
            (isZoomed ? t('admin.receipts.zoomHintActive') : t('admin.receipts.zoomHint'))}
        </span>
        <button
          type="button"
          className={`h-9 px-4 rounded-xl text-xs font-medium border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center ${
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
