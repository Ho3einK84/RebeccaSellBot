import React, { useState, useMemo } from 'react';
import { Wifi, Copy, Check, QrCode, ShieldCheck, ShoppingBag, Settings2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
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

interface ServicesTabProps {
  configs: UserConfigRecord[];
  botUsername?: string;
  onOpenQr: (subUrl: string, configUsername: string) => void;
  onGoToShop: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const ServicesTab: React.FC<ServicesTabProps> = ({
  configs,
  botUsername,
  onOpenQr,
  onGoToShop,
  onNotify,
}) => {
  const { t, locale } = useLanguage();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();

  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

  const selectedConfig = useMemo(
    () => configs.find((c) => c.id === selectedConfigId) ?? null,
    [configs, selectedConfigId]
  );

  const handleCopySub = (subUrl: string, id: string) => {
    triggerHaptic('light');
    copy(subUrl, id);
    onNotify(t('user.services.linkCopied'), 'success');
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
      <div className="flex items-center justify-between px-1">
        <h2 className={`text-sm font-bold flex items-center gap-2 text-ink`}>
          <Wifi className="w-4 h-4 text-brand" />
          <span>{t('user.services.title')}</span>
          <span className="tnum text-xs font-bold text-brand">({configs.length})</span>
        </h2>

        {configs.length > 0 && (
          <button
            type="button"
            onClick={onGoToShop}
            className="min-h-[44px] px-2 text-xs font-semibold text-brand hover:text-brand flex items-center gap-1 cursor-pointer"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>{t('user.dashboard.buyService')}</span>
          </button>
        )}
      </div>

      {configs.length === 0 ? (
        <div
          className={`p-6 rounded-3xl border text-center flex flex-col items-center gap-3 my-4 bg-surface border-line shadow-2xs`}
        >
          <div className="w-14 h-14 rounded-2xl bg-brand/10 text-brand flex items-center justify-center border border-brand/15">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h3 className={`text-sm font-bold text-ink`}>{t('user.services.emptyTitle')}</h3>
          <p className="text-xs text-ink-muted max-w-xs m-0">{t('user.services.emptyDesc')}</p>
          <button
            type="button"
            onClick={onGoToShop}
            className="mt-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-brand hover:bg-brand text-brand-ink font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-md"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>{t('user.services.buyFirst')}</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {configs.map((c) => {
            const isSubCopied = isCopied(`sub-${c.id}`);

            return (
              <div
                key={c.id}
                className={`p-4 rounded-2xl border flex flex-col gap-3 text-start transition-all bg-surface border-line hover:border-line-strong shadow-2xs`}
              >
                {/* Header: Name, Auto-renew, and Status */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <ServiceStatusDot status={c.panelStatus} />
                    <span className={`text-xs sm:text-sm tnum font-bold truncate text-ink`}>
                      {c.configUsername}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <ServiceAutoRenewBadge enabled={c.autoRenewEnabled} />
                    <ServiceStatusBadge status={c.panelStatus} />
                  </div>
                </div>

                {/* Traffic Usage Bar */}
                <ServiceTrafficBar dataLimit={c.panelDataLimit} usedTraffic={c.panelUsedTraffic} />

                {/* Expiration Info & Created Date */}
                <div className="flex items-center justify-between text-[11px] text-ink-muted pt-1 border-t border-line/50 gap-2 flex-wrap">
                  <ServiceExpiryView expireTimestampSec={c.panelExpire} />

                  <span className="text-[10px] text-ink-muted tnum">
                    {formatServiceCreatedDate(c.createdAt, locale, t)}
                  </span>
                </div>

                {/* Actions: Copy Link, QR, and Manage Service */}
                <div className="flex items-center gap-2 pt-1">
                  {c.subUrl && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleCopySub(c.subUrl!, `sub-${c.id}`)}
                        className={`flex-1 min-h-[44px] py-2 px-3 rounded-xl font-medium text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer ${isSubCopied ? 'bg-ok text-white font-bold' : 'bg-surface-2 hover:bg-surface-3 text-ink-soft border border-line'}`}
                      >
                        {isSubCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>{t('user.services.linkCopied')}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>{t('user.services.copyLink')}</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleQrClick(c.subUrl!, c.configUsername)}
                        className="min-h-[44px] p-2.5 rounded-xl border flex items-center justify-center transition-all active:scale-95 cursor-pointer bg-brand-soft hover:bg-brand/20 text-brand border-brand/25"
                        title={t('user.services.showQr')}
                        aria-label={t('user.services.showQr')}
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                    </>
                  )}

                  {/* Manage Service Button */}
                  <button
                    type="button"
                    onClick={() => handleManageClick(c.id)}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer border bg-surface-2 hover:bg-surface-3 text-brand border-brand/25 shadow-2xs"
                    title={t('user.services.manage')}
                    aria-label={t('user.services.manage')}
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    <span>{t('user.services.manage')}</span>
                  </button>
                </div>
              </div>
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
