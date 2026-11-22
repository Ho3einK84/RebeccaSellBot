import React from 'react';
import { Shield, Copy, Check, Wallet } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { TopBar } from '@/shared/components/layout/TopBar.js';
import { HeaderUtilityActions } from '@/shared/components/layout/HeaderUtilityActions.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { useToast } from '@/shared/components/ui/Toast.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';

interface UserPortalHeaderProps {
  user: TelegramWebAppUser;
  onRefresh: () => void;
  isAdminView?: boolean;
  onSwitchToAdmin?: () => void;
  balance?: number;
  currency?: string;
  onOpenWallet?: () => void;
  isRefreshing?: boolean;
}

export const UserPortalHeader: React.FC<UserPortalHeaderProps> = ({
  user,
  onRefresh,
  isAdminView = false,
  onSwitchToAdmin,
  balance,
  currency,
  onOpenWallet,
  isRefreshing = false,
}) => {
  const { t } = useLanguage();
  const { sanitizeDisplayName, formatId, formatToman } = useFormatters();
  const { triggerHaptic } = useHaptic();
  const { copy, isCopied } = useCopy();
  const { notify } = useToast();

  const { displayName } = sanitizeDisplayName(user.first_name, user.last_name, t('user.guestUser'));
  const displayCurrency = currency || t('common.currency');

  const handleCopyId = async () => {
    const ok = await copy(String(user.id), 'portal-header-id');
    if (ok) {
      notify(t('user.copiedId'), 'success');
    }
  };

  const showFooter = balance !== undefined || Boolean(isAdminView && onSwitchToAdmin);

  return (
    <TopBar
      icon={
        <Avatar
          name={displayName}
          username={user.username}
          photoUrl={user.photo_url}
          size="md"
          circle
          className="shrink-0 ring-1 ring-line-strong"
        />
      }
      title={displayName}
      badge={
        isAdminView ? (
          <Badge variant="primary" size="xs" className="hidden sm:inline-flex shrink-0">
            <Shield className="w-3 h-3" />
            <span>{t('user.adminViewBadge')}</span>
          </Badge>
        ) : null
      }
      subtitle={
        <div className="flex items-center gap-1.5 flex-wrap">
          {user.username ? (
            <bdi dir="ltr" className="tnum text-[11px] font-medium text-brand-fg">
              @{user.username}
            </bdi>
          ) : (
            <span className="text-[11px] text-ink-muted">{t('user.userPortalBadge')}</span>
          )}
          <span className="text-ink-muted/40" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            onClick={() => void handleCopyId()}
            className="press rs-focus inline-flex h-5 items-center gap-1 rounded-full bg-surface-2 hover:bg-surface-3 px-2 tnum text-[10.5px] font-medium text-ink-soft hover:text-ink cursor-pointer shrink-0 border border-line"
            title={t('common.copy')}
            aria-label={t('common.copy')}
          >
            <bdi dir="ltr" className="tnum text-ink-soft">
              #{formatId(user.id)}
            </bdi>
            {isCopied('portal-header-id') ? (
              <Check className="h-2.5 w-2.5 text-ok-fg shrink-0" />
            ) : (
              <Copy className="h-2.5 w-2.5 opacity-60 shrink-0" />
            )}
          </button>
        </div>
      }
      actions={<HeaderUtilityActions onRefresh={onRefresh} isRefreshing={isRefreshing} />}
      footer={
        showFooter ? (
          <>
            {balance !== undefined ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  onOpenWallet?.();
                }}
                className="press rs-focus inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 text-[11px] font-medium text-ink hover:border-line-strong hover:bg-surface-3 cursor-pointer shrink-0"
                title={t('user.dashboard.walletBalance')}
              >
                <Wallet className="h-3 w-3 text-ok-fg shrink-0" />
                <bdi dir="ltr" className="tnum font-semibold text-ok-fg">
                  {formatToman(balance)}
                </bdi>
                <span className="text-ink-muted">{displayCurrency}</span>
              </button>
            ) : (
              <span />
            )}

            {isAdminView && onSwitchToAdmin ? (
              <div className="ms-auto flex items-center shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('selection');
                    onSwitchToAdmin();
                  }}
                  title={t('user.backToAdmin')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-brand/25 bg-brand-soft px-3 text-xs font-medium text-brand-fg hover:bg-brand/20 rs-focus press cursor-pointer shrink-0"
                >
                  <Shield className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('user.backToAdmin')}</span>
                </button>
              </div>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
};
