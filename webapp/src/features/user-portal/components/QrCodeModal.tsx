import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Copy, Check, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
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
  const { isDark } = useThemeTokens();
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
      window.open(subUrl, '_blank');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('user.services.qrTitle')}
      icon={<QrCode className="w-5 h-5 text-indigo-400" />}
      maxWidth="sm"
    >
      <div className="flex flex-col items-center text-center gap-3.5 pt-1">
        <div className="flex flex-col items-center">
          <span
            className={`text-xs font-mono font-medium ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}
          >
            {configUsername}
          </span>
          <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1 max-w-[240px]">
            {t('user.services.qrHint')}
          </p>
        </div>

        {/* QR Code Container with nice rounded white frame */}
        <div className="bg-white p-3.5 rounded-2xl shadow-md border border-slate-200/80 flex items-center justify-center min-w-[220px] min-h-[220px]">
          {hasError ? (
            <div className="w-[200px] h-[200px] sm:w-[220px] sm:h-[220px] flex flex-col items-center justify-center gap-2 p-2">
              <AlertCircle className="w-7 h-7 text-rose-500" />
              <span className="text-xs text-rose-500 font-medium text-center">
                {t('user.services.qrError')}
              </span>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  setRetryKey((k) => k + 1);
                }}
                className="mt-1 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t('user.services.qrRetry')}</span>
              </button>
            </div>
          ) : qrSrc ? (
            <img
              src={qrSrc}
              alt={t('user.services.qrTitle')}
              className="w-[200px] h-[200px] sm:w-[220px] sm:h-[220px] select-none pointer-events-none"
            />
          ) : (
            <div className="w-[200px] h-[200px] sm:w-[220px] sm:h-[220px] flex items-center justify-center text-slate-400 text-xs">
              {t('common.loading')}
            </div>
          )}
        </div>

        {/* Action Button: Copy Subscription Link */}
        <div className="w-full flex flex-col gap-2 mt-2">
          <button
            type="button"
            onClick={handleCopy}
            className={`w-full py-2.5 px-4 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer ${
              isCopied('qr-sub-url')
                ? 'bg-emerald-600 text-white'
                : isDark
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
            }`}
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
          </button>

          {/* Quick open or close */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleOpenLink}
              className={`flex-1 py-2 px-3 rounded-xl border text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{t('user.services.openLink')}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className={`flex-1 py-2 px-3 rounded-xl border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 text-zinc-400 hover:text-white'
                  : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
