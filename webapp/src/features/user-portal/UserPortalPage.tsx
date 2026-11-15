import React, { useState, useEffect, useCallback } from 'react';
import { Send, ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import { AppShell } from '@/shared/components/layout/AppShell.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import { ToastContainer, useToastQueue } from '@/shared/components/ui/Toast.js';
import { UserHeader } from './components/UserHeader.js';
import { UserHeroCard } from './components/UserHeroCard.js';
import { FeatureGrid } from './components/FeatureGrid.js';
import { UserBetaPortal } from './UserBetaPortal.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';

interface UserPortalPageProps {
  user: TelegramWebAppUser;
}

const OPT_IN_STORAGE_KEY = 'rsbot_user_beta_opt_in';

const getInitialBetaMode = (): boolean => {
  try {
    return localStorage.getItem(OPT_IN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const UserPortalPage: React.FC<UserPortalPageProps> = ({ user }) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const { copy, isCopied } = useCopy();
  const { toasts, showToast, dismissToast } = useToastQueue();

  const [isBetaMode, setIsBetaMode] = useState<boolean>(getInitialBetaMode);

  useEffect(() => {
    try {
      localStorage.setItem(OPT_IN_STORAGE_KEY, isBetaMode ? 'true' : 'false');
    } catch {
      // Ignore storage failures
    }
  }, [isBetaMode]);

  const handleCopyId = () => {
    triggerHaptic('selection');
    copy(String(user.id), 'tgId');
    showToast(t('user.copiedId'), 'success');
  };

  const handleClose = useCallback(() => {
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  }, []);

  useTelegramBackButton(handleClose, !isBetaMode);

  if (isBetaMode) {
    return (
      <UserBetaPortal
        user={user}
        onExitBeta={() => {
          triggerHaptic('selection');
          setIsBetaMode(false);
        }}
      />
    );
  }

  return (
    <AppShell
      width="narrow"
      header={<UserHeader />}
      overlay={<ToastContainer toasts={toasts} onDismiss={dismissToast} />}
    >
      <div className="space-y-4">
        <UserHeroCard user={user} onCopyId={handleCopyId} isCopied={isCopied('tgId')} />

        <FeatureGrid />

        <Card padding="md" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="primary" size="xs">
              {t('user.betaBadge')}
            </Badge>
            <Badge variant="success" size="xs" dot>
              {t('user.betaPreviewActive')}
            </Badge>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-ink leading-[1.4] m-0">
              {t('user.enterBetaMode')}
            </h3>
            <p className="text-xs text-ink-muted leading-relaxed m-0">
              {t('user.enterBetaModeDesc')}
            </p>
          </div>

          <Button
            type="button"
            variant="primary"
            block
            onClick={() => {
              triggerHaptic('medium');
              setIsBetaMode(true);
            }}
          >
            <span>{t('user.enterBetaMode')}</span>
            <ArrowLeft className="w-4 h-4 ltr:rotate-180 shrink-0" />
          </Button>
        </Card>

        <div className="flex flex-col items-center gap-2 pt-2">
          <Button type="button" variant="secondary" block onClick={handleClose}>
            <Send className="w-4 h-4 shrink-0" />
            <span>{t('user.backToBot')}</span>
          </Button>
          <p className="text-[11px] text-ink-muted text-center m-0">{t('user.closeMiniAppHint')}</p>
        </div>
      </div>
    </AppShell>
  );
};
