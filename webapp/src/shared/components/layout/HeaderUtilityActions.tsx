import React from 'react';
import { Sun, Moon, Globe, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTheme } from '@/shared/theme/ThemeContext.js';
import { useToast } from '@/shared/components/ui/Toast.js';
import { IconButton } from '@/shared/components/ui/IconButton.js';

interface HeaderUtilityActionsProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

/**
 * Unified top-bar utility buttons (Theme, Language, Refresh) shared across
 * both Admin Console and User Portal so chrome never drifts.
 */
export const HeaderUtilityActions: React.FC<HeaderUtilityActionsProps> = ({
  onRefresh,
  isRefreshing = false,
}) => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();
  const { isDark, toggleTheme } = useTheme();
  const { notify } = useToast();

  const handleToggleLanguage = async () => {
    const next = locale === 'fa' ? 'en' : 'fa';
    const ok = await setLocale(next);
    if (ok) {
      notify(t('common.langChangeSuccess', undefined, next), 'success');
    } else {
      notify(t('common.langChangeFailed'), 'error');
    }
  };

  return (
    <>
      <IconButton
        size="sm"
        label={t('common.themeToggle')}
        title={isDark ? t('common.themeLight') : t('common.themeDark')}
        onClick={toggleTheme}
        className="rounded-full"
      >
        {isDark ? (
          <Sun key="sun" className="h-4 w-4 text-warn-fg anim-pop" />
        ) : (
          <Moon key="moon" className="h-4 w-4 text-ink-soft anim-pop" />
        )}
      </IconButton>

      {languageSelectionEnabled ? (
        <IconButton
          size="sm"
          label={t('common.language')}
          title={t('common.switchLang')}
          onClick={() => void handleToggleLanguage()}
          className="!w-auto px-2.5 rounded-full"
        >
          <span className="flex items-center gap-1">
            <Globe className="h-3.5 w-3.5 opacity-75" />
            <span className="text-[11px] font-semibold leading-none tracking-normal">
              {locale === 'fa' ? 'EN' : 'FA'}
            </span>
          </span>
        </IconButton>
      ) : null}

      {onRefresh ? (
        <IconButton
          size="sm"
          label={t('common.refresh')}
          onClick={onRefresh}
          disabled={isRefreshing}
          className="rounded-full"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-brand-fg' : ''}`} />
        </IconButton>
      ) : null}
    </>
  );
};
