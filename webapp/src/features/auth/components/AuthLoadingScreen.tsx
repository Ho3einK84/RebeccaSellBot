import React from 'react';
import { Loader2, Shield } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { AppVersionFooter } from '@/shared/components/ui/VersionBadge.js';

export const AuthLoadingScreen: React.FC = () => {
  const { t, isRtl } = useLanguage();

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center p-4 rs-canvas-bg bg-canvas text-ink safe-top safe-bottom"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <Card
        padding="lg"
        className="w-full max-w-xs flex flex-col items-center text-center gap-4 anim-rise"
      >
        <IconTile tone="brand" size="lg" className="anim-breathe">
          <Shield />
        </IconTile>

        <div className="space-y-1.5">
          <div className="flex items-center justify-center gap-2 text-sm font-semibold text-ink">
            <Loader2 className="w-4 h-4 animate-spin text-brand-fg shrink-0" />
            <span>{t('auth.connecting')}</span>
          </div>
          <p className="text-xs text-ink-muted m-0">{t('user.serviceOnlineStatus')}</p>
        </div>
      </Card>

      <AppVersionFooter className="mt-4 border-t-0 pt-0" />
    </div>
  );
};
