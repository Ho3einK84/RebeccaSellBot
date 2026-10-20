import React, { useState } from 'react';
import { Send, FlaskConical, ArrowRight, Sparkles } from 'lucide-react';
import { UserHeader } from './components/UserHeader.js';
import { UserHeroCard } from './components/UserHeroCard.js';
import { FeatureGrid } from './components/FeatureGrid.js';
import { UserBetaPortal } from './UserBetaPortal.js';
import { AmbientBackground } from '@/shared/components/layout/AmbientBackground.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
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

  const [isBetaMode, setIsBetaMode] = useState<boolean>(getInitialBetaMode);

  const handleEnterBeta = () => {
    triggerHaptic('medium');
    try {
      localStorage.setItem(OPT_IN_STORAGE_KEY, 'true');
    } catch {
      // Safe fallback for restricted storage environments
    }
    setIsBetaMode(true);
  };

  const handleExitBeta = () => {
    try {
      localStorage.removeItem(OPT_IN_STORAGE_KEY);
    } catch {
      // Safe fallback for restricted storage environments
    }
    setIsBetaMode(false);
  };

  const handleClose = () => {
    triggerHaptic('medium');
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  };

  useTelegramBackButton(handleClose, !isBetaMode);

  if (isBetaMode) {
    return <UserBetaPortal user={user} onExitBeta={handleExitBeta} />;
  }

  return (
    <div
      className={`cs-page w-full min-h-screen min-h-[100dvh] flex flex-col items-center justify-start safe-top transition-colors duration-200 bg-canvas text-ink`}
    >
      <AmbientBackground />

      <UserHeader />

      <main className="w-full max-w-md mx-auto flex flex-col items-center px-4 pt-3 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))] relative z-10 flex-1">
        <UserHeroCard
          user={user}
          onCopyId={() => copy(String(user.id), 'user-portal-id')}
          isCopied={isCopied('user-portal-id')}
        />

        {/* Section: Enter Experimental Mode */}
        <section
          className={`w-full rounded-2xl p-4 sm:p-4.5 mb-4 relative overflow-hidden border backdrop-blur-md cs-fade-in-delay-2 text-start transition-all bg-gradient-to-br from-brand-soft via-surface to-brand-soft/50 dark:from-brand/30 dark:via-surface dark:to-brand/20 border-brand/25 shadow-lg shadow-brand/15 shadow-sm`}
        >
          <div className="flex items-center justify-between mb-2">
            <Badge variant="primary" size="xs">
              <FlaskConical className="w-3 h-3" />
              <span>{t('user.betaBadge')}</span>
            </Badge>

            <div className="inline-flex items-center gap-1 text-[10px] text-brand font-medium">
              <Sparkles className="w-3 h-3" />
              <span>{t('user.betaPreviewActive')}</span>
            </div>
          </div>

          <h3 className={`text-sm sm:text-base font-bold mb-1.5 text-ink`}>
            {t('user.enterBetaMode')}
          </h3>

          <p className="text-xs text-ink-soft leading-relaxed mb-3.5 m-0">
            {t('user.enterBetaModeDesc')}
          </p>

          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={handleEnterBeta}
            className="w-full min-h-[44px] h-11 text-xs sm:text-sm font-bold shadow-md bg-gradient-to-r from-brand via-brand to-brand hover:from-brand hover:to-brand border-0"
          >
            <FlaskConical className="w-4 h-4" />
            <span>{t('user.enterBetaMode')}</span>
            <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
          </Button>
        </section>

        <FeatureGrid />

        {/* Bottom CTA Action Button */}
        <footer className="w-full flex flex-col items-center gap-2 mt-auto cs-fade-in-delay-3">
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="w-full h-12 text-sm font-bold shadow-md"
            onClick={handleClose}
          >
            <Send className="w-4 h-4 rtl:rotate-180" />
            <span>{t('user.backToBot')}</span>
          </Button>
          <span className={`text-[11px] select-none text-ink-muted`}>
            {t('user.closeMiniAppHint')}
          </span>
        </footer>
      </main>
    </div>
  );
};
