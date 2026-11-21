import React from 'react';
import { ShieldCheck, Check, Copy, LogOut, Eye } from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { IconButton } from '@/shared/components/ui/IconButton.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { useToast } from '@/shared/components/ui/Toast.js';
import { TopBar } from '@/shared/components/layout/TopBar.js';
import { HeaderUtilityActions } from '@/shared/components/layout/HeaderUtilityActions.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';

interface AdminHeaderProps {
  user: TelegramWebAppUser;
  onRefresh: () => void;
  isRefreshing?: boolean;
  onClose: () => void;
  onSwitchToUserPortal?: () => void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  user,
  onRefresh,
  isRefreshing = false,
  onClose,
  onSwitchToUserPortal,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const { copy, isCopied } = useCopy();
  const { formatId } = useFormatters();
  const { notify } = useToast();

  const rawAdminName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  const adminDisplayName = rawAdminName || t('admin.defaultAdminName');

  const handleCopyId = async () => {
    triggerHaptic('light');
    const ok = await copy(String(user.id), 'header-id');
    if (ok) {
      notify(t('user.copiedId'), 'success');
    }
  };

  return (
    <TopBar
      icon={
        <IconTile tone="brand" size="md">
          <ShieldCheck />
        </IconTile>
      }
      title={t('admin.title')}
      subtitle={<span className="text-[11px] text-ink-muted">{t('admin.role')}</span>}
      actions={<HeaderUtilityActions onRefresh={onRefresh} isRefreshing={isRefreshing} />}
      footer={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Avatar
              name={adminDisplayName}
              username={user.username}
              photoUrl={user.photo_url}
              size="sm"
              circle
              className="shrink-0 ring-1 ring-line"
            />
            <div className="flex min-w-0 flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-2">
              <span className="max-w-full truncate text-xs font-semibold text-ink leading-tight">
                {adminDisplayName}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyId()}
                className="press rs-focus inline-flex h-6 sm:h-7 items-center gap-1 rounded-ctl border border-line bg-surface-2 px-1.5 sm:px-2 tnum text-[11px] font-medium text-ink-soft hover:border-line-strong hover:text-ink cursor-pointer shrink-0"
                title={t('common.copy')}
                aria-label={t('common.copy')}
              >
                <bdi dir="ltr" className="tnum">
                  #{formatId(user.id)}
                </bdi>
                {isCopied('header-id') ? (
                  <Check className="h-3 w-3 text-ok-fg shrink-0" />
                ) : (
                  <Copy className="h-3 w-3 opacity-60 shrink-0" />
                )}
              </button>
            </div>
          </div>

          <div className="ms-auto flex shrink-0 items-center gap-1.5">
            {onSwitchToUserPortal ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('medium');
                  onSwitchToUserPortal();
                }}
                title={t('admin.switchToUserPortal')}
                className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-brand/30 bg-brand-soft px-2 sm:px-2.5 text-xs font-medium text-brand-fg hover:bg-brand/15 rs-focus press cursor-pointer shrink-0 transition-colors"
              >
                <Eye className="h-3.5 w-3.5 shrink-0" />
                <span>{t('admin.switchToUserPortal')}</span>
              </button>
            ) : null}

            <IconButton size="xs" tone="danger" label={t('admin.exit')} onClick={onClose}>
              <LogOut className="h-3.5 w-3.5 rtl:-scale-x-100" />
            </IconButton>
          </div>
        </>
      }
    />
  );
};
