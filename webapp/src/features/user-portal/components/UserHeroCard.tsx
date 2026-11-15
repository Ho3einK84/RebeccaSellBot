import React from 'react';
import { Copy, Check, Star, User as UserIcon } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';

interface UserHeroCardProps {
  user: TelegramWebAppUser;
  onCopyId: () => void;
  isCopied: boolean;
}

export const UserHeroCard: React.FC<UserHeroCardProps> = ({ user, onCopyId, isCopied }) => {
  const { t, locale } = useLanguage();
  const { sanitizeDisplayName, toPersianDigits } = useFormatters();

  const { displayName } = sanitizeDisplayName(user.first_name, user.last_name, t('user.guestUser'));

  const formattedId = locale === 'fa' ? toPersianDigits(String(user.id)) : String(user.id);

  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={displayName} username={user.username} photoUrl={user.photo_url} size="lg" />

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-semibold text-ink leading-[1.4] truncate m-0">
                {displayName}
              </h2>
              {user.is_premium ? (
                <Badge variant="info" size="xs">
                  <Star className="w-3 h-3" />
                  <span>{t('user.premiumUserBadge')}</span>
                </Badge>
              ) : null}
            </div>

            {user.username ? (
              <div className="mt-0.5 text-xs text-ink-muted">
                <bdi dir="ltr" className="font-mono">
                  @{user.username}
                </bdi>
              </div>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={onCopyId}
          className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line-strong bg-surface-2 hover:bg-surface-3 px-2.5 text-xs text-ink-soft hover:text-ink rs-focus press cursor-pointer shrink-0"
          title={t('user.telegramId')}
        >
          <span className="text-[11px] text-ink-muted">{t('user.telegramId')}</span>
          <bdi dir="ltr" className="tnum font-mono font-medium text-ink">
            {formattedId}
          </bdi>
          {isCopied ? (
            <Check className="w-3.5 h-3.5 text-ok-fg shrink-0" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-ink-muted shrink-0" />
          )}
        </button>
      </div>

      <div className="pt-3.5 border-t border-line space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="neutral" size="xs">
            <UserIcon className="w-3 h-3" />
            <span>{t('user.userPortalBadge')}</span>
          </Badge>
          <Badge variant="warning" size="xs" dot>
            {t('user.inDevelopmentStatus')}
          </Badge>
        </div>

        <h3 className="text-sm sm:text-base font-semibold text-ink leading-[1.45] m-0 pt-1">
          {t('user.portalTitle')}
        </h3>
        <p className="text-xs sm:text-[13px] text-ink-soft leading-relaxed m-0">
          {t('user.portalDesc')}
        </p>
      </div>
    </Card>
  );
};
