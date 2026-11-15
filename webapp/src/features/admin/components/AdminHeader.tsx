import React from 'react';
import { ShieldCheck, RotateCw, Globe, Check, Copy, Sun, Moon, LogOut, Eye } from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { IconButton } from '@/shared/components/ui/IconButton.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { TopBar } from '@/shared/components/layout/TopBar.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTheme } from '@/shared/theme/ThemeContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';

interface AdminHeaderProps {
  user: TelegramWebAppUser;
  onRefresh: () => void;
  onClose: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onSwitchToUserPortal?: () => void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  user,
  onRefresh,
  onClose,
  onNotify,
  onSwitchToUserPortal,
}) => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();
  const { isDark, toggleTheme } = useTheme();
  const { triggerHaptic } = useHaptic();
  const { copy, isCopied } = useCopy();
  const { formatId } = useFormatters();

  const rawAdminName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  const adminDisplayName = rawAdminName || t('admin.defaultAdminName');

  return (
    <TopBar
      icon={
        <IconTile tone="brand" size="md">
          <ShieldCheck />
        </IconTile>
      }
      title={t('admin.title')}
      subtitle={<span className="text-[11px] text-ink-muted">{t('admin.role')}</span>}
      actions={
        <>
          <IconButton
            size="sm"
            label={isDark ? t('common.themeLight') : t('common.themeDark')}
            onClick={() => {
              triggerHaptic('light');
              toggleTheme();
            }}
          >
            {isDark ? (
              <Sun className="h-4 w-4 text-warn-fg" />
            ) : (
              <Moon className="h-4 w-4 text-ink-soft" />
            )}
          </IconButton>

          {languageSelectionEnabled ? (
            <IconButton
              size="sm"
              label={t('common.language')}
              onClick={async () => {
                triggerHaptic('light');
                const next = locale === 'fa' ? 'en' : 'fa';
                const ok = await setLocale(next);
                if (ok) {
                  onNotify(t('admin.notifications.langChangeSuccess', undefined, next), 'success');
                }
              }}
            >
              <span className="flex items-center gap-0.5">
                <Globe className="h-3.5 w-3.5 opacity-70" />
                <span className="text-[10px] font-semibold leading-none">
                  {locale === 'fa' ? 'EN' : 'FA'}
                </span>
              </span>
            </IconButton>
          ) : null}

          <IconButton size="sm" label={t('common.refresh')} onClick={onRefresh}>
            <RotateCw className="h-4 w-4" />
          </IconButton>
        </>
      }
      footer={
        <>
          <div className="flex min-w-0 items-center gap-2">
            <Avatar
              name={adminDisplayName}
              username={user.username}
              photoUrl={user.photo_url}
              size="xs"
              circle
              className="shrink-0 ring-1 ring-line"
            />
            <span className="min-w-0 truncate text-xs font-semibold text-ink">
              {adminDisplayName}
            </span>
            <button
              type="button"
              onClick={() => copy(String(user.id), 'header-id')}
              className="press rs-focus inline-flex h-7 items-center gap-1 rounded-ctl border border-line bg-surface-2 px-2 tnum text-[11px] font-medium text-ink-soft hover:border-line-strong hover:text-ink cursor-pointer shrink-0"
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

          <div className="flex shrink-0 items-center gap-1.5">
            {onSwitchToUserPortal ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('medium');
                  onSwitchToUserPortal();
                }}
                title={t('admin.enterUserBeta')}
                className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-brand/30 bg-brand-soft px-2.5 text-xs font-medium text-brand-fg hover:bg-brand/20 rs-focus press cursor-pointer shrink-0"
              >
                <Eye className="h-3.5 w-3.5 shrink-0" />
                <span>{t('admin.enterUserBeta')}</span>
              </button>
            ) : null}

            <IconButton size="sm" tone="danger" label={t('admin.exit')} onClick={onClose}>
              <LogOut className="h-4 w-4 rtl:-scale-x-100" />
            </IconButton>
          </div>
        </>
      }
    />
  );
};
