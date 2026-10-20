import React from 'react';
import {
  ShieldCheck,
  RotateCw,
  Globe,
  Check,
  Copy,
  Sun,
  Moon,
  LogOut,
  FlaskConical,
} from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { IconButton } from '@/shared/components/ui/IconButton.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { TopBar } from '@/shared/components/layout/TopBar.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { toPersianDigits } from '@/shared/lib/formatters.js';
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
  const { isDark, toggleTheme } = useThemeTokens();
  const { triggerHaptic } = useHaptic();
  const { copy, isCopied } = useCopy();

  const rawAdminName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  const adminDisplayName = rawAdminName || 'Admin';

  return (
    <TopBar
      icon={
        <IconTile tone="brand" size="md">
          <ShieldCheck />
        </IconTile>
      }
      title={t('admin.title')}
      badge={
        <Badge variant="warning" dot pulse size="xs" className="font-semibold">
          {t('admin.betaBadge')}
        </Badge>
      }
      actions={
        <>
          <IconButton
            size="md"
            label={isDark ? t('common.themeLight') : t('common.themeDark')}
            onClick={() => {
              triggerHaptic('light');
              toggleTheme();
            }}
          >
            {isDark ? (
              <Sun className="h-4 w-4 text-warn" />
            ) : (
              <Moon className="h-4 w-4 text-ink-soft" />
            )}
          </IconButton>

          {languageSelectionEnabled ? (
            <IconButton
              size="md"
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
                <span className="text-[10px] font-bold uppercase leading-none">
                  {locale === 'fa' ? 'EN' : 'FA'}
                </span>
              </span>
            </IconButton>
          ) : null}

          <IconButton size="md" label={t('common.refresh')} onClick={onRefresh}>
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
            <span className="min-w-0 truncate text-[11px] leading-tight text-ink-muted">
              {t('common.welcome')}{' '}
              <span className="text-xs font-semibold text-ink">{adminDisplayName}</span>
            </span>
            <span className="hidden shrink-0 rounded-md border border-brand/25 bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand sm:inline-block">
              {t('admin.role')}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => copy(String(user.id), 'header-id')}
              className="press rs-focus inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 tnum text-[11px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
              title={t('common.copy')}
              aria-label={t('common.copy')}
            >
              <span className="text-[10px] opacity-50">#</span>
              <span dir="ltr">{locale === 'fa' ? toPersianDigits(String(user.id)) : user.id}</span>
              {isCopied('header-id') ? (
                <Check className="h-3 w-3 text-ok" />
              ) : (
                <Copy className="h-2.5 w-2.5 opacity-50" />
              )}
            </button>

            {onSwitchToUserPortal ? (
              <IconButton
                size="md"
                tone="brand"
                label={t('admin.enterUserBeta')}
                onClick={() => {
                  triggerHaptic('medium');
                  onSwitchToUserPortal();
                }}
              >
                <FlaskConical className="h-4 w-4" />
              </IconButton>
            ) : null}

            <IconButton size="md" tone="danger" label={t('admin.exit')} onClick={onClose}>
              <LogOut className="h-4 w-4 rtl:-scale-x-100" />
            </IconButton>
          </div>
        </>
      }
    />
  );
};
