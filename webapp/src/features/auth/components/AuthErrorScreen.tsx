import React, { useEffect } from 'react';
import { ShieldX, AlertTriangle, ExternalLink, X } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Button } from '@/shared/components/ui/Button.js';

interface AuthErrorScreenProps {
  error: string | null;
}

export const AuthErrorScreen: React.FC<AuthErrorScreenProps> = ({ error }) => {
  const { t, isRtl } = useLanguage();

  const handleClose = () => {
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  };

  const isTelegramOnly = error === 'telegramOnly' || error?.includes('ربات');
  const displayError = isTelegramOnly
    ? t('auth.telegramOnly')
    : error === 'authFailed'
      ? t('auth.authFailed')
      : error || t('auth.authFailed');

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.BackButton) return;
    tg.BackButton.show();
    tg.BackButton.onClick(handleClose);
    return () => {
      tg.BackButton?.offClick(handleClose);
      tg.BackButton?.hide();
    };
  }, []);

  const botUsername = import.meta.env.VITE_BOT_USERNAME as string | undefined;
  const openInTelegramUrl = botUsername ? `https://t.me/${botUsername}` : 'tg://';

  return (
    <div
      className="fixed inset-0 w-screen flex items-center justify-center p-4 bg-canvas text-ink"
      style={{ height: '100dvh' }}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <Card
        padding="lg"
        className="w-full max-w-sm flex flex-col items-center text-center gap-4 anim-rise"
      >
        <IconTile tone={isTelegramOnly ? 'warn' : 'danger'} size="lg">
          {isTelegramOnly ? <AlertTriangle className="w-5 h-5" /> : <ShieldX className="w-5 h-5" />}
        </IconTile>

        <div className="space-y-1.5">
          <h2 className="text-base font-semibold text-ink leading-[1.4] m-0">
            {t('auth.authErrorTitle')}
          </h2>
          <p className="text-xs text-ink-soft leading-relaxed m-0 max-w-xs">{displayError}</p>
        </div>

        <div className="w-full flex flex-col gap-2 pt-2 border-t border-line">
          <a
            href={openInTelegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-ctl bg-brand hover:bg-brand-hover text-brand-ink text-[13px] font-medium rs-focus press no-underline"
          >
            <ExternalLink className="w-4 h-4 shrink-0" />
            <span>{t('auth.openInTelegram')}</span>
          </a>

          <Button type="button" variant="secondary" block onClick={handleClose}>
            <X className="w-4 h-4 shrink-0" />
            <span>{t('auth.closeWindow')}</span>
          </Button>
        </div>
      </Card>
    </div>
  );
};
