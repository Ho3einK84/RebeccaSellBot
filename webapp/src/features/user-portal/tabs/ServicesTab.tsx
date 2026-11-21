import React, { useState, useMemo, useEffect } from 'react';
import { Wifi, Copy, Check, QrCode, ShieldCheck, ShoppingBag, Settings2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { UserConfigRecord } from '@/shared/types/userPortal.js';
import {
  ServiceStatusDot,
  ServiceStatusBadge,
  ServiceAutoRenewBadge,
  ServiceTrafficBar,
  ServiceExpiryView,
  formatServiceCreatedDate,
} from '@/features/user-portal/components/ServiceStatusTraffic.js';
import { ServiceManagementModal } from '@/features/user-portal/components/ServiceManagementModal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';

interface ServicesTabProps {
  configs: UserConfigRecord[];
  botUsername?: string;
  initialConfigId?: string | null;
  onClearInitialConfig?: () => void;
  onOpenQr: (subUrl: string, configUsername: string) => void;
  onGoToShop: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const ServicesTab: React.FC<ServicesTabProps> = ({
  configs,
  botUsername,
  initialConfigId,
  onClearInitialConfig,
  onOpenQr,
  onGoToShop,
  onNotify,
}) => {
  const { t, locale } = useLanguage();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();
  const { formatNumber } = useFormatters();

  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

  useEffect(() => {
    if (initialConfigId && configs.some((c) => c.id === initialConfigId)) {
      setSelectedConfigId(initialConfigId);
      onClearInitialConfig?.();
    }
  }, [initialConfigId, configs, onClearInitialConfig]);

  const selectedConfig = useMemo(
    () => configs.find((c) => c.id === selectedConfigId) ?? null,
    [configs, selectedConfigId]
  );

  const handleCopySub = async (subUrl: string, id: string) => {
    triggerHaptic('light');
    const ok = await copy(subUrl, id);
    if (ok) {
      onNotify(t('user.services.linkCopied'), 'success');
    }
  };

  const handleQrClick = (subUrl: string, username: string) => {
    triggerHaptic('selection');
    onOpenQr(subUrl, username);
  };

  const handleManageClick = (configId: string) => {
    triggerHaptic('selection');
    setSelectedConfigId(configId);
  };

  return (
    <div className="w-full flex flex-col gap-4 pb-6">
      <div className="flex items-center justify-between gap-3">
        <SectionHeader
          icon={<Wifi />}
          title={t('user.services.title')}
          count={formatNumber(configs.length)}
          className="flex-1 min-w-0"
        />

        {configs.length > 0 && (
          <Button size="sm" variant="secondary" onClick={onGoToShop} className="shrink-0">
            <ShoppingBag className="w-3.5 h-3.5 text-brand-fg shrink-0" />
            <span>{t('user.dashboard.buyService')}</span>
          </Button>
        )}
      </div>

      {configs.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          tone="brand"
          title={t('user.services.emptyTitle')}
          description={t('user.services.emptyDesc')}
          action={
            <Button onClick={onGoToShop}>
              <ShoppingBag className="w-4 h-4" />
              <span>{t('user.services.buyFirst')}</span>
            </Button>
          }
          className="my-2"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 anim-stagger">
          {configs.map((c) => {
            const isSubCopied = isCopied(`sub-${c.id}`);

            return (
              <Card
                key={c.id}
                padding="md"
                className="flex flex-col justify-between gap-3.5 text-start transition-all duration-200 hover:border-line-strong hover:shadow-[var(--shadow-card-hover)]"
              >
                <div className="flex flex-col gap-3">
                  {/* Header: Name, Auto-renew, and Status */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ServiceStatusDot status={c.panelStatus} />
                      <bdi
                        dir="ltr"
                        className="text-[13.5px] font-mono font-medium truncate text-ink"
                      >
                        {c.configUsername}
                      </bdi>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <ServiceAutoRenewBadge enabled={c.autoRenewEnabled} />
                      <ServiceStatusBadge status={c.panelStatus} />
                    </div>
                  </div>

                  {/* Traffic Usage Bar */}
                  <ServiceTrafficBar
                    dataLimit={c.panelDataLimit}
                    usedTraffic={c.panelUsedTraffic}
                  />

                  {/* Expiration Info & Created Date */}
                  <div className="flex items-center justify-between text-xs text-ink-muted pt-2.5 border-t border-line gap-2 flex-wrap">
                    <ServiceExpiryView
                      expireTimestampSec={c.panelExpire}
                      panelStatus={c.panelStatus}
                      onHoldExpireDurationSec={c.panelOnHoldExpireDuration}
                    />

                    <span className="text-[11px] text-ink-muted tnum">
                      {formatServiceCreatedDate(c.createdAt, locale, t)}
                    </span>
                  </div>
                </div>

                {/* Actions: Copy Link, QR, and Manage Service */}
                <div className="flex items-center gap-2 pt-0.5">
                  {c.subUrl && (
                    <>
                      <Button
                        size="md"
                        variant={isSubCopied ? 'success' : 'secondary'}
                        onClick={() => void handleCopySub(c.subUrl!, `sub-${c.id}`)}
                        className="flex-1 min-w-0"
                      >
                        {isSubCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 shrink-0 anim-pop" />
                            <span className="truncate">{t('user.services.linkCopied')}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{t('user.services.copyLink')}</span>
                          </>
                        )}
                      </Button>

                      <Button
                        size="md"
                        variant="tonal"
                        onClick={() => handleQrClick(c.subUrl!, c.configUsername)}
                        className="w-11 px-0 shrink-0"
                        title={t('user.services.showQr')}
                        aria-label={t('user.services.showQr')}
                      >
                        <QrCode className="w-4 h-4" />
                      </Button>
                    </>
                  )}

                  <Button
                    size="md"
                    variant="outline"
                    onClick={() => handleManageClick(c.id)}
                    className={c.subUrl ? 'shrink-0' : 'flex-1'}
                    title={t('user.services.manage')}
                    aria-label={t('user.services.manage')}
                  >
                    <Settings2 className="w-4 h-4 text-brand-fg shrink-0" />
                    <span>{t('user.services.manage')}</span>
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Service Management Modal */}
      <ServiceManagementModal
        isOpen={selectedConfig !== null}
        onClose={() => setSelectedConfigId(null)}
        config={selectedConfig}
        botUsername={botUsername}
        onOpenQr={onOpenQr}
        onNotify={onNotify}
      />
    </div>
  );
};
