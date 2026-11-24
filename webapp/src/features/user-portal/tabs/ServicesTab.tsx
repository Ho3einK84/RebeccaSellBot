import React, { useState, useMemo, useEffect } from 'react';
import {
  Wifi,
  Copy,
  Check,
  QrCode,
  ShieldCheck,
  ShoppingBag,
  Settings2,
  RefreshCw,
  Search,
  Link2,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import type {
  CustomVolumeSettings,
  TrialClaimResponse,
  UserConfigRecord,
  UserTrialStatus,
} from '@/shared/types/userPortal.js';
import {
  ServiceStatusDot,
  ServiceStatusBadge,
  ServiceAutoRenewBadge,
  ServiceTrafficBar,
  ServiceExpiryView,
  formatServiceCreatedDate,
} from '@/features/user-portal/components/ServiceStatusTraffic.js';
import { ServiceManagementModal } from '@/features/user-portal/components/ServiceManagementModal.js';
import { ClaimSubLinkModal } from '@/features/user-portal/components/ClaimSubLinkModal.js';
import { FreeTrialBanner } from '@/features/user-portal/components/FreeTrialSection.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';

interface ServicesTabProps {
  configs: UserConfigRecord[];
  botUsername?: string;
  currency?: string;
  customVolumeSettings?: CustomVolumeSettings;
  trial?: UserTrialStatus | null;
  initialConfigId?: string | null;
  onClearInitialConfig?: () => void;
  onOpenQr: (subUrl: string, configUsername: string) => void;
  onGoToShop: () => void;
  onRenewConfig?: (config: UserConfigRecord) => void;
  onTrialClaimed?: (res: TrialClaimResponse) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

type ServiceFilterType = 'all' | 'active' | 'attention' | 'inactive';

function isServiceUrgentForRenewal(config: UserConfigRecord): boolean {
  if (config.panelStatus === 'expired' || config.panelStatus === 'limited') {
    return true;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    typeof config.panelExpire === 'number' &&
    config.panelExpire > 0 &&
    config.panelExpire - nowSec <= 3 * 86_400
  ) {
    return true;
  }
  if (
    typeof config.panelDataLimit === 'number' &&
    config.panelDataLimit > 0 &&
    typeof config.panelUsedTraffic === 'number' &&
    config.panelUsedTraffic / config.panelDataLimit >= 0.8
  ) {
    return true;
  }
  return false;
}

export const ServicesTab: React.FC<ServicesTabProps> = ({
  configs,
  botUsername,
  currency,
  customVolumeSettings,
  trial,
  initialConfigId,
  onClearInitialConfig,
  onOpenQr,
  onGoToShop,
  onRenewConfig,
  onTrialClaimed,
  onNotify,
}) => {
  const { t, locale } = useLanguage();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();
  const { formatNumber } = useFormatters();
  const queryClient = useQueryClient();

  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ServiceFilterType>('all');
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);

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

  const filteredConfigs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return configs.filter((c) => {
      if (
        q &&
        !c.configUsername.toLowerCase().includes(q) &&
        !(c.userLabel ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (statusFilter === 'active') {
        return c.panelStatus === 'active' || c.panelStatus === 'on_hold';
      }
      if (statusFilter === 'attention') {
        return isServiceUrgentForRenewal(c);
      }
      if (statusFilter === 'inactive') {
        return (
          c.panelStatus === 'disabled' || c.panelStatus === 'expired' || c.panelStatus === 'limited'
        );
      }
      return true;
    });
  }, [configs, searchQuery, statusFilter]);

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

  const handleRenewClick = (config: UserConfigRecord) => {
    triggerHaptic('medium');
    onRenewConfig?.(config);
  };

  const handleSyncAll = async () => {
    if (isSyncingAll || configs.length === 0) return;
    setIsSyncingAll(true);
    triggerHaptic('light');
    try {
      const res = await api.syncAllUserConfigs();
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
      triggerHaptic('success');
      onNotify(
        t('user.services.syncAllSuccess').replace('{synced}', formatNumber(res.synced)),
        'success'
      );
    } catch {
      triggerHaptic('error');
      onNotify(t('user.services.refreshFailed'), 'error');
    } finally {
      setIsSyncingAll(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-4 pb-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <SectionHeader
          icon={<Wifi />}
          title={t('user.services.title')}
          count={formatNumber(configs.length)}
          className="flex-1 min-w-0"
        />

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              triggerHaptic('selection');
              setIsClaimModalOpen(true);
            }}
          >
            <Link2 className="w-3.5 h-3.5 text-brand-fg shrink-0" />
            <span>{t('user.services.claimLinkButton')}</span>
          </Button>

          {configs.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleSyncAll()}
              disabled={isSyncingAll}
              title={t('user.services.syncAll')}
              aria-label={t('user.services.syncAll')}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-brand-fg shrink-0 ${isSyncingAll ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">{t('user.services.syncAll')}</span>
            </Button>
          )}

          {configs.length > 0 && (
            <Button size="sm" variant="primary" onClick={onGoToShop}>
              <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{t('user.dashboard.buyService')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Search & Status Filter Controls (shown when user has multiple services) */}
      {configs.length >= 2 && (
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative w-full sm:flex-1">
            <Search className="w-4 h-4 text-ink-muted absolute start-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('user.services.searchPlaceholder')}
              className="w-full h-10 ps-10 pe-9 rounded-ctl border border-line bg-surface text-xs sm:text-[13px] text-ink placeholder:text-ink-muted shadow-[var(--shadow-xs)] rs-focus"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={t('common.clearSearch')}
                className="absolute end-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {(
              [
                { id: 'all', label: t('user.services.filterAll') },
                { id: 'active', label: t('user.services.filterActive') },
                { id: 'attention', label: t('user.services.filterAttention') },
                { id: 'inactive', label: t('user.services.filterInactive') },
              ] as const
            ).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setStatusFilter(chip.id);
                }}
                className={`h-9 px-3 rounded-full text-xs font-medium border shrink-0 press rs-focus cursor-pointer transition-colors ${
                  statusFilter === chip.id
                    ? 'bg-brand border-brand text-brand-ink'
                    : 'bg-surface border-line text-ink-soft hover:border-line-strong'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {configs.length === 0 ? (
        <div className="flex flex-col gap-4">
          <FreeTrialBanner
            trial={trial}
            botUsername={botUsername}
            onClaimed={onTrialClaimed}
            onNotify={onNotify}
          />
          <EmptyState
            icon={<ShieldCheck />}
            tone="brand"
            title={t('user.services.emptyTitle')}
            description={t('user.services.emptyDesc')}
            action={
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <Button onClick={onGoToShop}>
                  <ShoppingBag className="w-4 h-4" />
                  <span>{t('user.services.buyFirst')}</span>
                </Button>
                <Button variant="secondary" onClick={() => setIsClaimModalOpen(true)}>
                  <Link2 className="w-4 h-4" />
                  <span>{t('user.services.claimLinkButton')}</span>
                </Button>
              </div>
            }
            className="my-2"
          />
        </div>
      ) : filteredConfigs.length === 0 ? (
        <Card padding="lg" className="text-center flex flex-col items-center gap-2">
          <span className="text-xs text-ink-muted">{t('user.services.emptyTitle')}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
            }}
          >
            {t('common.clearSearch')}
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 anim-stagger">
          {filteredConfigs.map((c) => {
            const isSubCopied = isCopied(`sub-${c.id}`);
            const urgent = isServiceUrgentForRenewal(c);

            return (
              <Card
                key={c.id}
                padding="md"
                className={`flex flex-col justify-between gap-3.5 text-start transition-all duration-200 hover:border-line-strong hover:shadow-[var(--shadow-card-hover)] ${
                  urgent ? 'border-warn/45' : ''
                }`}
              >
                <div className="flex flex-col gap-3">
                  {/* Header: Name, Personal Label, Auto-renew, and Status */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ServiceStatusDot status={c.panelStatus} />
                      {c.userLabel ? (
                        <div className="flex flex-col min-w-0">
                          <span className="text-[13.5px] font-semibold truncate text-ink">
                            {c.userLabel}
                          </span>
                          <bdi dir="ltr" className="text-[11px] font-mono truncate text-ink-muted">
                            {c.configUsername}
                          </bdi>
                        </div>
                      ) : (
                        <bdi
                          dir="ltr"
                          className="text-[13.5px] font-mono font-medium truncate text-ink"
                        >
                          {c.configUsername}
                        </bdi>
                      )}
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

                {/* Actions: Renew, Copy Link, QR, and Manage Service */}
                <div className="flex flex-col gap-2 pt-0.5">
                  {onRenewConfig && urgent && (
                    <Button size="md" variant="primary" block onClick={() => handleRenewClick(c)}>
                      <RefreshCw className="w-4 h-4 shrink-0" />
                      <span>{t('user.services.renewQuick')}</span>
                    </Button>
                  )}

                  {c.subUrl && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="md"
                        variant={isSubCopied ? 'success' : 'secondary'}
                        onClick={() => void handleCopySub(c.subUrl!, `sub-${c.id}`)}
                        className="flex-1 min-w-0"
                      >
                        {isSubCopied ? (
                          <>
                            <Check className="w-4 h-4 shrink-0 anim-pop" />
                            <span className="truncate">{t('user.services.linkCopied')}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 shrink-0" />
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
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {onRenewConfig && !urgent && (
                      <Button
                        size="md"
                        variant="tonal"
                        onClick={() => handleRenewClick(c)}
                        className="flex-1"
                        title={t('user.services.renewNow')}
                        aria-label={t('user.services.renewNow')}
                      >
                        <RefreshCw className="w-4 h-4 text-brand-fg shrink-0" />
                        <span>{t('user.services.renewNow')}</span>
                      </Button>
                    )}

                    <Button
                      size="md"
                      variant="outline"
                      onClick={() => handleManageClick(c.id)}
                      className="flex-1"
                      title={t('user.services.manage')}
                      aria-label={t('user.services.manage')}
                    >
                      <Settings2 className="w-4 h-4 text-brand-fg shrink-0" />
                      <span className="truncate">{t('user.services.manage')}</span>
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Claim Existing Subscription Link Modal */}
      <ClaimSubLinkModal
        isOpen={isClaimModalOpen}
        onClose={() => setIsClaimModalOpen(false)}
        onNotify={onNotify}
      />

      {/* Service Management Modal */}
      <ServiceManagementModal
        isOpen={selectedConfig !== null}
        onClose={() => setSelectedConfigId(null)}
        config={selectedConfig}
        botUsername={botUsername}
        currency={currency}
        customVolumeSettings={customVolumeSettings}
        onOpenQr={onOpenQr}
        onRenewConfig={onRenewConfig}
        onNotify={onNotify}
      />
    </div>
  );
};
