import React, { useState, useEffect } from 'react';
import {
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  Download,
  RotateCw,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { api } from '@/shared/lib/api.js';

export function appendDownloadQuery(photoUrl: string): string {
  return photoUrl.includes('?') ? `${photoUrl}&download=1` : `${photoUrl}?download=1`;
}

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
  const { formatId } = useFormatters();
  const [isZoomed, setIsZoomed] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoadingPhoto, setIsLoadingPhoto] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const { copy, isCopied } = useCopy();

  useEffect(() => {
    setIsZoomed(false);
    setHasError(false);

    if (!photoUrl) {
      setPreviewSrc(null);
      setIsLoadingPhoto(false);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setIsLoadingPhoto(true);
    setPreviewSrc(null);

    api
      .fetchBlob(photoUrl, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewSrc(objectUrl);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error('Receipt photo preview error:', err);
        setHasError(true);
        onErrorNotify?.();
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingPhoto(false);
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [photoUrl, onErrorNotify]);

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
      const downloadEndpoint = appendDownloadQuery(photoUrl);
      const blob = await api.fetchBlob(downloadEndpoint);
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
      title={t('admin.receipts.photoModalTitle')}
      subtitle={
        receiptId ? (
          <bdi dir="ltr" className="tnum font-medium text-brand-fg">
            #{formatId(receiptId.slice(-8))}
          </bdi>
        ) : undefined
      }
      icon={
        <IconTile tone="brand" size="sm">
          <ImageIcon />
        </IconTile>
      }
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-ink-muted">
            {!hasError &&
              (isZoomed ? t('admin.receipts.zoomHintActive') : t('admin.receipts.zoomHint'))}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={handleModalClose}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0">
          {receiptId && (
            <button
              type="button"
              onClick={() => copy(receiptId, `receipt-photo-${receiptId}`)}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-ctl border text-xs tnum cursor-pointer bg-surface-2 border-line hover:border-line-strong text-ink-soft rs-focus"
              title={isCopied(`receipt-photo-${receiptId}`) ? t('common.copied') : t('common.copy')}
            >
              {isCopied(`receipt-photo-${receiptId}`) ? (
                <Check className="w-3.5 h-3.5 text-ok-fg shrink-0" />
              ) : (
                <Copy className="w-3.5 h-3.5 opacity-60 shrink-0" />
              )}
              <bdi dir="ltr" className="tnum font-medium">
                #{formatId(receiptId.slice(-8))}
              </bdi>
            </button>
          )}
          {mediaType === 'document' && (
            <span className="text-xs text-warn-fg font-medium shrink-0">
              {t('admin.receipts.documentFile')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!hasError && (
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-ctl border text-xs font-medium press rs-focus cursor-pointer ${
                isZoomed
                  ? 'bg-warn-soft border-warn/35 text-warn-fg'
                  : 'bg-surface-2 border-line hover:border-line-strong text-ink-soft'
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
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-ctl border text-xs font-semibold press rs-focus cursor-pointer disabled:opacity-50 bg-brand-soft border-brand/30 hover:bg-brand/15 text-brand-fg"
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
        className={`rounded-card overflow-auto border flex items-center justify-center p-2 relative select-none ${
          isZoomed ? 'min-h-[380px] max-h-[75vh]' : 'min-h-[260px] max-h-[60vh]'
        } bg-[#0e1218] border-line`}
        style={{
          touchAction: isZoomed ? 'pan-x pan-y' : 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {hasError ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-3">
            <ImageIcon className="w-10 h-10 text-ink-muted opacity-50" />
            <p className="text-xs text-ink-muted m-0">{t('admin.receipts.noPhoto')}</p>
            <Button
              size="sm"
              variant="primary"
              disabled={isDownloading}
              loading={isDownloading}
              onClick={handleDownload}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('admin.receipts.downloadReceipt')}</span>
            </Button>
          </div>
        ) : isLoadingPhoto || !previewSrc ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-2 text-brand-fg text-xs">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>{t('common.loading')}</span>
          </div>
        ) : (
          <div className={isZoomed ? 'w-[220%] max-w-none flex-shrink-0' : 'w-auto max-w-full'}>
            <img
              key={previewSrc}
              src={previewSrc}
              alt="Receipt proof"
              className={`rounded-tile mx-auto select-none ${
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
    </Modal>
  );
};
