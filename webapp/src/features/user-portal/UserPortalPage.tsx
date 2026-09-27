import React, { useState } from 'react';
import { Send, FlaskConical, ArrowRight, Sparkles } from 'lucide-react';
import { UserHeader } from './components/UserHeader.js';
import { UserHeroCard } from './components/UserHeroCard.js';
import { FeatureGrid } from './components/FeatureGrid.js';
import { UserBetaPortal } from './UserBetaPortal.js';
import { AmbientBackground } from '@/shared/components/layout/AmbientBackground.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';

interface UserPortalPageProps {
  user: TelegramWebAppUser;
}

export const UserPortalPage: React.FC<UserPortalPageProps> = ({ user }) => {
  const { t } = useLanguage();
  const { isDark } = useThemeTokens();
  const { triggerHaptic } = useHaptic();
  const { copy, isCopied } = useCopy();

  const [isBetaMode, setIsBetaMode] = useState<boolean>(false);

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
    return <UserBetaPortal user={user} onExitBeta={() => setIsBetaMode(false)} />;
  }

  return (
    <div
      className={`cs-page w-full min-h-screen min-h-[100dvh] flex flex-col items-center justify-start safe-top transition-colors duration-200 ${
        isDark ? 'bg-[#090a0f] text-slate-100' : 'bg-[#f8fafc] text-slate-900'
      }`}
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
          className={`w-full rounded-2xl p-4 sm:p-4.5 mb-4 relative overflow-hidden border backdrop-blur-md cs-fade-in-delay-2 text-start transition-all ${
            isDark
              ? 'bg-gradient-to-br from-indigo-950/30 via-zinc-900/50 to-purple-950/30 border-indigo-500/30 shadow-lg shadow-indigo-950/20'
              : 'bg-gradient-to-br from-indigo-50/90 via-white to-purple-50/80 border-indigo-200 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-500 dark:text-indigo-300 border border-indigo-500/25">
              <FlaskConical className="w-3 h-3" />
              <span>{t('user.betaBadge')}</span>
            </div>

            <div className="inline-flex items-center gap-1 text-[10px] text-indigo-500 dark:text-indigo-400 font-medium">
              <Sparkles className="w-3 h-3" />
              <span>{t('user.betaPreviewActive')}</span>
            </div>
          </div>

          <h3
            className={`text-sm sm:text-base font-bold mb-1.5 ${
              isDark ? 'text-white' : 'text-slate-900'
            }`}
          >
            {t('user.enterBetaMode')}
          </h3>

          <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed mb-3.5 m-0">
            {t('user.enterBetaModeDesc')}
          </p>

          <button
            type="button"
            onClick={() => {
              triggerHaptic('medium');
              setIsBetaMode(true);
            }}
            className="w-full h-11 text-xs sm:text-sm font-bold active:scale-[0.98] rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white"
          >
            <FlaskConical className="w-4 h-4" />
            <span>{t('user.enterBetaMode')}</span>
            <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
          </button>
        </section>

        <FeatureGrid />

        {/* Bottom CTA Action Button */}
        <footer className="w-full flex flex-col items-center gap-2 mt-auto cs-fade-in-delay-3">
          <button
            type="button"
            className={`w-full h-12 text-sm font-bold active:scale-[0.98] rounded-xl border-0 flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md ${
              isDark
                ? 'bg-white text-black hover:bg-zinc-200'
                : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
            onClick={handleClose}
          >
            <Send className="w-4 h-4 rtl:rotate-180" />
            <span>{t('user.backToBot')}</span>
          </button>
          <span
            className={`text-[11px] select-none ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}
          >
            {t('user.closeMiniAppHint')}
          </span>
        </footer>
      </main>
    </div>
  );
};
