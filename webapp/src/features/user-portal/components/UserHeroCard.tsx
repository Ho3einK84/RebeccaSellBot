import React from 'react';
import { User, Star, Copy, Check, Sparkles } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';

interface UserHeroCardProps {
  user: TelegramWebAppUser;
  onCopyId: () => void;
  isCopied: boolean;
}

export const UserHeroCard: React.FC<UserHeroCardProps> = ({ user, onCopyId, isCopied }) => {
  const { t } = useLanguage();
  const { sanitizeDisplayName } = useFormatters();
  const { cardClass } = useThemeTokens();

  const { displayName, initials } = sanitizeDisplayName(
    user.first_name,
    user.last_name,
    t('user.guestUser')
  );

  return (
    <>
      {/* User Identity Section */}
      <section className="flex flex-col items-center pt-2 sm:pt-4 pb-5 text-center">
        {/* Avatar */}
        <div className="relative mb-3.5 cs-avatar-entrance">
          <div
            className={`absolute inset-0 rounded-full blur-xl cs-breathe bg-gradient-to-tr from-zinc-700/40 via-zinc-500/30 to-zinc-800/40`}
          />
          <div
            className={`relative w-[72px] h-[72px] sm:w-[78px] sm:h-[78px] rounded-full p-[2px] transition-colors bg-gradient-to-tr from-zinc-600 via-zinc-400 to-zinc-700 shadow-xl shadow-black/60 shadow-lg shadow-slate-200`}
          >
            <div
              className={`w-full h-full rounded-full overflow-hidden flex items-center justify-center border transition-colors bg-canvas border-line/10`}
            >
              {user.photo_url ? (
                <img
                  src={user.photo_url}
                  alt={displayName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : initials ? (
                <span className={`text-lg sm:text-xl font-bold tnum tracking-wider text-ink`}>
                  {initials}
                </span>
              ) : (
                <User className={`w-7 h-7 text-ink-muted`} />
              )}
            </div>
          </div>

          {user.is_premium && (
            <div
              className="absolute -bottom-0.5 -end-0.5 w-5 h-5 rounded-full bg-gradient-to-tr from-warn to-warn border-2 border-[#090a0f] flex items-center justify-center shadow-md shadow-warn/30"
              title={t('user.premiumUserBadge')}
            >
              <Star className="w-3 h-3 text-slate-950 fill-slate-950" />
            </div>
          )}
        </div>

        {/* User greeting */}
        <h1
          className={`text-xl sm:text-2xl font-bold mb-2 tracking-tight flex items-center justify-center gap-1.5 flex-wrap cs-fade-in text-ink`}
        >
          <span>{t('user.greetingPrefix')}</span>
          <bdi
            className={
              'bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent font-extrabold'
            }
          >
            {displayName}
          </bdi>
          <span className="animate-wave select-none text-lg">👋</span>
        </h1>

        {/* User chips: ID, username, premium */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 cs-fade-in-delay-1">
          <button
            type="button"
            onClick={onCopyId}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs transition-all active:scale-[0.97] cursor-pointer select-none group border bg-surface/[0.04] hover:bg-surface/[0.08] border-line/10 text-ink-muted shadow-xs`}
            title={t('common.copy')}
          >
            <span className={`text-[11px] text-ink-muted`}>{t('user.telegramId')}</span>
            <code dir="ltr" className={`tnum font-semibold text-xs text-ink-soft`}>
              {user.id}
            </code>
            {isCopied ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ok">
                <Check className="w-3 h-3 text-ok" />
                <span>{t('user.copiedId')}</span>
              </span>
            ) : (
              <Copy className={`w-3 h-3 transition-colors text-ink-muted group-hover:text-ink`} />
            )}
          </button>

          {user.username && (
            <div
              dir="ltr"
              className={`inline-flex items-center gap-0.5 border px-2.5 py-1 rounded-full text-[11px] tnum select-none bg-surface/[0.04] border-line/10 text-ink-soft shadow-xs`}
            >
              <span className={'text-ink-muted'}>@</span>
              <span>{user.username}</span>
            </div>
          )}

          {user.is_premium && (
            <Badge variant="warning" size="xs">
              <Star className="w-2.5 h-2.5 fill-warn text-warn" />
              <span>{t('user.premiumUserBadge')}</span>
            </Badge>
          )}
        </div>
      </section>

      {/* Hero Card: Coming Soon announcement */}
      <section
        className={`w-full rounded-2xl p-4 sm:p-5 mb-4 relative overflow-hidden border backdrop-blur-md cs-fade-in-delay-2 text-start transition-colors ${cardClass}`}
      >
        <div
          className={`absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-zinc-400/30 to-transparent`}
        />

        <div className="flex items-center gap-2 mb-2.5">
          <Badge variant="neutral" size="xs">
            <Sparkles className={`w-3 h-3 text-ink-soft`} />
            <span>{t('user.userPortalBadge')}</span>
          </Badge>
          <Badge variant="warning" dot pulse size="xs">
            <span>{t('user.inDevelopmentStatus')}</span>
          </Badge>
        </div>

        <h2 className={`text-base sm:text-[17px] font-bold mb-1.5 leading-snug text-ink`}>
          {t('user.portalTitle')}
        </h2>

        <p className={`text-xs sm:text-[13px] leading-relaxed m-0 text-ink-muted`}>
          {t('user.portalDesc')}
        </p>
      </section>
    </>
  );
};
