import React from 'react';
import { Sun, Moon, Globe, Shield } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTheme } from '@/shared/theme/ThemeContext.js';
import { TopBar } from '@/shared/components/layout/TopBar.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { IconButton } from '@/shared/components/ui/IconButton.js';
import { Badge } from '@/shared/components/ui/Badge.js';

export const UserHeader: React.FC = () => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();
  const { isDark, toggleTheme } = useTheme();

  const toggleLanguage = () => {
    setLocale(locale === 'fa' ? 'en' : 'fa');
  };

  return (
    <TopBar
      icon={
        <IconTile tone="brand" size="md">
          <Shield />
        </IconTile>
      }
      title={t('user.userPortalBadge')}
      badge={
        <Badge variant="success" size="xs" dot>
          {t('user.serviceOnlineStatus')}
        </Badge>
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
        </>
      }
    />
  );
};
