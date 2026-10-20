import React, { useState } from 'react';
import { Image as ImageIcon, ZoomIn, ZoomOut, Download, RotateCw, Copy, Check } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';

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
            <span dir="ltr" className="tnum text-xs text-brand font-normal">
              #{receiptId.slice(-8)}
            </span>
          )}
        </div>
      }
      icon={<ImageIcon className="w-4 h-4 text-brand" />}
      maxWidth="lg"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        {/* Receipt ID badge with click-to-copy */}
        <div className="flex items-center gap-1.5 min-w-0">
          {receiptId && (
            <button
              type="button"
              onClick={() => copy(receiptId, `receipt-photo-${receiptId}`)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] tnum transition-all cursor-pointer bg-surface/[0.04] border-line/10 hover:bg-surface/[0.08] text-ink-soft`}
              title={isCopied(`receipt-photo-${receiptId}`) ? t('common.copied') : t('common.copy')}
            >
              {isCopied(`receipt-photo-${receiptId}`) ? (
                <Check className="w-3 h-3 text-ok" />
              ) : (
                <Copy className="w-3 h-3 opacity-60" />
              )}
              <span dir="ltr">#{receiptId.slice(-8)}</span>
            </button>
          )}
          {mediaType === 'document' && (
            <span className="text-[10px] text-warn font-medium shrink-0">
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
                  ? 'bg-warn/20 border-warn/40 text-warn'
                  : 'bg-surface/[0.04] border-line/10 hover:bg-surface/[0.08] text-ink-soft'
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
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all active:scale-95 cursor-pointer disabled:opacity-50 bg-brand/20 border-brand/40 hover:bg-brand/30 text-brand`}
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
        } bg-black/70 border-line/10 bg-surface/5 border-line`}
        style={{
          touchAction: isZoomed ? 'pan-x pan-y' : 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {hasError ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-3">
            <ImageIcon className="w-10 h-10 text-ink-muted opacity-40" />
            <p className="text-xs text-ink-muted m-0">{t('admin.receipts.noPhoto')}</p>
            <button
              type="button"
              disabled={isDownloading}
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold text-brand-ink bg-brand hover:bg-brand cursor-pointer disabled:opacity-50"
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
        <span className="text-[11px] text-ink-muted">
          {!hasError &&
            (isZoomed ? t('admin.receipts.zoomHintActive') : t('admin.receipts.zoomHint'))}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-9 px-4"
          onClick={handleModalClose}
        >
          {t('common.close')}
        </Button>
      </div>
    </Modal>
  );
};
