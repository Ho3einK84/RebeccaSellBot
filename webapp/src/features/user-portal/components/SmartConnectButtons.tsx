import React, { useMemo } from 'react';
import { ExternalLink, Smartphone } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { buildClientConnectLinks } from '@/shared/lib/deepLinks.js';
import { Badge } from '@/shared/components/ui/Badge.js';

interface SmartConnectButtonsProps {
  subUrl: string;
  configUsername?: string;
}

export const SmartConnectButtons: React.FC<SmartConnectButtonsProps> = ({
  subUrl,
  configUsername,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();

  const platform = typeof window !== 'undefined' ? window.Telegram?.WebApp?.platform : undefined;

  const links = useMemo(
    () => buildClientConnectLinks(subUrl, platform, configUsername),
    [subUrl, platform, configUsername]
  );

  if (links.length === 0) return null;

  const handleOpen = (url: string, isBrowser: boolean) => {
    triggerHaptic('light');
    if (isBrowser && window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url);
      return;
    }
    window.location.href = url;
  };

  return (
    <div className="flex flex-col gap-2 text-start">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
        <Smartphone className="w-3.5 h-3.5 text-brand-fg shrink-0" />
        <span>{t('user.services.smartConnectTitle')}</span>
      </div>
      <p className="text-[11px] text-ink-muted m-0 leading-relaxed">
        {t('user.services.smartConnectHint')}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {links.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleOpen(item.url, item.id === 'browser')}
            className={`min-h-11 px-3 py-2 rounded-tile border text-xs font-medium flex items-center justify-between gap-1.5 press rs-focus cursor-pointer transition-colors ${
              item.recommended
                ? 'bg-brand-soft/75 border-brand/25 text-ink hover:bg-brand-soft shadow-[var(--shadow-xs)]'
                : 'bg-surface-2 border-line text-ink-soft hover:bg-surface-3 hover:text-ink'
            }`}
          >
            <span className="truncate font-semibold">{item.name}</span>
            <div className="flex items-center gap-1 shrink-0">
              {item.recommended && (
                <Badge variant="primary" size="xs">
                  {t('user.services.recommendedBadge')}
                </Badge>
              )}
              <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
