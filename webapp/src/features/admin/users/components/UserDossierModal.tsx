import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Copy,
  Wallet,
  QrCode,
  Power,
  RotateCcw,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  Image as ImageIcon,
  Loader2,
  Send,
  History,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { ProgressBar } from '@/shared/components/ui/ProgressBar.js';
import { SegmentedControl, type SegmentedOption } from '@/shared/components/ui/SegmentedControl.js';
import { UserConfigQrModal } from './UserConfigQrModal.js';
import { UserConfirmModal } from './UserConfirmModal.js';
import { UserDirectMessageModal } from './UserDirectMessageModal.js';
import { ReceiptPhotoModal } from '@/features/admin/receipts/components/ReceiptPhotoModal.js';
import {
  getTransactionTypeLabel,
  formatTransactionDescription,
} from '@/shared/lib/transactionFormatters.js';
import type { UserDossierResponse } from '@/shared/types/api.js';
import type { UserProfile, UserConfigItem } from '@/shared/types/admin.js';

type DossierTabId = 'finances' | 'configs' | 'orders' | 'receipts' | 'transactions' | 'audit';

interface UserDossierModalProps {
  dossier: UserDossierResponse | null;
  onClose: () => void;
  onOpenBalanceModal: (user: UserProfile) => void;
  onCopyId: (id: string, key: string) => void;
  isCopied?: (key: string) => boolean;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
  onBanUser?: (telegramId: number, isBanned: boolean, reason?: string) => Promise<void>;
  onSendMessage?: (telegramId: number, message: string) => Promise<void>;
  onToggleConfig?: (telegramId: number, configUsername: string, panelId?: string) => Promise<void>;
  onResetConfigUsage?: (
    telegramId: number,
    configUsername: string,
    panelId?: string
  ) => Promise<void>;
  onRevokeConfigSubUrl?: (
    telegramId: number,
    configUsername: string,
    panelId?: string
  ) => Promise<void>;
  onSyncConfig?: (telegramId: number, configUsername: string, panelId?: string) => Promise<void>;
}

