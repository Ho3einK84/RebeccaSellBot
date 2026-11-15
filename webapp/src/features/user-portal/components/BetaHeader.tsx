import React from 'react';
import { Sun, Moon, Globe, RefreshCw, Shield, LogOut, Wallet } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTheme } from '@/shared/theme/ThemeContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
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
  balance,
  currency,
  isRefreshing = false,
}) => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();
  const { isDark, toggleTheme } = useTheme();
  const { formatMoney, sanitizeDisplayName, toPersianDigits } = useFormatters();
  const { triggerHaptic } = useHaptic();

  const displayCurrency = currency || t('common.currency');
  const { displayName } = sanitizeDisplayName(user.first_name, user.last_name, t('user.guestUser'));
  const exitLabel = isAdminPreview ? t('user.backToAdmin') : t('user.backToComingSoon');
  const idDisplay = locale === 'fa' ? toPersianDigits(String(user.id)) : String(user.id);

  const toggleLanguage = () => {
    setLocale(locale === 'fa' ? 'en' : 'fa');
  };

  return (
    <TopBar
      icon={
        <Avatar name={displayName} username={user.username} photoUrl={user.photo_url} size="md" />
      }
      title={displayName}
      badge={
        isAdminPreview ? (
          <Badge variant="primary" size="xs">
            <Shield className="w-3 h-3" />
            <span>{t('user.adminPreviewBadge')}</span>
          </Badge>
        ) : (
          <Badge variant="neutral" size="xs">
            {t('user.betaBadge')}
          </Badge>
        )
      }
      subtitle={
        <div className="flex items-center gap-2 flex-wrap">
          {user.username ? (
            <bdi dir="ltr" className="font-mono text-[11px] text-ink-soft">
              @{user.username}
            </bdi>
          ) : null}
          <span className="tnum text-[11px] text-ink-muted">
            {t('common.idLabel')}{' '}
            <bdi dir="ltr" className="font-mono">
              {idDisplay}
            </bdi>
          </span>
        </div>
      }
      actions={
        <>
          <IconButton
            size="sm"
            label={t('common.themeToggle')}
            title={isDark ? t('common.themeLight') : t('common.themeDark')}
            onClick={toggleTheme}
          >
            {isDark ? <Sun /> : <Moon />}
          </IconButton>

          {languageSelectionEnabled ? (
            <IconButton size="sm" label={t('common.switchLang')} onClick={toggleLanguage}>
              <Globe />
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
            <RefreshCw className={isRefreshing ? 'animate-spin text-brand-fg' : ''} />
          </IconButton>

          {isAdminPreview && onSwitchToAdmin ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic('selection');
                onSwitchToAdmin();
              }}
              title={exitLabel}
              className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-brand/30 bg-brand-soft px-2.5 text-xs font-medium text-brand-fg hover:bg-brand/20 rs-focus press cursor-pointer shrink-0"
            >
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{exitLabel}</span>
            </button>
          ) : (
            <IconButton size="sm" label={exitLabel} onClick={onExitBeta}>
              <LogOut className="ltr:rotate-0 rtl:rotate-180" />
            </IconButton>
          )}
        </>
      }
      footer={
        balance !== undefined ? (
          <div className="flex w-full items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <Wallet className="w-3.5 h-3.5 text-brand-fg shrink-0" />
              <span>{t('user.dashboard.walletBalance')}</span>
            </span>
            <span className="tnum font-semibold text-ink">
              {formatMoney(balance)}{' '}
              <span className="text-[11px] font-normal text-ink-muted">{displayCurrency}</span>
            </span>
          </div>
        ) : undefined
      }
    />
  );
};
