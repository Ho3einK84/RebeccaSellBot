import React from 'react';
import { Loader2, Shield } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';

export const AuthLoadingScreen: React.FC = () => {
  const { t, isRtl } = useLanguage();

  return (
    <div
      className="fixed inset-0 w-screen flex items-center justify-center p-4 bg-canvas text-ink"
      style={{ height: '100dvh' }}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <Card
        padding="lg"
        className="w-full max-w-xs flex flex-col items-center text-center gap-4 anim-rise"
      >
        <IconTile tone="brand" size="lg">
          <Shield className="w-5 h-5" />
        </IconTile>

        <div className="space-y-1.5">
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-ink">
            <Loader2 className="w-4 h-4 animate-spin text-brand-fg shrink-0" />
            <span>{t('common.loading')}</span>
          </div>
          <p className="text-xs text-ink-muted m-0">{t('user.serviceOnlineStatus')}</p>
        </div>
      </Card>
    </div>
  );
};
