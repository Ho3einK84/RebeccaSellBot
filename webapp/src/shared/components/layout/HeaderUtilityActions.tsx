import React from 'react';
import { Sun, Moon, Globe, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTheme } from '@/shared/theme/ThemeContext.js';
import { useToast } from '@/shared/components/ui/Toast.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

interface HeaderUtilityActionsProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

/**
 * Unified top-bar utility capsule (Theme, Language, Refresh) shared across
 * both Admin Console and User Portal so header controls stay compact and cohesive.
 */
export const HeaderUtilityActions: React.FC<HeaderUtilityActionsProps> = ({
  onRefresh,
  isRefreshing = false,
}) => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();
  const { isDark, toggleTheme } = useTheme();
  const { notify } = useToast();
  const { triggerHaptic } = useHaptic();

  const handleToggleLanguage = async () => {
    triggerHaptic('light');
    const next = locale === 'fa' ? 'en' : 'fa';
    const ok = await setLocale(next);
    if (ok) {
      notify(t('common.langChangeSuccess', undefined, next), 'success');
    } else {
      notify(t('common.langChangeFailed'), 'error');
    }
  };

  return (
    <div
      role="group"
      aria-label={t('common.refresh')}
      className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface-2/85 p-0.5 shrink-0"
    >
      <button
        type="button"
        aria-label={t('common.themeToggle')}
        title={isDark ? t('common.themeLight') : t('common.themeDark')}
        onClick={() => {
          triggerHaptic('light');
          toggleTheme();
        }}
        className="inline-flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-ink-soft hover:bg-surface-3 hover:text-ink rs-focus press cursor-pointer transition-colors"
      >
        {isDark ? (
          <Sun key="sun" className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-warn-fg anim-pop" />
        ) : (
          <Moon key="moon" className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-ink-soft anim-pop" />
        )}
      </button>

      {languageSelectionEnabled ? (
        <button
          type="button"
          aria-label={t('common.language')}
          title={t('common.switchLang')}
          onClick={() => void handleToggleLanguage()}
          className="inline-flex h-7 sm:h-8 items-center justify-center gap-1 rounded-full px-2 sm:px-2.5 text-[10.5px] sm:text-[11px] font-semibold leading-none text-ink-soft hover:bg-surface-3 hover:text-ink rs-focus press cursor-pointer transition-colors"
        >
          <Globe className="hidden sm:inline h-3.5 w-3.5 opacity-75 shrink-0" />
          <span>{locale === 'fa' ? 'EN' : 'FA'}</span>
        </button>
      ) : null}

      {onRefresh ? (
        <button
          type="button"
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
          onClick={() => {
            if (isRefreshing) return;
            triggerHaptic('light');
            onRefresh();
          }}
          disabled={isRefreshing}
          className="inline-flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-ink-soft hover:bg-surface-3 hover:text-ink rs-focus press cursor-pointer transition-colors disabled:opacity-45 disabled:pointer-events-none"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isRefreshing ? 'animate-spin text-brand-fg' : ''}`}
          />
        </button>
      ) : null}
    </div>
  );
};
