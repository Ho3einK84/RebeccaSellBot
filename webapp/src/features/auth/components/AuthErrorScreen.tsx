import React, { useCallback, useEffect, useState } from 'react';
import { ShieldX, AlertTriangle, ExternalLink, X } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import { api } from '@/shared/lib/api.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Button } from '@/shared/components/ui/Button.js';

interface AuthErrorScreenProps {
  error: string | null;
}

export const AuthErrorScreen: React.FC<AuthErrorScreenProps> = ({ error }) => {
  const { t, isRtl } = useLanguage();
  const [resolvedBotUsername, setResolvedBotUsername] = useState<string>(() => {
    const envName = (import.meta.env.VITE_BOT_USERNAME as string | undefined) || '';
    return envName.replace(/^@/, '').trim();
  });

  useEffect(() => {
    if (resolvedBotUsername) return;
    let cancelled = false;
    api
      .getBotInfo()
      .then((res) => {
        if (!cancelled && res.username) {
          setResolvedBotUsername(res.username.replace(/^@/, '').trim());
        }
      })
      .catch(() => {
        // Graceful fallback to tg:// when backend info is unreachable
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedBotUsername]);

  const handleClose = useCallback(() => {
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  }, []);

  useTelegramBackButton(handleClose, true);

  const isTelegramOnly = error === 'telegramOnly' || error?.includes('ربات');
  const displayError = isTelegramOnly
    ? t('auth.telegramOnly')
    : error === 'authFailed'
      ? t('auth.authFailed')
      : error || t('auth.authFailed');

  const openInTelegramUrl = resolvedBotUsername ? `https://t.me/${resolvedBotUsername}` : 'tg://';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 rs-canvas-bg bg-canvas text-ink safe-top safe-bottom"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <Card
        padding="lg"
        className="w-full max-w-sm flex flex-col items-center text-center gap-4 anim-rise"
      >
        <IconTile tone={isTelegramOnly ? 'warn' : 'danger'} size="lg">
          {isTelegramOnly ? <AlertTriangle /> : <ShieldX />}
        </IconTile>

        <div className="space-y-1.5">
          <h2 className="text-base font-semibold text-ink leading-[1.4] m-0">
            {t('auth.authErrorTitle')}
          </h2>
          <p className="text-xs text-ink-soft leading-relaxed m-0 max-w-xs">{displayError}</p>
        </div>

        <div className="w-full flex flex-col gap-2 pt-3 border-t border-line">
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
