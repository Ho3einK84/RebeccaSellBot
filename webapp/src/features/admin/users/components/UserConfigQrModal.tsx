import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Copy, Check, X } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
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
  const { isDark, textPrimary, textMuted } = useThemeTokens();
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
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200/60 dark:border-white/[0.06]">
          <div className="flex items-center gap-2 text-start">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                isDark
                  ? 'bg-indigo-500/15 border-indigo-500/25 text-indigo-400'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-700'
              }`}
            >
              <QrCode className="w-4 h-4" />
            </div>
            <div>
              <h3 className={`font-bold text-sm m-0 ${textPrimary}`}>
                {t('admin.users.qrModalTitle')}
              </h3>
              <span className={`text-[11px] font-mono block truncate max-w-[200px] ${textMuted}`}>
                {config.configUsername}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* QR Code Container with crisp white background */}
        <div className="flex justify-center items-center py-2">
          <div className="p-3 bg-white rounded-2xl shadow-md border border-slate-200 inline-block">
            {qrUrl ? (
              <img
                src={qrUrl}
                alt={config.configUsername}
                className="w-56 h-56 block object-contain select-none"
              />
            ) : (
              <div className="w-56 h-56 flex items-center justify-center text-xs text-slate-400">
                {config.subUrl ? t('common.loading') : t('admin.users.noSubUrl')}
              </div>
            )}
          </div>
        </div>

        {/* Subscription URL Field & Copy Button */}
        {config.subUrl ? (
          <div className="space-y-2 text-start">
            <label className={`text-[11px] font-medium block ${textMuted}`}>
              {t('admin.users.subUrlLabel')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                dir="ltr"
                value={config.subUrl}
                className={`w-full h-9 px-3 text-xs font-mono rounded-xl border outline-none truncate select-all ${
                  isDark
                    ? 'bg-white/[0.04] border-white/10 text-zinc-300'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              />
              <button
                type="button"
                className={`h-9 px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-all active:scale-95 cursor-pointer ${
                  isCopied
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500'
                    : isDark
                      ? 'bg-white/[0.08] hover:bg-white/[0.12] border-white/15 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900 shadow-xs'
                }`}
                onClick={() => onCopy(config.subUrl!, `qr-${config.id}`)}
              >
                {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopied ? t('common.copied') : t('common.copy')}</span>
              </button>
            </div>
          </div>
        ) : (
          <p className={`text-xs ${textMuted}`}>{t('admin.users.noSubUrl')}</p>
        )}

        {/* Footer */}
        <div className="pt-2">
          <button
            type="button"
            className={`w-full h-9 rounded-xl text-xs font-medium border transition-all active:scale-[0.98] cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
            }`}
            onClick={onClose}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
