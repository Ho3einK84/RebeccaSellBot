import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Copy, Check, X } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type { UserConfigItem } from '@/shared/types/admin.js';

interface UserConfigQrModalProps {
  config: UserConfigItem | null;
  onClose: () => void;
  onCopy: (text: string, key: string) => void;
  isCopied: boolean;
}

export const UserConfigQrModal: React.FC<UserConfigQrModalProps> = ({
  config,
  onClose,
  onCopy,
  isCopied,
}) => {
  const { t } = useLanguage();
  const { textPrimary, textMuted } = useThemeTokens();
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!config?.subUrl) {
      setQrUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(config.subUrl, {
      width: 320,
      margin: 1.5,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [config?.subUrl]);

  if (!config) return null;

  return (
    <Modal isOpen={Boolean(config)} onClose={onClose} maxWidth="sm">
      <div className="space-y-4 text-center">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div className="flex items-center gap-2.5 text-start min-w-0">
            <IconTile tone="brand" size="sm">
              <QrCode />
            </IconTile>
            <div className="min-w-0">
              <h3 className={`font-semibold text-sm m-0 ${textPrimary}`}>
                {t('admin.users.qrModalTitle')}
              </h3>
              <bdi
                dir="ltr"
                className={`text-xs font-mono block truncate max-w-[200px] text-start ${textMuted}`}
              >
                {config.configUsername}
              </bdi>
            </div>
          </div>
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-ctl text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer shrink-0 rs-focus"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* High-contrast white matte QR quiet-zone surface across both light & dark themes */}
        <div className="flex justify-center items-center py-2">
          <div className="p-3 bg-white rounded-card border border-line inline-block">
            {qrUrl ? (
              <img
                src={qrUrl}
                alt={config.configUsername}
                className="w-56 h-56 block object-contain select-none"
              />
            ) : (
              <div className="w-56 h-56 flex items-center justify-center text-xs text-slate-600">
                {config.subUrl ? t('common.loading') : t('admin.users.noSubUrl')}
              </div>
            )}
          </div>
        </div>

        {config.subUrl ? (
          <div className="space-y-2 text-start">
            <label className={`text-xs font-medium block ${textMuted}`}>
              {t('admin.users.subUrlLabel')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                dir="ltr"
                value={config.subUrl}
                className="w-full h-9 px-3 text-xs font-mono rounded-ctl border outline-none truncate select-all bg-surface-2 border-line text-ink-soft"
              />
              <Button
                type="button"
                size="sm"
                variant={isCopied ? 'success' : 'secondary'}
                onClick={() => onCopy(config.subUrl!, `qr-${config.id}`)}
              >
                {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopied ? t('common.copied') : t('common.copy')}</span>
              </Button>
            </div>
          </div>
        ) : (
          <p className={`text-xs ${textMuted}`}>{t('admin.users.noSubUrl')}</p>
        )}

        <div className="pt-2">
          <Button type="button" variant="secondary" size="sm" block onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
