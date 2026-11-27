import React from 'react';
import { ShieldCheck, Eye, Settings2 } from 'lucide-react';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { VersionBadge } from '@/shared/components/ui/VersionBadge.js';
import { TopBar } from '@/shared/components/layout/TopBar.js';
import { HeaderUtilityActions } from '@/shared/components/layout/HeaderUtilityActions.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';
import type { AppVersionInfo } from '@/shared/types/api.js';

interface AdminHeaderProps {
  user: TelegramWebAppUser;
  appVersion?: AppVersionInfo;
  onRefresh: () => void;
  isRefreshing?: boolean;
  onClose?: () => void;
  onSwitchToUserPortal?: () => void;
  onOpenMore?: () => void;
  isMoreActive?: boolean;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  user,
  appVersion,
  onRefresh,
  isRefreshing = false,
  onSwitchToUserPortal,
  onOpenMore,
  isMoreActive = false,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const { sanitizeDisplayName } = useFormatters();

  const fallbackName = user.username ? `@${user.username}` : t('admin.defaultAdminName');
  const { displayName: adminDisplayName } = sanitizeDisplayName(
    user.first_name,
    user.last_name,
    fallbackName
  );

  const hasMobileQuickBar = Boolean(onOpenMore || onSwitchToUserPortal);

  return (
    <TopBar
      icon={
        <IconTile tone="brand" size="sm" className="sm:w-10 sm:h-10">
          <ShieldCheck />
        </IconTile>
      }
      title={t('admin.title')}
      badge={<VersionBadge version={appVersion} size="xs" className="hidden md:inline-flex" />}
      subtitle={
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted truncate max-w-full">
          <span className="truncate font-medium text-ink-soft">{adminDisplayName}</span>
          <span className="opacity-40 shrink-0">·</span>
          <span className="shrink-0">{t('admin.role')}</span>
        </span>
      }
      actions={
        <div className="flex items-center gap-1.5">
          {onSwitchToUserPortal ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic('medium');
                onSwitchToUserPortal();
              }}
              title={t('admin.switchToUserPortal')}
              aria-label={t('admin.switchToUserPortal')}
              className="hidden md:inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-brand/25 bg-brand-soft px-3 text-xs font-medium text-brand-fg hover:bg-brand/15 rs-focus press cursor-pointer shrink-0 transition-colors"
            >
              <Eye className="h-3.5 w-3.5 shrink-0" />
              <span>{t('admin.switchToUserPortal')}</span>
            </button>
          ) : null}

          <HeaderUtilityActions onRefresh={onRefresh} isRefreshing={isRefreshing} />
        </div>
      }
      footerClassName="md:hidden"
      footer={
        hasMobileQuickBar ? (
          <div
            className={`w-full grid gap-2 ${
              onOpenMore && onSwitchToUserPortal ? 'grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {onOpenMore ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  onOpenMore();
                }}
                aria-pressed={isMoreActive}
                className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium rs-focus press cursor-pointer transition-colors truncate ${
                  isMoreActive
                    ? 'border-brand/40 bg-brand-soft text-brand-fg'
                    : 'border-line bg-surface-2 text-ink-soft hover:border-line-strong hover:text-ink'
                }`}
              >
                <Settings2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t('admin.tabs.comingSoon')}</span>
              </button>
            ) : null}

            {onSwitchToUserPortal ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('medium');
                  onSwitchToUserPortal();
                }}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-brand/25 bg-brand-soft px-3 text-[11.5px] font-medium text-brand-fg hover:bg-brand/15 rs-focus press cursor-pointer transition-colors truncate"
              >
                <Eye className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t('admin.switchToUserPortal')}</span>
              </button>
            ) : null}
          </div>
        ) : undefined
      }
    />
  );
};