export const UserDossierModal: React.FC<UserDossierModalProps> = ({
  dossier,
  onClose,
  onOpenBalanceModal,
  onCopyId,
  isCopied = () => false,
  onNotify,
  onBanUser,
  onSendMessage,
  onToggleConfig,
  onResetConfigUsage,
  onRevokeConfigSubUrl,
  onSyncConfig,
}) => {
  const { t, locale } = useLanguage();
  const {
    formatMoney,
    formatNumber,
    formatId,
    formatIsoDate,
    formatBytes,
    formatReceiptShortId,
    sanitizeDisplayName,
  } = useFormatters();

  const [activeTab, setActiveTab] = useState<DossierTabId>('finances');

  // Sub-modals state
  const [qrModalConfig, setQrModalConfig] = useState<UserConfigItem | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    type: 'ban' | 'unban' | 'reset-usage' | 'revoke';
    config?: UserConfigItem;
  } | null>(null);
  const [isDmModalOpen, setIsDmModalOpen] = useState(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [photoTarget, setPhotoTarget] = useState<{ id: string; mediaType?: string } | null>(null);

  const notifyAction = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      onNotify?.(message, type);
    },
    [onNotify]
  );

  const handlePhotoError = useCallback(() => {
    onNotify?.(t('admin.receipts.noPhoto'), 'error');
  }, [onNotify, t]);

  // Reset to first tab whenever a different user dossier is opened
  useEffect(() => {
    setActiveTab('finances');
    setQrModalConfig(null);
    setConfirmModal(null);
    setIsDmModalOpen(false);
    setActionLoading(null);
    setPhotoTarget(null);
  }, [dossier?.summary?.user?.telegramId]);

  const ordersCount = dossier?.orders?.length ?? 0;
  const receiptsCount = dossier?.receipts?.length ?? 0;
  const configsCount = dossier?.configs?.length ?? 0;
  const transactionsCount = dossier?.transactions?.length ?? 0;
  const auditLogsCount = dossier?.auditLogs?.length ?? dossier?.summary?.auditEventsCount ?? 0;

  const tabOptions: SegmentedOption<DossierTabId>[] = useMemo(
    () => [
      { id: 'finances', label: t('admin.users.tabFinances') },
      { id: 'configs', label: t('admin.users.tabConfigs'), count: formatNumber(configsCount) },
      {
        id: 'transactions',
        label: t('admin.users.tabTransactions'),
        count: formatNumber(transactionsCount),
      },
      { id: 'orders', label: t('admin.users.tabOrders'), count: formatNumber(ordersCount) },
      { id: 'receipts', label: t('admin.users.tabReceipts'), count: formatNumber(receiptsCount) },
      { id: 'audit', label: t('admin.users.tabAudit'), count: formatNumber(auditLogsCount) },
    ],
    [t, formatNumber, configsCount, transactionsCount, ordersCount, receiptsCount, auditLogsCount]
  );

  if (!dossier) return null;

  const {
    summary,
    orders = [],
    receipts = [],
    configs = [],
    transactions = [],
    auditLogs = [],
  } = dossier;
  const user = summary.user;
  const isTargetAdmin = Boolean(dossier.isAdmin || user.isAdmin);
  const { displayName } = sanitizeDisplayName(
    user.firstName,
    user.lastName,
    user.username ? `@${user.username}` : t('user.guestUser')
  );

  const handleSendDirectMessage = async (message: string) => {
    if (!onSendMessage) return;
    setActionLoading('dm');
    try {
      await onSendMessage(user.telegramId, message);
      notifyAction(t('admin.users.dmSuccess'), 'success');
      setIsDmModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.users.dmFailed');
      notifyAction(msg, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // Action handlers
  const handleConfirmAction = async (reason?: string) => {
    if (!confirmModal) return;
    const { type, config } = confirmModal;
    setActionLoading(type);
    try {
      if (type === 'ban' && onBanUser) {
        await onBanUser(user.telegramId, true, reason);
        notifyAction(t('admin.users.banSuccess'), 'success');
      } else if (type === 'unban' && onBanUser) {
        await onBanUser(user.telegramId, false, reason);
        notifyAction(t('admin.users.unbanSuccess'), 'success');
      } else if (type === 'reset-usage' && config && onResetConfigUsage) {
        await onResetConfigUsage(user.telegramId, config.configUsername, config.panelId);
        notifyAction(t('admin.users.resetUsageSuccess'), 'success');
      } else if (type === 'revoke' && config && onRevokeConfigSubUrl) {
        await onRevokeConfigSubUrl(user.telegramId, config.configUsername, config.panelId);
        notifyAction(t('admin.users.revokeSuccess'), 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.users.actionFailed');
      notifyAction(msg, 'error');
    } finally {
      setActionLoading(null);
      setConfirmModal(null);
    }
  };

  const handleToggle = async (cfg: UserConfigItem) => {
    if (!onToggleConfig) return;
    setActionLoading(`toggle-${cfg.id}`);
    try {
      await onToggleConfig(user.telegramId, cfg.configUsername, cfg.panelId);
      const isCurrentlyActive = cfg.panelStatus === 'active';
      notifyAction(
        isCurrentlyActive
          ? t('admin.users.toggleSuccessDisabled')
          : t('admin.users.toggleSuccessActive'),
        'success'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.users.actionFailed');
      notifyAction(msg, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSync = async (cfg: UserConfigItem) => {
    if (!onSyncConfig) return;
    setActionLoading(`sync-${cfg.id}`);
    try {
      await onSyncConfig(user.telegramId, cfg.configUsername, cfg.panelId);
      notifyAction(t('admin.users.syncSuccess'), 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.users.actionFailed');
      notifyAction(msg, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const dossierHeader = (
    <div className="flex items-center gap-3 min-w-0">
      <Avatar
        name={user.firstName}
        username={user.username}
        size="md"
        className="shrink-0 ring-1 ring-line"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm sm:text-base font-semibold m-0 truncate text-ink">
            {displayName}
          </h3>
          {user.isBanned ? (
            <Badge variant="error" dot size="xs">
              {t('admin.users.bannedBadge')}
            </Badge>
          ) : (
            <Badge variant="success" dot size="xs">
              {t('admin.users.activeBadge')}
            </Badge>
          )}
          {isTargetAdmin && (
            <Badge variant="info" size="xs">
              {t('admin.users.adminBadge')}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs mt-1 flex-wrap">
          <span className="text-brand-fg tnum">
            {user.username ? (
              <bdi dir="ltr" className="font-medium">
                @{user.username}
              </bdi>
            ) : (
              <span className="text-ink-muted">{t('admin.users.noUsername')}</span>
            )}
          </span>
          <span className="text-ink-muted">·</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 tnum text-[11px] px-2 h-6 rounded-md border press rs-focus cursor-pointer bg-surface-2 border-line hover:border-line-strong text-ink-soft hover:text-ink"
            onClick={() => onCopyId(String(user.telegramId), 'dossier-id')}
            title={t('common.copy')}
          >
            <bdi dir="ltr" className="tnum font-medium">
              #{formatId(user.telegramId)}
            </bdi>
            {isCopied('dossier-id') ? (
              <Check className="w-3 h-3 text-ok-fg shrink-0" />
            ) : (
              <Copy className="w-3 h-3 opacity-60 shrink-0" />
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const dossierFooter = (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => onOpenBalanceModal(user)}
          className="flex-1 sm:flex-initial"
        >
          <Wallet className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{t('admin.users.btnChangeBalance')}</span>
        </Button>

        {onSendMessage && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setIsDmModalOpen(true)}
            className="flex-1 sm:flex-initial"
          >
            <Send className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t('admin.users.btnSendMessage')}</span>
          </Button>
        )}

        {onBanUser && (!isTargetAdmin || user.isBanned) && (
          <Button
            type="button"
            variant={user.isBanned ? 'success' : 'danger'}
            size="sm"
            onClick={() =>
              setConfirmModal({
                type: user.isBanned ? 'unban' : 'ban',
              })
            }
            className="flex-1 sm:flex-initial"
          >
            {user.isBanned ? (
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">
              {user.isBanned ? t('admin.users.btnUnban') : t('admin.users.btnBan')}
            </span>
          </Button>
        )}
      </div>

      <Button type="button" variant="secondary" size="sm" onClick={onClose} className="shrink-0">
        {t('admin.users.btnCloseReport')}
      </Button>
    </div>
  );

  return (
    <>
      <Modal
        isOpen={Boolean(dossier)}
        onClose={onClose}
        maxWidth="2xl"
        customHeader={dossierHeader}
        footer={dossierFooter}
      >
        <div className="space-y-4">
          {/* Unified Segmented Dossier Tabs */}
          <SegmentedControl
            options={tabOptions}
            value={activeTab}
            onChange={setActiveTab}
            fullWidth={false}
          />

          {/* Sub-tab 1: Finances Grid */}
          {activeTab === 'finances' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div className="p-3.5 rounded-tile border border-line bg-surface-2">
                <span className="text-[11px] font-medium block text-ink-muted">
                  {t('admin.users.userCurBalance')}
                </span>
                <div className="mt-1.5 flex items-baseline gap-1 flex-wrap">
                  <bdi dir="ltr" className="text-base sm:text-lg font-bold tnum text-ok-fg">
                    {formatMoney(user.balance)}
                  </bdi>
                  <span className="text-[11px] font-normal text-ink-muted">
                    {t('common.currency')}
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-tile border border-line bg-surface-2">
                <span className="text-[11px] font-medium block text-ink-muted">
                  {t('admin.users.userTotalDeposit')}
                </span>
                <div className="mt-1.5 flex items-baseline gap-1 flex-wrap">
                  <bdi dir="ltr" className="text-base sm:text-lg font-bold tnum text-ink">
                    {formatMoney(summary.totalDeposit)}
                  </bdi>
                  <span className="text-[11px] font-normal text-ink-muted">
                    {t('common.currency')}
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-tile border border-line bg-surface-2">
                <span className="text-[11px] font-medium block text-ink-muted">
                  {t('admin.users.userTotalSpend')}
                </span>
                <div className="mt-1.5 flex items-baseline gap-1 flex-wrap">
                  <bdi dir="ltr" className="text-base sm:text-lg font-bold tnum text-ink">
                    {formatMoney(summary.totalSpend)}
                  </bdi>
                  <span className="text-[11px] font-normal text-ink-muted">
                    {t('common.currency')}
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-tile border border-line bg-surface-2">
                <span className="text-[11px] font-medium block text-ink-muted">
                  {t('admin.users.userActiveConfigs')}
                </span>
                <div className="text-base sm:text-lg font-bold text-brand-fg tnum mt-1.5">
                  {formatNumber(summary.activeConfigsCount)}
                </div>
              </div>

              <div className="p-3.5 rounded-tile border border-line bg-surface-2">
                <span className="text-[11px] font-medium block text-ink-muted">
                  {t('admin.users.userApprovedReceipts')}
                </span>
                <div className="text-base sm:text-lg font-bold tnum mt-1.5 text-ok-fg">
                  {formatNumber(summary.receiptsApprovedCount)}
                </div>
              </div>

              <div className="p-3.5 rounded-tile border border-line bg-surface-2">
                <span className="text-[11px] font-medium block text-ink-muted">
                  {t('admin.users.userAuditEvents')}
                </span>
                <div className="text-base sm:text-lg font-bold tnum mt-1.5 text-ink-soft">
                  {formatNumber(summary.auditEventsCount)}
                </div>
              </div>

              {(user.reservedBalance ?? 0) > 0 && (
                <div className="p-3.5 rounded-tile border border-warn/25 bg-warn-soft">
                  <span className="text-[11px] font-medium block text-warn-fg">
                    {t('admin.users.userReservedBalance')}
                  </span>
                  <div className="mt-1.5 flex items-baseline gap-1 flex-wrap">
                    <bdi dir="ltr" className="text-base sm:text-lg font-bold tnum text-warn-fg">
                      {formatMoney(user.reservedBalance ?? 0)}
                    </bdi>
                    <span className="text-[11px] font-normal text-warn-fg/80">
                      {t('common.currency')}
                    </span>
                  </div>
                </div>
              )}

              {user.hasUsedTrial !== undefined && (
                <div className="p-3.5 rounded-tile border border-line bg-surface-2">
                  <span className="text-[11px] font-medium block text-ink-muted">
                    {t('admin.users.userTrialStatus')}
                  </span>
                  <div className="text-sm font-semibold mt-1.5 text-ink">
                    {user.hasUsedTrial
                      ? t('admin.users.userTrialUsed')
                      : t('admin.users.userTrialUnused')}
                  </div>
                </div>
              )}

              {(user.referredUserCount !== undefined || summary.totalReferralBonus > 0) && (
                <div className="p-3.5 rounded-tile border border-line bg-surface-2">
                  <span className="text-[11px] font-medium block text-ink-muted">
                    {t('admin.users.userReferralSummary')}
                  </span>
                  <div className="text-xs font-semibold mt-1.5 text-ink tnum">
                    {t('admin.users.userReferralCount', {
                      count: formatNumber(user.referredUserCount ?? 0),
                      bonus: formatMoney(summary.totalReferralBonus),
                      currency: t('common.currency'),
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sub-tab 2: Configs & Subscriptions */}
          {activeTab === 'configs' && (
            <div className="space-y-3">
              {configs.length === 0 ? (
                <p className="text-xs text-center py-8 m-0 text-ink-muted">
                  {t('admin.users.noConfigs')}
                </p>
              ) : (
                configs.map((cfg) => {
                  const usedTraffic = cfg.panelUsedTraffic || 0;
                  const dataLimit = cfg.panelDataLimit || 0;
                  const progressPct =
                    dataLimit > 0
                      ? Math.min(100, Math.round((usedTraffic / dataLimit) * 100))
                      : null;

                  const nowSeconds = Math.floor(Date.now() / 1000);
                  const isExpired = cfg.panelExpire ? cfg.panelExpire <= nowSeconds : false;
                  const daysLeft = cfg.panelExpire
                    ? Math.max(0, Math.ceil((cfg.panelExpire - nowSeconds) / 86400))
                    : null;

                  const isToggling = actionLoading === `toggle-${cfg.id}`;
                  const isSyncing = actionLoading === `sync-${cfg.id}`;

                  return (
                    <div
                      key={cfg.id}
                      className="p-3.5 sm:p-4 rounded-tile border border-line bg-surface-2 space-y-3 transition-colors"
                    >
                      {/* Config Title and Badges */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <bdi
                            dir="ltr"
                            className="font-mono font-semibold text-xs sm:text-sm truncate text-ink"
                          >
                            {cfg.configUsername}
                          </bdi>
                          <span className="text-[11px] px-2 py-0.5 rounded-ctl border font-medium bg-surface border-line text-ink-soft">
                            {cfg.panelName || cfg.panelId}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {isExpired ? (
                            <Badge variant="neutral" size="xs">
                              {t('admin.users.statusExpired')}
                            </Badge>
                          ) : cfg.panelStatus === 'disabled' ? (
                            <Badge variant="error" size="xs">
                              {t('admin.users.statusDisabled')}
                            </Badge>
                          ) : cfg.panelStatus === 'limited' ? (
                            <Badge variant="warning" size="xs">
                              {t('admin.users.statusLimited')}
                            </Badge>
                          ) : cfg.panelStatus === 'on_hold' ? (
                            <Badge variant="warning" size="xs">
                              {t('admin.users.statusOnHold')}
                            </Badge>
                          ) : (
                            <Badge variant="success" dot size="xs">
                              {t('admin.users.statusActive')}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-ink-muted">{t('admin.users.configTraffic')}</span>
                            <bdi className="tnum font-semibold text-ink" dir="ltr">
                              {formatBytes(usedTraffic)} /{' '}
                              {dataLimit > 0
                                ? formatBytes(dataLimit)
                                : t('admin.users.configTrafficUnlimited')}
                              {progressPct !== null && ` (${formatNumber(progressPct)}%)`}
                            </bdi>
                          </div>
                          {progressPct !== null && (
                            <ProgressBar
                              value={progressPct}
                              tone={progressPct > 90 ? 'danger' : progressPct > 70 ? 'warn' : 'ok'}
                              size="sm"
                            />
                          )}
                        </div>

                        {/* Expiry Date */}
                        <div className="flex items-center justify-between sm:justify-end gap-2 text-[11px]">
                          <span className="text-ink-muted">{t('admin.users.configExpire')}</span>
                          <span className="tnum font-medium text-ink">
                            {cfg.panelStatus === 'on_hold'
                              ? cfg.panelOnHoldExpireDuration && cfg.panelOnHoldExpireDuration > 0
                                ? t('admin.users.configExpireOnHoldDays', {
                                    days: formatNumber(
                                      Math.max(1, Math.round(cfg.panelOnHoldExpireDuration / 86400))
                                    ),
                                  })
                                : t('admin.users.configExpireOnHold')
                              : cfg.panelExpire
                                ? isExpired
                                  ? t('admin.users.configExpired')
                                  : t('admin.users.configExpireDaysLeft', {
                                      days: formatNumber(daysLeft || 0),
                                    })
                                : t('admin.users.configExpireUnlimited')}
                          </span>
                        </div>
                      </div>

                      {/* Config Action Toolbar */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-line">
                        {cfg.subUrl && (
                          <>
                            <button
                              type="button"
                              onClick={() => onCopyId(cfg.subUrl!, `sub-${cfg.id}`)}
                              className={`h-8 px-2.5 rounded-ctl border text-xs font-medium flex items-center gap-1 press rs-focus cursor-pointer ${
                                isCopied(`sub-${cfg.id}`)
                                  ? 'bg-ok-soft border-ok/30 text-ok-fg'
                                  : 'bg-surface border-line text-ink-soft hover:border-line-strong hover:text-ink'
                              }`}
                            >
                              {isCopied(`sub-${cfg.id}`) ? (
                                <Check className="w-3 h-3 text-ok-fg" />
                              ) : (
                                <Copy className="w-3 h-3 opacity-60" />
                              )}
                              <span>
                                {isCopied(`sub-${cfg.id}`) ? t('common.copied') : t('common.copy')}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setQrModalConfig(cfg)}
                              className="h-8 px-2.5 rounded-ctl border text-xs font-medium flex items-center gap-1 press rs-focus cursor-pointer bg-brand-soft border-brand/25 text-brand-fg hover:bg-brand/15"
                            >
                              <QrCode className="w-3 h-3" />
                              <span>{t('admin.users.btnShowQr')}</span>
                            </button>
                          </>
                        )}

                        {onToggleConfig && (
                          <button
                            type="button"
                            disabled={isToggling}
                            onClick={() => void handleToggle(cfg)}
                            className={`h-8 px-2.5 rounded-ctl border text-xs font-medium flex items-center gap-1 press rs-focus cursor-pointer disabled:opacity-50 ${
                              cfg.panelStatus === 'disabled'
                                ? 'bg-ok-soft border-ok/30 text-ok-fg hover:bg-ok/15'
                                : 'bg-danger-soft border-danger/25 text-danger-fg hover:bg-danger/15'
                            }`}
                          >
                            {isToggling ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Power className="w-3 h-3" />
                            )}
                            <span>
                              {cfg.panelStatus === 'disabled'
                                ? t('admin.users.btnToggleEnable')
                                : t('admin.users.btnToggleDisable')}
                            </span>
                          </button>
                        )}

                        {onResetConfigUsage && (
                          <button
                            type="button"
                            onClick={() => setConfirmModal({ type: 'reset-usage', config: cfg })}
                            className="h-8 px-2.5 rounded-ctl border text-xs font-medium flex items-center gap-1 press rs-focus cursor-pointer bg-surface border-line text-ink-soft hover:border-line-strong hover:text-ink"
                          >
                            <RotateCcw className="w-3 h-3 opacity-60" />
                            <span>{t('admin.users.btnResetTraffic')}</span>
                          </button>
                        )}

                        {onRevokeConfigSubUrl && (
                          <button
                            type="button"
                            onClick={() => setConfirmModal({ type: 'revoke', config: cfg })}
                            className="h-8 px-2.5 rounded-ctl border text-xs font-medium flex items-center gap-1 press rs-focus cursor-pointer bg-surface border-line text-ink-soft hover:border-line-strong hover:text-ink"
                          >
                            <RefreshCw className="w-3 h-3 opacity-60" />
                            <span>{t('admin.users.btnRevokeSub')}</span>
                          </button>
                        )}

                        {onSyncConfig && (
                          <button
                            type="button"
                            disabled={isSyncing}
                            onClick={() => void handleSync(cfg)}
                            className="h-8 px-2.5 rounded-ctl border text-xs font-medium flex items-center gap-1 press rs-focus cursor-pointer disabled:opacity-50 ms-auto bg-surface border-line text-ink-muted hover:text-ink hover:border-line-strong"
                          >
                            <RefreshCw
                              className={`w-3 h-3 opacity-70 ${isSyncing ? 'animate-spin' : ''}`}
                            />
                            <span>{t('admin.users.btnSync')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Sub-tab 3: Transactions List */}
          {activeTab === 'transactions' && (
            <div className="space-y-2">
              {transactions.length === 0 ? (
                <p className="text-xs text-center py-8 m-0 text-ink-muted">
                  {t('admin.users.noTransactions')}
                </p>
              ) : (
                transactions.map((tx) => {
                  const isCredit = tx.amount > 0;
                  const typeLabel = getTransactionTypeLabel(tx.type, tx.description, t);
                  const friendlyDesc = formatTransactionDescription(tx.description, locale);
                  return (
                    <div
                      key={tx.id}
                      className="p-3 sm:p-3.5 rounded-tile border border-line bg-surface-2 flex items-center justify-between gap-2.5 text-xs transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <IconTile tone={isCredit ? 'ok' : 'danger'} size="sm">
                          {isCredit ? <ArrowDownLeft /> : <ArrowUpRight />}
                        </IconTile>
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-xs truncate text-ink">
                              {typeLabel}
                            </span>
                            <bdi className="text-[11px] tnum text-ink-muted shrink-0" dir="ltr">
                              {formatIsoDate(tx.createdAt)}
                            </bdi>
                          </div>
                          <div className="text-[11px] truncate text-ink-soft" title={friendlyDesc}>
                            {friendlyDesc}
                          </div>
                        </div>
                      </div>

                      <div className="text-end space-y-0.5 shrink-0">
                        <div
                          className={`tnum font-semibold text-xs sm:text-sm ${
                            isCredit ? 'text-ok-fg' : 'text-danger-fg'
                          }`}
                        >
                          <bdi dir="ltr">
                            {isCredit ? '+' : ''}
                            {formatMoney(tx.amount)}
                          </bdi>{' '}
                          <span className="font-normal text-[11px] text-ink-muted">
                            {t('common.currency')}
                          </span>
                        </div>
                        <div className="text-[11px] tnum text-ink-muted">
                          {t('admin.users.txBalanceAfter')}:{' '}
                          <bdi dir="ltr">{formatMoney(tx.balanceAfter)}</bdi>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Sub-tab 4: Orders List */}
          {activeTab === 'orders' && (
            <div className="space-y-2">
              {orders.length === 0 ? (
                <p className="text-xs text-center py-8 m-0 text-ink-muted">
                  {t('admin.users.noOrders')}
                </p>
              ) : (
                orders.map((order) => (
                  <div
                    key={order.id}
                    className="p-3 sm:p-3.5 rounded-tile border border-line bg-surface-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-semibold text-xs sm:text-sm text-ink truncate">
                        {order.packageName || t('admin.users.orderPackage')}
                      </div>
                      <div className="text-[11px] tnum text-ink-muted">
                        {t('common.idLabel')} <bdi dir="ltr">#{formatId(order.id)}</bdi>
                      </div>
                    </div>
                    <div className="text-end space-y-0.5 shrink-0">
                      <div className="tnum font-semibold text-xs sm:text-sm text-ok-fg">
                        <bdi dir="ltr">{formatMoney(order.amount)}</bdi>{' '}
                        <span className="font-normal text-[11px] text-ink-muted">
                          {t('common.currency')}
                        </span>
                      </div>
                      <bdi dir="ltr" className="block text-[11px] tnum text-ink-muted">
                        {formatIsoDate(order.createdAt)}
                      </bdi>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Sub-tab 5: Receipts List */}
          {activeTab === 'receipts' && (
            <div className="space-y-2">
              {receipts.length === 0 ? (
                <p className="text-xs text-center py-8 m-0 text-ink-muted">
                  {t('admin.users.noReceipts')}
                </p>
              ) : (
                receipts.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-3 sm:p-3.5 rounded-tile border border-line bg-surface-2 flex items-center justify-between gap-2 flex-wrap text-xs"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-semibold tnum text-xs sm:text-sm text-ink">
                        <bdi dir="ltr">{formatMoney(rec.amount)}</bdi>{' '}
                        <span className="font-normal text-[11px] text-ink-muted">
                          {t('common.currency')}
                        </span>
                      </div>
                      <div className="text-[11px] tnum text-ink-muted">
                        {t('common.idLabel')} <bdi dir="ltr">#{formatReceiptShortId(rec.id)}</bdi>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {rec.photoFileId && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-ctl border press rs-focus cursor-pointer bg-brand-soft border-brand/25 hover:bg-brand/15 text-brand-fg"
                          onClick={() =>
                            setPhotoTarget({ id: rec.id, mediaType: rec.mediaType ?? undefined })
                          }
                          title={t('admin.receipts.viewPhoto')}
                        >
                          <ImageIcon className="w-3 h-3" />
                          <span className="hidden sm:inline">{t('admin.receipts.viewPhoto')}</span>
                        </button>
                      )}
                      <Badge
                        variant={
                          rec.status === 'approved'
                            ? 'success'
                            : rec.status === 'rejected'
                              ? 'error'
                              : rec.status === 'voided'
                                ? 'neutral'
                                : 'warning'
                        }
                        dot
                        size="xs"
                      >
                        {rec.status === 'approved'
                          ? t('common.statusApproved')
                          : rec.status === 'rejected'
                            ? t('common.statusRejected')
                            : rec.status === 'voided'
                              ? t('common.statusVoided')
                              : t('common.statusPending')}
                      </Badge>
                      <span dir="ltr" className="text-[10px] tnum text-ink-muted">
                        {formatIsoDate(rec.createdAt)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Sub-tab 6: Audit Logs */}
          {activeTab === 'audit' && (
            <div className="space-y-2">
              {auditLogs.length === 0 ? (
                <p className="text-xs text-center py-8 m-0 text-ink-muted">
                  {t('admin.users.noAuditLogs')}
                </p>
              ) : (
                auditLogs.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 sm:p-3.5 rounded-tile border border-line bg-surface-2 flex items-start justify-between gap-2.5 text-xs"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <IconTile tone="neutral" size="sm">
                        <History />
                      </IconTile>
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-mono text-[11px] font-semibold text-ink break-all">
                          {entry.action}
                        </div>
                        <div className="text-[11px] text-ink-muted flex items-center gap-1.5 flex-wrap tnum">
                          <span>
                            {t('admin.users.auditActor', {
                              id: formatId(entry.actorTelegramId),
                            })}
                          </span>
                          <span className="opacity-40">·</span>
                          <bdi dir="ltr" className="font-mono">
                            {entry.entityType}:{entry.entityId}
                          </bdi>
                        </div>
                      </div>
                    </div>
                    <bdi dir="ltr" className="text-[10px] tnum text-ink-muted shrink-0">
                      {formatIsoDate(entry.createdAt)}
                    </bdi>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </Modal>

      <UserDirectMessageModal
        user={user}
        isOpen={isDmModalOpen}
        onClose={() => setIsDmModalOpen(false)}
        onSend={handleSendDirectMessage}
        loading={actionLoading === 'dm'}
      />

      {/* QR Code Modal for user subscription links */}
      <UserConfigQrModal
        config={qrModalConfig}
        onClose={() => setQrModalConfig(null)}
        onCopy={onCopyId}
        isCopied={qrModalConfig ? isCopied(`qr-${qrModalConfig.id}`) : false}
      />

      {/* Confirmation Modal for Ban, Reset Traffic, Revoke URL */}
      {confirmModal && (
        <UserConfirmModal
          isOpen={Boolean(confirmModal)}
          onClose={() => setConfirmModal(null)}
          onConfirm={(reason) => void handleConfirmAction(reason)}
          loading={Boolean(actionLoading)}
          title={
            confirmModal.type === 'ban'
              ? t('admin.users.banConfirmTitle')
              : confirmModal.type === 'unban'
                ? t('admin.users.unbanConfirmTitle')
                : confirmModal.type === 'reset-usage'
                  ? t('admin.users.resetTrafficConfirmTitle')
                  : t('admin.users.revokeConfirmTitle')
          }
          description={
            confirmModal.type === 'ban'
              ? t('admin.users.banConfirmDesc')
              : confirmModal.type === 'unban'
                ? t('admin.users.unbanConfirmDesc')
                : confirmModal.type === 'reset-usage'
                  ? t('admin.users.resetTrafficConfirmDesc')
                  : t('admin.users.revokeConfirmDesc')
          }
          confirmLabel={
            confirmModal.type === 'ban'
              ? t('admin.users.btnBan')
              : confirmModal.type === 'unban'
                ? t('admin.users.btnUnban')
                : confirmModal.type === 'reset-usage'
                  ? t('admin.users.btnResetTraffic')
                  : t('admin.users.btnRevokeSub')
          }
          variant={
            confirmModal.type === 'ban'
              ? 'danger'
              : confirmModal.type === 'unban'
                ? 'primary'
                : 'warning'
          }
          showReasonInput={confirmModal.type === 'ban'}
          reasonPlaceholder={t('admin.users.banReasonPlaceholder')}
        />
      )}

      <ReceiptPhotoModal
        photoUrl={
          photoTarget ? `/api/admin/receipts/${encodeURIComponent(photoTarget.id)}/photo` : null
        }
        receiptId={photoTarget?.id ?? null}
        mediaType={photoTarget?.mediaType}
        onClose={() => setPhotoTarget(null)}
        onErrorNotify={handlePhotoError}
      />
    </>
  );
};
