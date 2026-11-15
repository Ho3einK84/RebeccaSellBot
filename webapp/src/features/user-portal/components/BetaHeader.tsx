import React from 'react';
import { Sun, Moon, Globe, RefreshCw, Shield, LogOut, Copy, Check } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTheme } from '@/shared/theme/ThemeContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { TopBar } from '@/shared/components/layout/TopBar.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { IconButton } from '@/shared/components/ui/IconButton.js';
import type { TelegramWebAppUser } from '@/shared/types/telegram.js';

interface BetaHeaderProps {
  user: TelegramWebAppUser;
  onRefresh: () => void;
  onExitBeta: () => void;
  isAdminPreview?: boolean;
  onSwitchToAdmin?: () => void;
  balance?: number;
  currency?: string;
  isRefreshing?: boolean;
}

export const BetaHeader: React.FC<BetaHeaderProps> = ({
  user,
  onRefresh,
  onExitBeta,
  isAdminPreview = false,
  onSwitchToAdmin,
  isRefreshing = false,
}) => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();
  const { isDark, toggleTheme } = useTheme();
  const { sanitizeDisplayName, formatId } = useFormatters();
  const { triggerHaptic } = useHaptic();
  const { copy, isCopied } = useCopy();

  const { displayName } = sanitizeDisplayName(user.first_name, user.last_name, t('user.guestUser'));
  const exitLabel = isAdminPreview ? t('user.backToAdmin') : t('user.backToComingSoon');

  const toggleLanguage = () => {
    triggerHaptic('light');
    void setLocale(locale === 'fa' ? 'en' : 'fa');
  };

  return (
    <TopBar
      icon={
        <Avatar
          name={displayName}
          username={user.username}
          photoUrl={user.photo_url}
          size="md"
          className="shrink-0 ring-1 ring-line"
        />
      }
      title={displayName}
      subtitle={
        user.username ? (
          <bdi dir="ltr" className="tnum text-[11px] font-medium text-brand-fg">
            @{user.username}
          </bdi>
        ) : (
          <span className="text-[11px] text-ink-muted">{t('user.userPortalBadge')}</span>
        )
      }
      actions={
        <>
          <IconButton
            size="sm"
            label={t('common.themeToggle')}
            title={isDark ? t('common.themeLight') : t('common.themeDark')}
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
            <IconButton size="sm" label={t('common.switchLang')} onClick={toggleLanguage}>
              <span className="flex items-center gap-0.5">
                <Globe className="h-3.5 w-3.5 opacity-70" />
                <span className="text-[10px] font-semibold leading-none">
                  {locale === 'fa' ? 'EN' : 'FA'}
                </span>
              </span>
            </IconButton>
          ) : null}

          <IconButton
            size="sm"
            label={t('common.refresh')}
            onClick={() => {
              triggerHaptic('light');
              onRefresh();
            }}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-brand-fg' : ''}`} />
          </IconButton>
        </>
      }
      footer={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => copy(String(user.id), 'beta-header-id')}
              className="press rs-focus inline-flex h-7 items-center gap-1 rounded-ctl border border-line bg-surface-2 px-2 tnum text-[11px] font-medium text-ink-soft hover:border-line-strong hover:text-ink cursor-pointer shrink-0"
              title={t('common.copy')}
              aria-label={t('common.copy')}
            >
              <span className="hidden sm:inline text-ink-muted">{t('common.idLabel')}</span>
              <bdi dir="ltr" className="tnum text-ink">
                #{formatId(user.id)}
              </bdi>
              {isCopied('beta-header-id') ? (
                <Check className="h-3 w-3 text-ok-fg shrink-0" />
              ) : (
                <Copy className="h-3 w-3 opacity-60 shrink-0" />
              )}
            </button>

            {isAdminPreview ? (
              <Badge variant="primary" size="xs" className="hidden sm:inline-flex">
                <Shield className="w-3 h-3" />
                <span>{t('user.adminPreviewBadge')}</span>
              </Badge>
            ) : (
              <Badge variant="neutral" size="xs">
                {t('user.betaBadge')}
              </Badge>
            )}
          </div>

          <div className="ms-auto flex items-center gap-1.5 shrink-0">
            {isAdminPreview && onSwitchToAdmin ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  onSwitchToAdmin();
                }}
                title={exitLabel}
                className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-brand/30 bg-brand-soft px-2.5 text-xs font-medium text-brand-fg hover:bg-brand/20 rs-focus press cursor-pointer shrink-0"
              >
                <Shield className="w-3.5 h-3.5 shrink-0" />
                <span>{exitLabel}</span>
              </button>
            ) : (
              <IconButton
                size="sm"
                tone="danger"
                label={exitLabel}
                onClick={onExitBeta}
                className="!h-8 !w-8"
              >
                <LogOut className="h-4 w-4 rtl:-scale-x-100" />
              </IconButton>
            )}
          </div>
        </>
      }
    />
  );
};
