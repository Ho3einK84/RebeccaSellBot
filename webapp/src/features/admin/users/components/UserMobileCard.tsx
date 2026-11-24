import React from 'react';
import { Copy, Check, Wallet, Eye, Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import type { UserProfile } from '@/shared/types/admin.js';

interface UserMobileCardProps {
  user: UserProfile;
  onInspect: (telegramId: number) => void;
  onOpenBalanceModal: (user: UserProfile) => void;
  onCopyId: (id: string, key: string) => void;
  isCopied: boolean;
  inspecting?: boolean;
}

export const UserMobileCard: React.FC<UserMobileCardProps> = ({
  user,
  onInspect,
  onOpenBalanceModal,
  onCopyId,
  isCopied,
  inspecting = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber, formatId, sanitizeDisplayName } = useFormatters();

  const { displayName } = sanitizeDisplayName(user.firstName, user.lastName, t('user.guestUser'));

  return (
    <Card padding="md" className="space-y-3 hover:border-line-strong transition-colors text-start">
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Avatar name={user.firstName} username={user.username} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span className="font-semibold text-sm truncate text-ink">{displayName}</span>
              {user.group && (user.group.isAssigned || user.group.badge) && (
                <Badge variant="primary" size="xs" className="shrink-0">
                  {user.group.badge || user.group.name}
                </Badge>
              )}
              {user.isBanned && (
                <Badge variant="error" size="xs" className="shrink-0">
                  {t('admin.users.bannedBadge')}
                </Badge>
              )}
            </div>
            <div className="text-xs tnum mt-0.5">
              {user.username ? (
                <bdi dir="ltr" className="font-medium text-brand-fg">
                  @{user.username}
                </bdi>
              ) : (
                <span className="text-ink-muted">{t('admin.users.noUsername')}</span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-7 text-xs tnum px-2 rounded-ctl border press rs-focus shrink-0 cursor-pointer bg-surface-2 border-line hover:border-line-strong text-ink-soft"
          onClick={() => onCopyId(String(user.telegramId), `user-${user.telegramId}`)}
          title={t('common.copy')}
        >
          <bdi dir="ltr" className="tnum font-medium">
            #{formatId(user.telegramId)}
          </bdi>
          {isCopied ? (
            <Check className="w-3 h-3 text-ok-fg shrink-0" />
          ) : (
            <Copy className="w-3 h-3 text-ink-muted shrink-0" />
          )}
        </button>
      </div>

      <Card subCard padding="sm" className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <Wallet
            className={`w-4 h-4 shrink-0 ${user.balance < 0 ? 'text-danger-fg' : 'text-ok-fg'}`}
          />
          <bdi
            dir="ltr"
            className={`font-semibold text-sm tnum ${
              user.balance < 0 ? 'text-danger-fg' : 'text-ok-fg'
            }`}
          >
            {formatMoney(user.balance)}
          </bdi>
          <span className="text-xs text-ink-muted">{t('common.currency')}</span>
        </div>

        <div>
          {user.activeSubscriptionCount > 0 ? (
            <Badge variant="success" dot size="xs">
              {t('admin.users.activeSubsCount', {
                count: formatNumber(user.activeSubscriptionCount),
              })}
            </Badge>
          ) : (
            <Badge variant="neutral" size="xs">
              {t('common.zeroActive')}
            </Badge>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={inspecting}
          onClick={() => onInspect(user.telegramId)}
        >
          {inspecting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-fg" />
          ) : (
            <Eye className="w-3.5 h-3.5 text-ink-muted" />
          )}
          <span>{t('admin.users.btnDetails')}</span>
        </Button>

        <Button type="button" variant="primary" size="sm" onClick={() => onOpenBalanceModal(user)}>
          <Wallet className="w-3.5 h-3.5" />
          <span>{t('admin.users.btnChangeBalance')}</span>
        </Button>
      </div>
    </Card>
  );
};
