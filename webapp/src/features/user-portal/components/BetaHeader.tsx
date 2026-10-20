import React from 'react';
import {
  Sun,
  Moon,
  Globe,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  FlaskConical,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { IconButton } from '@/shared/components/ui/IconButton.js';
import { TopBar } from '@/shared/components/layout/TopBar.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { toPersianDigits } from '@/shared/lib/formatters.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
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
  const { t, locale, isRtl, languageSelectionEnabled, setLocale } = useLanguage();
  const { isDark, toggleTheme } = useThemeTokens();
  const { triggerHaptic } = useHaptic();
  const { sanitizeDisplayName, formatToman } = useFormatters();
  const displayCurrency = currency || t('common.currency');

  const { displayName } = sanitizeDisplayName(user.first_name, user.last_name, t('user.guestUser'));
  const hasFooter = isAdminPreview || balance !== undefined;
  const exitLabel = isAdminPreview ? t('user.backToAdmin') : t('user.backToComingSoon');

  const handleExit = () => {
    triggerHaptic('medium');
    if (isAdminPreview && onSwitchToAdmin) {
      onSwitchToAdmin();
    } else {
      onExitBeta();
    }
  };

  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <TopBar
      icon={
        <Avatar
          name={displayName}
          username={user.username}
          photoUrl={user.photo_url}
          size="sm"
          circle
          className="shrink-0 ring-1 ring-brand/25"
        />
      }
      title={displayName}
      badge={
        <Badge variant="primary" size="xs">
          <FlaskConical className="h-2.5 w-2.5 shrink-0" />
          <span>{t('user.betaBadge')}</span>
        </Badge>
      }
      subtitle={
        <span className="tnum">
          <span className="tnum">
            {t('common.idLabel')} {locale === 'fa' ? toPersianDigits(String(user.id)) : user.id}
          </span>
        </span>
      }
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
              <Sun className="h-4 w-4 text-warn" />
            ) : (
              <Moon className="h-4 w-4 text-ink-soft" />
            )}
          </IconButton>

          {languageSelectionEnabled ? (
            <IconButton
              size="sm"
              label={t('common.switchLang')}
              onClick={() => {
                triggerHaptic('selection');
                void setLocale(locale === 'fa' ? 'en' : 'fa');
              }}
            >
              <Globe className="h-4 w-4" />
            </IconButton>
          ) : null}

          {!hasFooter ? (
            <IconButton size="sm" label={exitLabel} onClick={handleExit}>
              {isAdminPreview ? (
                <ShieldCheck className="h-4 w-4 text-brand" />
              ) : (
                <BackIcon className="h-4 w-4" />
              )}
            </IconButton>
          ) : null}

          <IconButton size="sm" label={t('common.refresh')} onClick={onRefresh}>
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-brand' : ''}`} />
          </IconButton>
        </>
      }
      footer={
        hasFooter ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={handleExit}
                className="press rs-focus inline-flex shrink-0 items-center gap-1.5 rounded-ctl border border-line bg-surface-2 px-2 py-1.5 text-[11px] font-semibold text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                title={isAdminPreview ? t('user.backToAdmin') : t('user.backToComingSoon')}
                aria-label={isAdminPreview ? t('user.backToAdmin') : t('user.backToComingSoon')}
              >
                {isAdminPreview ? (
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand" />
                ) : (
                  <BackIcon className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="whitespace-nowrap">
                  {isAdminPreview ? t('user.backToAdmin') : t('user.backToComingSoon')}
                </span>
              </button>

              {isAdminPreview ? (
                <Badge variant="primary" size="xs">
                  <ShieldCheck className="h-2.5 w-2.5 shrink-0" />
                  <span>{t('user.adminPreviewBadge')}</span>
                </Badge>
              ) : null}
            </div>

            {balance !== undefined ? (
              <div className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-ctl border border-brand/25 bg-brand-soft px-2 py-1.5">
                <Wallet className="h-3.5 w-3.5 shrink-0 text-brand opacity-80" />
                <span className="tnum truncate text-xs font-bold leading-none text-brand">
                  {formatToman(balance)} {displayCurrency}
                </span>
              </div>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
};
