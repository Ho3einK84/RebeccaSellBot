import React from 'react';
import { Send } from 'lucide-react';
import { UserHeader } from './components/UserHeader.js';
import { UserHeroCard } from './components/UserHeroCard.js';
import { FeatureGrid } from './components/FeatureGrid.js';
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

  const handleClose = () => {
    triggerHaptic('medium');
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  };

  useTelegramBackButton(handleClose, true);

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
