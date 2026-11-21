import React, { useState, useEffect } from 'react';
import {
  Copy,
  Check,
  QrCode,
  Power,
  RefreshCw,
  Send,
  Trash2,
  ExternalLink,
  AlertTriangle,
  ShieldAlert,
  RotateCcw,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Switch } from '@/shared/components/ui/Switch.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import {
  openTelegramLinkAndMinimize,
  minimizeOrCloseWebApp,
} from '@/shared/lib/telegramNavigation.js';
import type { UserConfigRecord } from '@/shared/types/userPortal.js';
import {
  ServiceStatusDot,
  ServiceStatusBadge,
  ServiceAutoRenewBadge,
  ServiceTrafficBar,
  ServiceExpiryView,
  formatServiceCreatedDate,
} from './ServiceStatusTraffic.js';

interface ServiceManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: UserConfigRecord | null;
  botUsername?: string;
  onOpenQr: (subUrl: string, configUsername: string) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const ServiceManagementModal: React.FC<ServiceManagementModalProps> = ({
  isOpen,
  onClose,
  config,
  botUsername,
  onOpenQr,
  onNotify,
}) => {
  const { t, locale } = useLanguage();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTogglingAutoRenew, setIsTogglingAutoRenew] = useState(false);
  const [autoRenewOptimistic, setAutoRenewOptimistic] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  // Sub-confirmation modal state: 'disable' | 'enable' | 'revoke' | null
  const [confirmAction, setConfirmAction] = useState<'disable' | 'enable' | 'revoke' | null>(null);

  useEffect(() => {
    if (config) {
      setAutoRenewOptimistic(Boolean(config.autoRenewEnabled));
    }
  }, [config]);

  useEffect(() => {
    if (!isOpen || !config) {
      setConfirmAction(null);
    }
  }, [isOpen, config]);

  if (!isOpen || !config) return null;

  const isSubCopied = isCopied(`modal-sub-${config.id}`);
  const isDisabled = config.panelStatus === 'disabled';

  const invalidateConfigQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
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
    setAutoRenewOptimistic(nextValue);
    setIsTogglingAutoRenew(true);
    try {
      await api.toggleAutoRenew(config.id, nextValue);
      await invalidateConfigQueries();
      triggerHaptic('success');
      onNotify(
        nextValue ? t('user.services.autoRenewOn') : t('user.services.autoRenewOff'),
        'success'
      );
    } catch {
      setAutoRenewOptimistic(!nextValue);
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

  const handleOpenBotAction = (action: 'renew' | 'transfer' | 'delete') => {
    triggerHaptic('selection');
    const cleanBot = (botUsername || '').replace(/^@/, '').trim();
    onClose();
    if (!cleanBot) {
      minimizeOrCloseWebApp();
      return;
    }
    const url = `https://t.me/${cleanBot}?start=${action}_${config.id}`;
    openTelegramLinkAndMinimize(url);
  };

  return (
    <>
      <Modal
        isOpen={isOpen && confirmAction === null}
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
        subtitle={t('user.services.manageTitle')}
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
              <ServiceExpiryView expireTimestampSec={config.panelExpire} />
              <span className="text-[11px] text-ink-muted tnum">
                {formatServiceCreatedDate(config.createdAt, locale, t)}
              </span>
            </div>
          </div>

          {/* Quick Actions: Copy Link, QR, Refresh Status */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold px-0.5 m-0 text-ink-soft">
              {t('user.services.quickActionsTitle')}
            </h4>

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
          </div>

          {/* Service Controls: Auto-Renew Toggle, Status Toggle, Revoke Link */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold px-0.5 m-0 text-ink-soft">
              {t('user.services.controlsTitle')}
            </h4>

            {/* Auto-Renew Switch Card */}
            <div className="p-3.5 rounded-tile border flex items-center justify-between gap-3 bg-surface-2 border-line">
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

          {/* Bot Hand-off Actions */}
          <div className="flex flex-col gap-2 pt-3 border-t border-line">
            <h4 className="text-xs font-semibold px-0.5 m-0 text-ink-soft">
              {t('user.services.botActionsTitle')}
            </h4>

            {/* Renew in Bot */}
            <button
              type="button"
              onClick={() => handleOpenBotAction('renew')}
              className="group w-full min-h-11 p-3 rounded-tile border flex items-center justify-between gap-2.5 press rs-focus cursor-pointer bg-brand-soft hover:bg-brand/15 text-ink border-brand/25 transition-all duration-200"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <IconTile tone="brand" size="sm">
                  <RefreshCw />
                </IconTile>
                <div className="flex flex-col text-start min-w-0">
                  <span className="text-xs font-semibold">{t('user.services.renewService')}</span>
                  <span className="text-[11px] truncate text-ink-muted">
                    {t('user.services.renewHint')}
                  </span>
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-brand-fg shrink-0" />
            </button>

            {/* Transfer in Bot */}
            <button
              type="button"
              onClick={() => handleOpenBotAction('transfer')}
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
              <ExternalLink className="w-3.5 h-3.5 text-ink-muted shrink-0" />
            </button>

            {/* Delete / Refund in Bot */}
            <button
              type="button"
              onClick={() => handleOpenBotAction('delete')}
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
              <ExternalLink className="w-3.5 h-3.5 text-danger-fg shrink-0" />
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirmation Sub-Modal for Disable / Enable / Revoke */}
      {confirmAction && (
        <Modal
          isOpen={true}
          onClose={() => setConfirmAction(null)}
          maxWidth="sm"
          closeOnBackdrop={!isTogglingStatus && !isRevoking}
          title={
            confirmAction === 'revoke'
              ? t('user.services.revokeTitle')
              : confirmAction === 'disable'
                ? t('user.services.disableServiceTitle')
                : t('user.services.enableServiceTitle')
          }
          icon={
            <IconTile
              tone={
                confirmAction === 'revoke' ? 'danger' : confirmAction === 'disable' ? 'warn' : 'ok'
              }
              size="sm"
            >
              {confirmAction === 'revoke' ? <ShieldAlert /> : <Power />}
            </IconTile>
          }
          footer={
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setConfirmAction(null)}
                disabled={isTogglingStatus || isRevoking}
              >
                {t('common.cancel')}
              </Button>

              <Button
                type="button"
                variant={confirmAction === 'enable' ? 'success' : 'danger'}
                className="flex-1"
                onClick={() =>
                  void (confirmAction === 'revoke'
                    ? handleExecuteRevoke()
                    : handleExecuteStatusToggle())
                }
                disabled={isTogglingStatus || isRevoking}
                loading={isTogglingStatus || isRevoking}
              >
                <span>
                  {confirmAction === 'revoke'
                    ? t('user.services.revokeConfirm')
                    : confirmAction === 'disable'
                      ? t('user.services.disableService')
                      : t('user.services.enableService')}
                </span>
              </Button>
            </div>
          }
        >
          <p className="text-xs leading-relaxed m-0 text-ink-soft">
            {confirmAction === 'revoke'
              ? t('user.services.revokeWarning')
              : confirmAction === 'disable'
                ? t('user.services.disableServiceDesc')
                : t('user.services.enableServiceDesc')}
          </p>
        </Modal>
      )}
    </>
  );
};
