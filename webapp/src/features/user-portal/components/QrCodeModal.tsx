import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Copy, Check, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

interface QrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  subUrl: string;
  configUsername: string;
}

export const QrCodeModal: React.FC<QrCodeModalProps> = ({
  isOpen,
  onClose,
  subUrl,
  configUsername,
}) => {
  const { t } = useLanguage();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();
  const [qrSrc, setQrSrc] = useState<string>('');
  const [hasError, setHasError] = useState<boolean>(false);
  const [retryKey, setRetryKey] = useState<number>(0);

  useEffect(() => {
    setQrSrc('');
    setHasError(false);

    if (!subUrl || !isOpen) return;

    let isCancelled = false;

    QRCode.toDataURL(subUrl, {
      width: 280,
      margin: 1.5,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!isCancelled) {
          setQrSrc(url);
          setHasError(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setQrSrc('');
          setHasError(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [subUrl, isOpen, retryKey]);

  const handleCopy = () => {
    triggerHaptic('light');
    copy(subUrl, 'qr-sub-url');
  };

  const handleOpenLink = () => {
    triggerHaptic('light');
    if (!subUrl) return;
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(subUrl);
    } else {
      window.open(subUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('user.services.qrTitle')}
      subtitle={<bdi dir="ltr">{configUsername}</bdi>}
      icon={
        <IconTile tone="brand" size="sm">
          <QrCode />
        </IconTile>
      }
      maxWidth="sm"
    >
      <div className="flex flex-col items-center text-center gap-3.5 pt-1">
        <p className="text-xs text-ink-muted m-0 max-w-[260px] leading-relaxed">
          {t('user.services.qrHint')}
        </p>

        {/* High-contrast light QR canvas for optical scan reliability in both themes */}
        <div className="bg-white p-3.5 rounded-card border border-line flex items-center justify-center min-w-[220px] min-h-[220px]">
          {hasError ? (
            <div className="w-[200px] h-[200px] sm:w-[220px] sm:h-[220px] flex flex-col items-center justify-center gap-2 p-2">
              <AlertCircle className="w-7 h-7 text-danger" />
              <span className="text-xs text-danger font-medium text-center">
                {t('user.services.qrError')}
              </span>
              <Button
                type="button"
                variant="danger"
                size="xs"
                onClick={() => {
                  triggerHaptic('light');
                  setRetryKey((k) => k + 1);
                }}
                className="mt-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t('user.services.qrRetry')}</span>
              </Button>
            </div>
          ) : qrSrc ? (
            <img
              src={qrSrc}
              alt={t('user.services.qrTitle')}
              className="w-[200px] h-[200px] sm:w-[220px] sm:h-[220px] select-none pointer-events-none"
            />
          ) : (
            <div className="w-[200px] h-[200px] sm:w-[220px] sm:h-[220px] flex items-center justify-center text-ink-muted text-xs">
              {t('common.loading')}
            </div>
          )}
        </div>

        {/* Action Button: Copy Subscription Link */}
        <div className="w-full flex flex-col gap-2 mt-2">
          <Button
            type="button"
            variant={isCopied('qr-sub-url') ? 'success' : 'primary'}
            size="md"
            onClick={handleCopy}
            className="w-full"
          >
            {isCopied('qr-sub-url') ? (
              <>
                <Check className="w-4 h-4" />
                <span>{t('user.services.linkCopied')}</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>{t('user.services.copyLink')}</span>
              </>
            )}
          </Button>

          {/* Quick open or close */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleOpenLink}
              className="flex-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{t('user.services.openLink')}</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              className="flex-1"
            >
              <span>{t('common.close')}</span>
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
