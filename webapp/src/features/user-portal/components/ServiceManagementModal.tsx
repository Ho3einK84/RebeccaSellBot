import React, { useState, useEffect } from 'react';
import {
  RotateCw,
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
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
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
  const { isDark, textPrimary, textSecondary } = useThemeTokens();
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

  if (!isOpen || !config) return null;

  const isSubCopied = isCopied(`modal-sub-${config.id}`);
  const isDisabled = config.panelStatus === 'disabled';

  const invalidateConfigQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.user.configs }),
      queryClient.invalidateQueries({ queryKey: ['user-configs'] }),
    ]);
  };

  const handleCopySub = () => {
    if (!config.subUrl) return;
    triggerHaptic('light');
    copy(config.subUrl, `modal-sub-${config.id}`);
    onNotify(t('user.services.linkCopied'), 'success');
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

  const handleToggleAutoRenew = async () => {
    if (isTogglingAutoRenew) return;
    const nextValue = !autoRenewOptimistic;
    triggerHaptic('selection');
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
    const cleanBot = (botUsername || '').replace(/^@/, '');
    const url = cleanBot
      ? `https://t.me/${cleanBot}?start=${action}_${config.id}`
      : `https://t.me?start=${action}_${config.id}`;
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen && confirmAction === null}
        onClose={onClose}
        maxWidth="lg"
        title={
          <div className="flex items-center gap-2">
            <ServiceStatusDot status={config.panelStatus} />
            <span className="font-mono text-sm sm:text-base font-bold truncate">
              {config.configUsername}
            </span>
          </div>
        }
      >
        <div className="flex flex-col gap-4 text-start">
          {/* Status & Timing Overview */}
          <div
            className={`p-3.5 rounded-2xl border flex flex-col gap-2.5 ${
              isDark ? 'bg-white/[0.02] border-white/10' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs font-semibold ${textSecondary}`}>
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
            />

            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400 pt-1 border-t border-slate-200/60 dark:border-white/[0.05] gap-2 flex-wrap">
              <ServiceExpiryView expireTimestampSec={config.panelExpire} />
              <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">
                {formatServiceCreatedDate(config.createdAt, locale, t)}
              </span>
            </div>
          </div>

          {/* Quick Actions: Copy Link, QR, Refresh Status */}
          <div className="flex flex-col gap-2">
            <h4 className={`text-xs font-bold uppercase tracking-wider px-1 ${textSecondary}`}>
              {t('user.services.quickActionsTitle')}
            </h4>

            <div className="grid grid-cols-2 gap-2">
              {config.subUrl && (
                <>
                  <button
                    type="button"
                    onClick={handleCopySub}
                    className={`min-h-[44px] py-2 px-3 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer border ${
                      isSubCopied
                        ? 'bg-emerald-600 text-white border-emerald-500'
                        : isDark
                          ? 'bg-white/[0.06] hover:bg-white/10 text-white border-white/10'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-200'
                    }`}
                  >
                    {isSubCopied ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>{t('user.services.linkCopied')}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>{t('user.services.copyLink')}</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenQr}
                    className={`min-h-[44px] py-2 px-3 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer border ${
                      isDark
                        ? 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/30'
                        : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                    }`}
                  >
                    <QrCode className="w-4 h-4" />
                    <span>{t('user.services.showQr')}</span>
                  </button>
                </>
              )}
            </div>

            {/* Refresh Live Status Button */}
            <button
              type="button"
              onClick={handleRefreshStats}
              disabled={isRefreshing}
              className={`w-full min-h-[44px] py-2.5 px-3 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer border ${
                isDark
                  ? 'bg-white/[0.04] hover:bg-white/[0.08] text-white border-white/10'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-2xs'
              } disabled:opacity-50`}
            >
              <RotateCw
                className={`w-4 h-4 text-indigo-400 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              <span>
                {isRefreshing ? t('user.services.refreshing') : t('user.services.refresh')}
              </span>
            </button>
          </div>

          {/* Service Controls: Auto-Renew Toggle, Status Toggle, Revoke Link */}
          <div className="flex flex-col gap-2">
            <h4 className={`text-xs font-bold uppercase tracking-wider px-1 ${textSecondary}`}>
              {t('user.services.controlsTitle')}
            </h4>

            {/* Auto-Renew Switch Card */}
            <div
              className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                isDark ? 'bg-white/[0.02] border-white/10' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className={`text-xs font-bold ${textPrimary}`}>
                  {t('user.services.autoRenewToggle')}
                </span>
                <span className={`text-[11px] leading-tight ${textSecondary}`}>
                  {t('user.services.autoRenewHint')}
                </span>
              </div>

              <button
                type="button"
                onClick={handleToggleAutoRenew}
                disabled={isTogglingAutoRenew}
                aria-label={t('user.services.autoRenewToggle')}
                className={`w-12 h-7 min-h-[28px] p-0.5 rounded-full transition-colors duration-200 ease-in-out relative shrink-0 cursor-pointer ${
                  autoRenewOptimistic ? 'bg-emerald-500' : isDark ? 'bg-white/20' : 'bg-slate-300'
                } disabled:opacity-50`}
              >
                <div
                  className={`w-6 h-6 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                    autoRenewOptimistic ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Disable / Enable Button */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('warning');
                setConfirmAction(isDisabled ? 'enable' : 'disable');
              }}
              className={`w-full min-h-[44px] py-2.5 px-3 rounded-xl font-medium text-xs flex items-center justify-between transition-all active:scale-95 cursor-pointer border ${
                isDisabled
                  ? isDark
                    ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                  : isDark
                    ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Power className="w-4 h-4" />
                <span>
                  {isDisabled
                    ? t('user.services.enableService')
                    : t('user.services.disableService')}
                </span>
              </div>
              <span className="text-[11px] opacity-75">
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
              className={`w-full min-h-[44px] py-2.5 px-3 rounded-xl font-medium text-xs flex items-center justify-between transition-all active:scale-95 cursor-pointer border ${
                isDark
                  ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/30'
                  : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                <span>{t('user.services.revokeLink')}</span>
              </div>
              <AlertTriangle className="w-3.5 h-3.5 opacity-70" />
            </button>
          </div>

          {/* Bot Hand-off Actions */}
          <div className="flex flex-col gap-2 pt-1 border-t border-slate-200/60 dark:border-white/[0.06]">
            <h4 className={`text-xs font-bold uppercase tracking-wider px-1 ${textSecondary}`}>
              {t('user.services.botActionsTitle')}
            </h4>

            {/* Renew in Bot */}
            <button
              type="button"
              onClick={() => handleOpenBotAction('renew')}
              className={`w-full min-h-[44px] p-3 rounded-xl border flex items-center justify-between transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-indigo-600/10 hover:bg-indigo-600/20 text-white border-indigo-500/25'
                  : 'bg-indigo-50/70 hover:bg-indigo-100/70 text-slate-900 border-indigo-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                  <RotateCw className="w-4 h-4" />
                </div>
                <div className="flex flex-col text-start min-w-0">
                  <span className="text-xs font-bold">{t('user.services.renewService')}</span>
                  <span className={`text-[11px] truncate ${textSecondary}`}>
                    {t('user.services.renewHint')}
                  </span>
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            </button>

            {/* Transfer in Bot */}
            <button
              type="button"
              onClick={() => handleOpenBotAction('transfer')}
              className={`w-full min-h-[44px] p-3 rounded-xl border flex items-center justify-between transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-white/[0.02] hover:bg-white/[0.06] text-white border-white/10'
                  : 'bg-white hover:bg-slate-50 text-slate-900 border-slate-200 shadow-2xs'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                  <Send className="w-4 h-4" />
                </div>
                <div className="flex flex-col text-start min-w-0">
                  <span className="text-xs font-bold">{t('user.services.transferService')}</span>
                  <span className={`text-[11px] truncate ${textSecondary}`}>
                    {t('user.services.transferHint')}
                  </span>
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {/* Delete / Refund in Bot */}
            <button
              type="button"
              onClick={() => handleOpenBotAction('delete')}
              className={`w-full min-h-[44px] p-3 rounded-xl border flex items-center justify-between transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-rose-500/5 hover:bg-rose-500/15 text-rose-300 border-rose-500/20'
                  : 'bg-rose-50/60 hover:bg-rose-100/60 text-rose-700 border-rose-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div className="flex flex-col text-start min-w-0">
                  <span className="text-xs font-bold">{t('user.services.deleteService')}</span>
                  <span className={`text-[11px] truncate ${textSecondary}`}>
                    {t('user.services.deleteHint')}
                  </span>
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-rose-400 shrink-0" />
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
        >
          <div className="flex flex-col gap-4 text-start">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                  confirmAction === 'revoke'
                    ? 'bg-rose-500/15 border-rose-500/25 text-rose-500'
                    : confirmAction === 'disable'
                      ? 'bg-amber-500/15 border-amber-500/25 text-amber-500'
                      : 'bg-emerald-500/15 border-emerald-500/25 text-emerald-500'
                }`}
              >
                {confirmAction === 'revoke' ? (
                  <ShieldAlert className="w-5 h-5" />
                ) : (
                  <Power className="w-5 h-5" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h3 className={`font-bold text-sm sm:text-base m-0 ${textPrimary}`}>
                  {confirmAction === 'revoke'
                    ? t('user.services.revokeTitle')
                    : confirmAction === 'disable'
                      ? t('user.services.disableServiceTitle')
                      : t('user.services.enableServiceTitle')}
                </h3>
                <p className={`text-xs mt-1 leading-relaxed ${textSecondary}`}>
                  {confirmAction === 'revoke'
                    ? t('user.services.revokeWarning')
                    : confirmAction === 'disable'
                      ? t('user.services.disableServiceDesc')
                      : t('user.services.enableServiceDesc')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                disabled={isTogglingStatus || isRevoking}
                className={`flex-1 min-h-[44px] py-2 px-3 rounded-xl font-medium text-xs flex items-center justify-center transition-all active:scale-95 cursor-pointer border ${
                  isDark
                    ? 'bg-white/5 hover:bg-white/10 text-white border-white/10'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                } disabled:opacity-50`}
              >
                {t('common.cancel')}
              </button>

              <button
                type="button"
                onClick={
                  confirmAction === 'revoke' ? handleExecuteRevoke : handleExecuteStatusToggle
                }
                disabled={isTogglingStatus || isRevoking}
                className={`flex-1 min-h-[44px] py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer text-white shadow-xs ${
                  confirmAction === 'revoke'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : confirmAction === 'disable'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                } disabled:opacity-50`}
              >
                {(isTogglingStatus || isRevoking) && (
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>
                  {confirmAction === 'revoke'
                    ? t('user.services.revokeConfirm')
                    : confirmAction === 'disable'
                      ? t('user.services.disableService')
                      : t('user.services.enableService')}
                </span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
