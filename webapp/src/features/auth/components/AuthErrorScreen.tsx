import React, { useCallback, useEffect, useState } from 'react';
import { ShieldX, AlertTriangle, ExternalLink, X, Lock, Ticket } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import { api } from '@/shared/lib/api.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Button } from '@/shared/components/ui/Button.js';
import { AppVersionFooter } from '@/shared/components/ui/VersionBadge.js';
import { resolveClientAppVersion } from '@/shared/lib/appVersion.js';
import type { AppVersionInfo } from '@/shared/types/api.js';

interface AuthErrorScreenProps {
  error: string | null;
  errorCode?: string | null;
  errorTitle?: string | null;
}

export const AuthErrorScreen: React.FC<AuthErrorScreenProps> = ({
  error,
  errorCode,
  errorTitle,
}) => {
  const { t, isRtl } = useLanguage();
  const [resolvedBotUsername, setResolvedBotUsername] = useState<string>(() => {
    const envName = (import.meta.env.VITE_BOT_USERNAME as string | undefined) || '';
    return envName.replace(/^@/, '').trim();
  });
  const [serverVersion, setServerVersion] = useState<AppVersionInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getBotInfo()
      .then((res) => {
        if (cancelled) return;
        if (!resolvedBotUsername && res.username) {
          setResolvedBotUsername(res.username.replace(/^@/, '').trim());
        }
        if (res.appVersion) {
          setServerVersion(res.appVersion);
        }
      })
      .catch(() => {
        // Graceful fallback to build-time metadata & tg:// when backend info is unreachable
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

  const isRegistrationClosed = errorCode === 'REGISTRATION_CLOSED';
  const isRegistrationInviteOnly = errorCode === 'REGISTRATION_INVITE_ONLY';
  const isRegistrationBlocked = isRegistrationClosed || isRegistrationInviteOnly;

  const isTelegramOnly =
    !isRegistrationBlocked && (error === 'telegramOnly' || error?.includes('ربات'));
  const displayTitle = isRegistrationBlocked
    ? errorTitle ||
      (isRegistrationInviteOnly
        ? t('auth.registrationInviteOnlyTitle')
        : t('auth.registrationClosedTitle'))
    : t('auth.authErrorTitle');
  const displayError = isRegistrationBlocked
    ? error ||
      (isRegistrationInviteOnly
        ? t('auth.registrationInviteOnlyMessage')
        : t('auth.registrationClosedMessage'))
    : isTelegramOnly
      ? t('auth.telegramOnly')
      : error === 'authFailed'
        ? t('auth.authFailed')
        : error || t('auth.authFailed');

  const openInTelegramUrl = resolvedBotUsername ? `https://t.me/${resolvedBotUsername}` : 'tg://';

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center p-4 rs-canvas-bg bg-canvas text-ink safe-top safe-bottom"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <Card
        padding="lg"
        className="w-full max-w-sm flex flex-col items-center text-center gap-4 anim-rise"
      >
        <IconTile tone={isRegistrationBlocked || isTelegramOnly ? 'warn' : 'danger'} size="lg">
          {isRegistrationInviteOnly ? (
            <Ticket />
          ) : isRegistrationClosed ? (
            <Lock />
          ) : isTelegramOnly ? (
            <AlertTriangle />
          ) : (
            <ShieldX />
          )}
        </IconTile>

        <div className="space-y-1.5">
          <h2 className="text-base font-semibold text-ink leading-[1.4] m-0">{displayTitle}</h2>
          <p className="text-xs text-ink-soft leading-relaxed m-0 max-w-xs whitespace-pre-line">
            {displayError}
          </p>
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

      <AppVersionFooter
        version={resolveClientAppVersion(serverVersion)}
        className="mt-4 border-t-0 pt-0"
      />
    </div>
  );
};
