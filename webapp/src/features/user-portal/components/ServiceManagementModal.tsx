import React, { useState, useEffect } from 'react';
import {
  Copy,
  Check,
  QrCode,
  Power,
  RefreshCw,
  Send,
  Trash2,
  AlertTriangle,
  ShieldAlert,
  RotateCcw,
  Activity,
  Server,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Switch } from '@/shared/components/ui/Switch.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { useUserConfigUsage } from '../hooks/useUserPortalData.js';
import type { CustomVolumeSettings, UserConfigRecord } from '@/shared/types/userPortal.js';
import {
  ServiceStatusDot,
  ServiceStatusBadge,
  ServiceAutoRenewBadge,
  ServiceTrafficBar,
  ServiceExpiryView,
  formatServiceCreatedDate,
} from './ServiceStatusTraffic.js';
import { AutoRenewModal } from './AutoRenewModal.js';
import { SmartConnectButtons } from './SmartConnectButtons.js';
import { ConfigTransferModal } from './ConfigTransferModal.js';
import { ConfigDeleteRefundModal } from './ConfigDeleteRefundModal.js';

interface ServiceManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: UserConfigRecord | null;
  botUsername?: string;
  currency?: string;
  customVolumeSettings?: CustomVolumeSettings;
  onOpenQr: (subUrl: string, configUsername: string) => void;
  onRenewConfig?: (config: UserConfigRecord) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const ServiceManagementModal: React.FC<ServiceManagementModalProps> = ({
  isOpen,
  onClose,
  config,
  currency: propCurrency,
  customVolumeSettings,
  onOpenQr,
  onRenewConfig,
  onNotify,
}) => {
  const { t, locale } = useLanguage();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();
  const { formatToman, formatIsoDate, formatBytes } = useFormatters();
  const queryClient = useQueryClient();

  const currency = propCurrency || t('common.currency');

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTogglingAutoRenew, setIsTogglingAutoRenew] = useState(false);
  const [autoRenewOptimistic, setAutoRenewOptimistic] = useState(false);
  const [isAutoRenewModalOpen, setIsAutoRenewModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  // Sub-confirmation modal state: 'disable' | 'enable' | 'revoke' | null
  const [confirmAction, setConfirmAction] = useState<'disable' | 'enable' | 'revoke' | null>(null);

  const { data: usageData } = useUserConfigUsage(config?.id ?? null, isOpen);

  useEffect(() => {
    if (config) {
      setAutoRenewOptimistic(Boolean(config.autoRenewEnabled));
    }
  }, [config]);

  useEffect(() => {
    if (!isOpen || !config) {
      setConfirmAction(null);
      setIsAutoRenewModalOpen(false);
      setIsTransferModalOpen(false);
      setIsDeleteModalOpen(false);
    }
  }, [isOpen, config]);

  if (!isOpen || !config) return null;

  const isSubCopied = isCopied(`modal-sub-${config.id}`);
  const isDisabled = config.panelStatus === 'disabled';
  const hasSubModalOpen =
    confirmAction !== null || isAutoRenewModalOpen || isTransferModalOpen || isDeleteModalOpen;

  const invalidateConfigQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
    await queryClient.invalidateQueries({ queryKey: queryKeys.user.configUsage(config.id) });
  };

  const handleCopySub = async () => {
    if (!config.subUrl) return;
    triggerHaptic('light');
    const ok = await copy(config.subUrl, `modal-sub-${config.id}`);
    if (ok) {
      onNotify(t('user.services.linkCopied'), 'success');
    }
  };

  const handleOpenQr = () => {
    if (!config.subUrl) return;
    triggerHaptic('selection');
    onOpenQr(config.subUrl, config.configUsername);
  };

  const handleRefreshStats = async () => {
    if (isRefreshing) return;
    triggerHaptic('light');
    setIsRefreshing(true);
    try {
      await api.refreshConfigStats(config.id);
      await invalidateConfigQueries();
      triggerHaptic('success');
      onNotify(t('user.services.refreshSuccess'), 'success');
    } catch (err) {
      triggerHaptic('error');
      const msg =
        err instanceof ApiClientError && err.code === 'PANEL_DOWN'
          ? t('user.services.panelDownError')
          : t('user.services.refreshFailed');
      onNotify(msg, 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleToggleAutoRenew = async (nextValue: boolean) => {
    if (isTogglingAutoRenew) return;
    if (nextValue) {
      triggerHaptic('selection');
      setIsAutoRenewModalOpen(true);
      return;
    }

    setAutoRenewOptimistic(false);
    setIsTogglingAutoRenew(true);
    try {
      await api.toggleAutoRenew(config.id, false);
      await invalidateConfigQueries();
      triggerHaptic('success');
      onNotify(t('user.services.autoRenewOff'), 'success');
    } catch {
      setAutoRenewOptimistic(true);
      triggerHaptic('error');
      onNotify(t('common.error'), 'error');
    } finally {
      setIsTogglingAutoRenew(false);
    }
  };

  const handleExecuteStatusToggle = async () => {
    setIsTogglingStatus(true);
    triggerHaptic('selection');
    try {
      const targetStatus = isDisabled ? 'active' : 'disabled';
      await api.toggleConfigStatus(config.id, targetStatus);
      await invalidateConfigQueries();
      triggerHaptic('success');
      onNotify(
        isDisabled ? t('user.services.enableSuccess') : t('user.services.disableSuccess'),
        'success'
      );
      setConfirmAction(null);
    } catch (err) {
      triggerHaptic('error');
      const msg =
        err instanceof ApiClientError && err.code === 'PANEL_DOWN'
          ? t('user.services.panelDownError')
          : t('common.error');
      onNotify(msg, 'error');
    } finally {
      setIsTogglingStatus(false);
    }
  };

  const handleExecuteRevoke = async () => {
    setIsRevoking(true);
    triggerHaptic('selection');
    try {
      await api.revokeConfigLink(config.id);
      await invalidateConfigQueries();
      triggerHaptic('success');
      onNotify(t('user.services.revokeSuccess'), 'success');
      setConfirmAction(null);
    } catch (err) {
      triggerHaptic('error');
      const msg =
        err instanceof ApiClientError && err.code === 'PANEL_DOWN'
          ? t('user.services.panelDownError')
          : t('common.error');
      onNotify(msg, 'error');
    } finally {
      setIsRevoking(false);
    }
  };

  const handleRenewAction = () => {
    triggerHaptic('medium');
    onClose();
    onRenewConfig?.(config);
  };

  const autoRenewPlanDisplay = config.autoRenewPackageName || config.autoRenewPackageId || '';
  const totalNodeBytes =
    usageData?.nodes.reduce((sum, item) => sum + Math.max(0, item.usedTraffic), 0) ?? 0;

  return (
    <>
      <Modal
        isOpen={isOpen && !hasSubModalOpen}
        onClose={onClose}
        maxWidth="lg"
        title={
          <div className="flex items-center gap-2 min-w-0">
            <ServiceStatusDot status={config.panelStatus} />
            <bdi dir="ltr" className="font-mono text-sm sm:text-base font-semibold truncate">
              {config.configUsername}
            </bdi>
          </div>
        }
        subtitle={
          config.panelName
            ? `${t('user.services.manageTitle')} · ${config.panelName}`
            : t('user.services.manageTitle')
        }
      >
        <div className="flex flex-col gap-4 text-start">
          {/* Status & Timing Overview */}
          <div className="p-3.5 rounded-tile border flex flex-col gap-2.5 bg-surface-2 border-line">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-soft">
                {t('user.services.trafficUsed')}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <ServiceAutoRenewBadge enabled={autoRenewOptimistic} />
                <ServiceStatusBadge status={config.panelStatus} />
              </div>
            </div>

            <ServiceTrafficBar
              dataLimit={config.panelDataLimit}
              usedTraffic={config.panelUsedTraffic}
              hideLabel
            />

            <div className="flex items-center justify-between text-[11px] text-ink-muted pt-2 border-t border-line gap-2 flex-wrap">
              <ServiceExpiryView
                expireTimestampSec={config.panelExpire}
                panelStatus={config.panelStatus}
                onHoldExpireDurationSec={config.panelOnHoldExpireDuration}
              />
              <span className="text-[11px] text-ink-muted tnum">
                {formatServiceCreatedDate(config.createdAt, locale, t)}
              </span>
            </div>

            {config.lastSyncedAt && (
              <div className="text-[10px] text-ink-muted tnum">
                {t('user.services.lastSyncedLabel').replace(
                  '{time}',
                  formatIsoDate(config.lastSyncedAt)
                )}
              </div>
            )}
          </div>

          {/* Live Online Status & Per-Node Breakdown */}
          {usageData && (
            <div className="p-3 rounded-tile border border-line bg-surface-2 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-ink-soft inline-flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-brand-fg shrink-0" />
                  <span>{t('user.services.usageBreakdownTitle')}</span>
                </span>
                <span className="text-[11px] text-ink-muted tnum">
                  {t('user.services.lastOnlineLabel')}{' '}
                  <strong className="text-ink font-medium">
                    {usageData.onlineAt
                      ? formatIsoDate(usageData.onlineAt)
                      : t('user.services.neverConnected')}
                  </strong>
                </span>
              </div>

              {usageData.nodes.length > 0 ? (
                <div className="flex flex-col gap-1.5 pt-1 border-t border-line">
                  {usageData.nodes.slice(0, 6).map((node, idx) => {
                    const pct =
                      totalNodeBytes > 0
                        ? Math.max(4, Math.round((node.usedTraffic / totalNodeBytes) * 100))
                        : 0;
                    return (
                      <div key={`${node.nodeId ?? idx}`} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[11px] gap-2">
                          <span className="inline-flex items-center gap-1.5 text-ink-soft truncate">
                            <Server className="w-3 h-3 opacity-60 shrink-0" />
                            <span className="truncate">{node.nodeName}</span>
                          </span>
                          <bdi dir="ltr" className="font-mono text-ink tnum shrink-0">
                            {formatBytes(node.usedTraffic)}
                          </bdi>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-brand"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span className="text-[11px] text-ink-muted">{t('user.services.noNodeUsage')}</span>
              )}
            </div>
          )}

          {/* Quick Actions: Native Renew, Copy Link, QR, Refresh Status, Smart Connect */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold px-0.5 m-0 text-ink-soft">
              {t('user.services.quickActionsTitle')}
            </h4>

            {onRenewConfig && (
              <Button type="button" size="md" variant="primary" onClick={handleRenewAction} block>
                <RefreshCw className="w-4 h-4 shrink-0" />
                <span>{t('user.services.renewService')}</span>
              </Button>
            )}

            {config.subUrl && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="md"
                  variant={isSubCopied ? 'success' : 'secondary'}
                  onClick={() => void handleCopySub()}
                  block
                >
                  {isSubCopied ? (
                    <>
                      <Check className="w-4 h-4 shrink-0" />
                      <span className="truncate">{t('user.services.linkCopied')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 shrink-0" />
                      <span className="truncate">{t('user.services.copyLink')}</span>
                    </>
                  )}
                </Button>

                <Button type="button" size="md" variant="tonal" onClick={handleOpenQr} block>
                  <QrCode className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t('user.services.showQr')}</span>
                </Button>
              </div>
            )}

            <Button
              type="button"
              size="md"
              variant="secondary"
              onClick={() => void handleRefreshStats()}
              disabled={isRefreshing}
              block
            >
              <RefreshCw
                className={`w-4 h-4 text-brand-fg shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              <span>
                {isRefreshing ? t('user.services.refreshing') : t('user.services.refresh')}
              </span>
            </Button>

            {config.subUrl && (
              <div className="pt-2">
                <SmartConnectButtons
                  subUrl={config.subUrl}
                  configUsername={config.configUsername}
                />
              </div>
            )}
          </div>

          {/* Service Controls: Auto-Renew Toggle, Status Toggle, Revoke Link */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold px-0.5 m-0 text-ink-soft">
              {t('user.services.controlsTitle')}
            </h4>

            {/* Auto-Renew Switch Card */}
            <div className="p-3.5 rounded-tile border flex flex-col gap-2 bg-surface-2 border-line">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-xs font-semibold text-ink">
                    {t('user.services.autoRenewToggle')}
                  </span>
                  <span className="text-[11px] leading-relaxed text-ink-muted">
                    {t('user.services.autoRenewHint')}
                  </span>
                </div>

                <Switch
                  checked={autoRenewOptimistic}
                  onChange={(checked) => void handleToggleAutoRenew(checked)}
                  disabled={isTogglingAutoRenew}
                  ariaLabel={t('user.services.autoRenewToggle')}
                />
              </div>

              {autoRenewOptimistic && autoRenewPlanDisplay && (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-line text-[11px]">
                  <span className="text-ink-soft truncate tnum">
                    {t('user.services.autoRenewPackageInfo')
                      .replace('{name}', autoRenewPlanDisplay)
                      .replace('{price}', formatToman(config.autoRenewPrice ?? 0))
                      .replace('{currency}', currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection');
                      setIsAutoRenewModalOpen(true);
                    }}
                    className="text-brand-fg font-semibold hover:underline shrink-0 cursor-pointer"
                  >
                    {t('user.services.autoRenewChangePlan')}
                  </button>
                </div>
              )}
            </div>

            {/* Disable / Enable Button */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('warning');
                setConfirmAction(isDisabled ? 'enable' : 'disable');
              }}
              className={`w-full min-h-11 py-2.5 px-3.5 rounded-tile font-medium text-xs flex items-center justify-between press rs-focus cursor-pointer border transition-colors ${
                isDisabled
                  ? 'bg-ok-soft hover:bg-ok/15 text-ok-fg border-ok/25'
                  : 'bg-warn-soft hover:bg-warn/15 text-warn-fg border-warn/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <Power className="w-4 h-4 shrink-0" />
                <span>
                  {isDisabled
                    ? t('user.services.enableService')
                    : t('user.services.disableService')}
                </span>
              </div>
              <span className="text-[11px] opacity-80">
                {isDisabled ? t('user.services.statusDisabled') : t('user.services.statusActive')}
              </span>
            </button>

            {/* Revoke / Reset Link Button */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('warning');
                setConfirmAction('revoke');
              }}
              className="w-full min-h-11 py-2.5 px-3.5 rounded-tile font-medium text-xs flex items-center justify-between press rs-focus cursor-pointer border transition-colors bg-danger-soft hover:bg-danger/15 text-danger-fg border-danger/25"
            >
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 shrink-0" />
                <span>{t('user.services.revokeLink')}</span>
              </div>
              <AlertTriangle className="w-3.5 h-3.5 opacity-75 shrink-0" />
            </button>
          </div>

          {/* Native Ownership & Deletion Actions */}
          <div className="flex flex-col gap-2 pt-3 border-t border-line">
            <h4 className="text-xs font-semibold px-0.5 m-0 text-ink-soft">
              {t('user.services.botActionsTitle')}
            </h4>

            {/* Native Transfer */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('selection');
                setIsTransferModalOpen(true);
              }}
              className="group w-full min-h-11 p-3 rounded-tile border flex items-center justify-between gap-2.5 press rs-focus cursor-pointer bg-surface-2 hover:bg-surface-3 text-ink border-line transition-all duration-200"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <IconTile tone="info" size="sm">
                  <Send />
                </IconTile>
                <div className="flex flex-col text-start min-w-0">
                  <span className="text-xs font-semibold">
                    {t('user.services.transferService')}
                  </span>
                  <span className="text-[11px] truncate text-ink-muted">
                    {t('user.services.transferHint')}
                  </span>
                </div>
              </div>
            </button>

            {/* Native Delete / Refund */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('warning');
                setIsDeleteModalOpen(true);
              }}
              className="group w-full min-h-11 p-3 rounded-tile border flex items-center justify-between gap-2.5 press rs-focus cursor-pointer bg-danger-soft hover:bg-danger/15 text-danger-fg border-danger/25 transition-all duration-200"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <IconTile tone="danger" size="sm">
                  <Trash2 />
                </IconTile>
                <div className="flex flex-col text-start min-w-0">
                  <span className="text-xs font-semibold">{t('user.services.deleteService')}</span>
                  <span className="text-[11px] truncate text-ink-muted">
                    {t('user.services.deleteHint')}
                  </span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </Modal>

      {/* Auto-Renew Package Selection Modal */}
      <AutoRenewModal
        isOpen={isAutoRenewModalOpen}
        onClose={() => setIsAutoRenewModalOpen(false)}
        config={config}
        currency={currency}
        customVolumeSettings={customVolumeSettings}
        onEnabled={() => setAutoRenewOptimistic(true)}
        onNotify={onNotify}
      />

      {/* Native Service Ownership Transfer Modal */}
      <ConfigTransferModal
        isOpen={isTransferModalOpen}
        config={config}
        onClose={() => setIsTransferModalOpen(false)}
        onTransferred={() => {
          setIsTransferModalOpen(false);
          onClose();
        }}
        onNotify={onNotify}
      />

      {/* Native Delete & Refund Modal */}
      <ConfigDeleteRefundModal
        isOpen={isDeleteModalOpen}
        config={config}
        currency={currency}
        onClose={() => setIsDeleteModalOpen(false)}
        onDeleted={() => {
          setIsDeleteModalOpen(false);
          onClose();
        }}
        onNotify={onNotify}
      />

      {/* Sub-modal: Confirm Enable/Disable */}
      <Modal
        isOpen={confirmAction === 'disable' || confirmAction === 'enable'}
        onClose={() => setConfirmAction(null)}
        maxWidth="sm"
        title={
          confirmAction === 'enable'
            ? t('user.services.enableServiceTitle')
            : t('user.services.disableServiceTitle')
        }
        icon={
          <IconTile tone={confirmAction === 'enable' ? 'ok' : 'warn'} size="sm">
            <Power />
          </IconTile>
        }
        footer={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirmAction(null)}
              disabled={isTogglingStatus}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant={confirmAction === 'enable' ? 'primary' : 'danger'}
              className="flex-1"
              onClick={() => void handleExecuteStatusToggle()}
              loading={isTogglingStatus}
              disabled={isTogglingStatus}
            >
              {t('common.confirm')}
            </Button>
          </div>
        }
      >
        <p className="text-xs leading-relaxed text-ink-soft m-0 text-start">
          {confirmAction === 'enable'
            ? t('user.services.enableServiceDesc')
            : t('user.services.disableServiceDesc')}
        </p>
      </Modal>

      {/* Sub-modal: Confirm Revoke Link */}
      <Modal
        isOpen={confirmAction === 'revoke'}
        onClose={() => setConfirmAction(null)}
        maxWidth="sm"
        title={t('user.services.revokeTitle')}
        icon={
          <IconTile tone="danger" size="sm">
            <ShieldAlert />
          </IconTile>
        }
        footer={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirmAction(null)}
              disabled={isRevoking}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              onClick={() => void handleExecuteRevoke()}
              loading={isRevoking}
              disabled={isRevoking}
            >
              {t('user.services.revokeConfirm')}
            </Button>
          </div>
        }
      >
        <p className="text-xs leading-relaxed text-ink-soft m-0 text-start">
          {t('user.services.revokeWarning')}
        </p>
      </Modal>
    </>
  );
};
