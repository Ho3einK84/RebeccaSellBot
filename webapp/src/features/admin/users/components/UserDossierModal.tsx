import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Wallet,
  QrCode,
  RotateCw,
  Power,
  RotateCcw,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  Image as ImageIcon,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { UserConfigQrModal } from './UserConfigQrModal.js';
import { UserConfirmModal } from './UserConfirmModal.js';
import { ReceiptPhotoModal } from '@/features/admin/receipts/components/ReceiptPhotoModal.js';
import {
  getTransactionTypeLabel,
  formatTransactionDescription,
} from '@/shared/lib/transactionFormatters.js';
import type { UserDossierResponse } from '@/shared/types/api.js';
import type { UserProfile, UserConfigItem } from '@/shared/types/admin.js';

interface UserDossierModalProps {
  dossier: UserDossierResponse | null;
  onClose: () => void;
  onOpenBalanceModal: (user: UserProfile) => void;
  onCopyId: (id: string, key: string) => void;
  isCopied?: (key: string) => boolean;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
  onBanUser?: (telegramId: number, isBanned: boolean, reason?: string) => Promise<void>;
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
  onToggleConfig,
  onResetConfigUsage,
  onRevokeConfigSubUrl,
  onSyncConfig,
}) => {
  const { t, locale } = useLanguage();
  const { formatMoney, formatNumber, formatIsoDate, formatBytes, sanitizeDisplayName } =
    useFormatters();
  const { subCardClass, textPrimary, textSecondary, textMuted } = useThemeTokens();

  const [activeTab, setActiveTab] = useState<
    'finances' | 'configs' | 'orders' | 'receipts' | 'transactions'
  >('finances');

  // Sub-modals state
  const [qrModalConfig, setQrModalConfig] = useState<UserConfigItem | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    type: 'ban' | 'unban' | 'reset-usage' | 'revoke';
    config?: UserConfigItem;
  } | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [photoReceiptId, setPhotoReceiptId] = useState<string | null>(null);

  const notifyAction = (message: string, type: 'success' | 'error' = 'success') => {
    onNotify?.(message, type);
  };

  // Reset to first tab whenever a different user dossier is opened
  useEffect(() => {
    setActiveTab('finances');
    setQrModalConfig(null);
    setConfirmModal(null);
    setActionLoading(null);
    setPhotoReceiptId(null);
  }, [dossier?.summary?.user?.telegramId]);

  if (!dossier) return null;

  const { summary, orders = [], receipts = [], configs = [], transactions = [] } = dossier;
  const user = summary.user;
  const { displayName } = sanitizeDisplayName(user.firstName, user.lastName, t('user.guestUser'));

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

  return (
    <>
      <Modal isOpen={Boolean(dossier)} onClose={onClose} maxWidth="2xl">
        <div className="space-y-4 max-h-[82dvh] overflow-y-auto">
          {/* Executive Profile Header */}
          <div className="flex items-start justify-between pb-4 border-b border-line">
            <div className="flex items-center gap-3.5 min-w-0">
              <Avatar name={user.firstName} username={user.username} size="lg" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className={`text-base sm:text-lg font-semibold m-0 truncate ${textPrimary}`}>
                    {displayName}
                  </h3>
                  {user.isBanned ? (
                    <Badge variant="error" dot size="xs">
                      {t('admin.users.bannedBadge')}
                    </Badge>
                  ) : (
                    <Badge variant="success" size="xs">
                      {t('admin.users.activeBadge')}
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
                      <span className={textMuted}>{t('admin.users.noUsername')}</span>
                    )}
                  </span>
                  <span className={textMuted}>·</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 tnum text-xs px-2 h-7 rounded-ctl border press rs-focus cursor-pointer bg-surface-2 border-line hover:border-line-strong text-ink-soft"
                    onClick={() => onCopyId(String(user.telegramId), 'dossier-id')}
                    title={t('common.copy')}
                  >
                    <bdi dir="ltr" className="font-mono">
                      #{user.telegramId}
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

            <button
              type="button"
              className="w-8 h-8 flex items-center justify-center rounded-ctl text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer shrink-0 rs-focus"
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Segmented Dossier Tabs */}
          <div className="p-1 rounded-tile bg-surface-2 border border-line flex items-center gap-1 overflow-x-auto scrollbar-none">
            <button
              type="button"
              className={`h-8 px-3 rounded-ctl text-xs font-medium cursor-pointer shrink-0 text-center rs-focus ${activeTab === 'finances' ? 'bg-surface border border-line-strong text-ink font-semibold' : 'border border-transparent text-ink-muted hover:text-ink'}`}
              onClick={() => setActiveTab('finances')}
            >
              {t('admin.users.tabFinances')}
            </button>

            <button
              type="button"
              className={`h-8 px-3 rounded-ctl text-xs font-medium cursor-pointer shrink-0 text-center rs-focus ${activeTab === 'configs' ? 'bg-surface border border-line-strong text-ink font-semibold' : 'border border-transparent text-ink-muted hover:text-ink'}`}
              onClick={() => setActiveTab('configs')}
            >
              {t('admin.users.tabConfigs')} ({formatNumber(configs.length)})
            </button>

            <button
              type="button"
              className={`h-8 px-3 rounded-ctl text-xs font-medium cursor-pointer shrink-0 text-center rs-focus ${activeTab === 'transactions' ? 'bg-surface border border-line-strong text-ink font-semibold' : 'border border-transparent text-ink-muted hover:text-ink'}`}
              onClick={() => setActiveTab('transactions')}
            >
              {t('admin.users.tabTransactions')} ({formatNumber(transactions.length)})
            </button>

            <button
              type="button"
              className={`h-8 px-3 rounded-ctl text-xs font-medium cursor-pointer shrink-0 text-center rs-focus ${activeTab === 'orders' ? 'bg-surface border border-line-strong text-ink font-semibold' : 'border border-transparent text-ink-muted hover:text-ink'}`}
              onClick={() => setActiveTab('orders')}
            >
              {t('admin.users.tabOrders')} ({formatNumber(orders.length)})
            </button>

            <button
              type="button"
              className={`h-8 px-3 rounded-ctl text-xs font-medium cursor-pointer shrink-0 text-center rs-focus ${activeTab === 'receipts' ? 'bg-surface border border-line-strong text-ink font-semibold' : 'border border-transparent text-ink-muted hover:text-ink'}`}
              onClick={() => setActiveTab('receipts')}
            >
              {t('admin.users.tabReceipts')} ({formatNumber(receipts.length)})
            </button>
          </div>

          {/* Sub-tab 1: Finances Grid */}
          {activeTab === 'finances' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div className={`p-3.5 rounded-tile border ${subCardClass}`}>
                <span className={`text-xs font-medium block ${textMuted}`}>
                  {t('admin.users.userCurBalance')}
                </span>
                <div className="text-base sm:text-lg font-semibold tnum mt-1 text-ok-fg">
                  <bdi dir="ltr">{formatMoney(user.balance)}</bdi> {t('common.currency')}
                </div>
              </div>

              <div className={`p-3.5 rounded-tile border ${subCardClass}`}>
                <span className={`text-xs font-medium block ${textMuted}`}>
                  {t('admin.users.userTotalDeposit')}
                </span>
                <div className={`text-base sm:text-lg font-semibold tnum mt-1 ${textPrimary}`}>
                  <bdi dir="ltr">{formatMoney(summary.totalDeposit)}</bdi> {t('common.currency')}
                </div>
              </div>

              <div className={`p-3.5 rounded-tile border ${subCardClass}`}>
                <span className={`text-xs font-medium block ${textMuted}`}>
                  {t('admin.users.userTotalSpend')}
                </span>
                <div className={`text-base sm:text-lg font-semibold tnum mt-1 ${textPrimary}`}>
                  <bdi dir="ltr">{formatMoney(summary.totalSpend)}</bdi> {t('common.currency')}
                </div>
              </div>

              <div className={`p-3.5 rounded-tile border ${subCardClass}`}>
                <span className={`text-xs font-medium block ${textMuted}`}>
                  {t('admin.users.userActiveConfigs')}
                </span>
                <div className="text-base sm:text-lg font-semibold text-brand-fg tnum mt-1">
                  {formatNumber(summary.activeConfigsCount)}
                </div>
              </div>

              <div className={`p-3.5 rounded-tile border ${subCardClass}`}>
                <span className={`text-xs font-medium block ${textMuted}`}>
                  {t('admin.users.userApprovedReceipts')}
                </span>
                <div className="text-base sm:text-lg font-semibold tnum mt-1 text-ok-fg">
                  {formatNumber(summary.receiptsApprovedCount)}
                </div>
              </div>

              <div className={`p-3.5 rounded-tile border ${subCardClass}`}>
                <span className={`text-xs font-medium block ${textMuted}`}>
                  {t('admin.users.userAuditEvents')}
                </span>
                <div className={`text-base sm:text-lg font-semibold tnum mt-1 ${textSecondary}`}>
                  {formatNumber(summary.auditEventsCount)}
                </div>
              </div>
            </div>
          )}

          {/* Sub-tab 2: Configs & Subscriptions */}
          {activeTab === 'configs' && (
            <div className="space-y-3">
              {configs.length === 0 ? (
                <p className={`text-xs text-center py-8 ${textMuted}`}>
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
                      className={`p-3.5 sm:p-4 rounded-xl border space-y-3 transition-colors ${subCardClass}`}
                    >
                      {/* Config Title and Badges */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <bdi
                            dir="ltr"
                            className={`font-mono tnum font-semibold text-xs sm:text-sm truncate ${textPrimary}`}
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
                          ) : (
                            <Badge variant="success" dot size="xs">
                              {t('admin.users.statusActive')}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-[11px]">
                            <span className={textMuted}>{t('admin.users.configTraffic')}</span>
                            <bdi className="tnum font-semibold" dir="ltr">
                              {formatBytes(usedTraffic)} /{' '}
                              {dataLimit > 0
                                ? formatBytes(dataLimit)
                                : t('admin.users.configTrafficUnlimited')}
                              {progressPct !== null && ` (${formatNumber(progressPct)}%)`}
                            </bdi>
                          </div>
                          {progressPct !== null && (
                            <div className="w-full h-1.5 rounded-full bg-surface-3 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${progressPct > 90 ? 'bg-danger' : progressPct > 70 ? 'bg-warn' : 'bg-ok'}`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          )}
                        </div>

                        {/* Expiry Date */}
                        <div className="flex items-center justify-between sm:justify-end gap-2 text-[11px]">
                          <span className={textMuted}>{t('admin.users.configExpire')}</span>
                          <span className="tnum font-medium">
                            {cfg.panelExpire
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
                              className={`h-8 px-2.5 rounded-ctl border text-xs font-medium flex items-center gap-1 press rs-focus cursor-pointer ${isCopied(`sub-${cfg.id}`) ? 'bg-ok-soft border-ok/30 text-ok-fg' : 'bg-surface border-line text-ink-soft hover:border-line-strong hover:text-ink'}`}
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
                            onClick={() => handleToggle(cfg)}
                            className={`h-8 px-2.5 rounded-ctl border text-xs font-medium flex items-center gap-1 press rs-focus cursor-pointer ${cfg.panelStatus === 'disabled' ? 'bg-ok-soft border-ok/30 text-ok-fg hover:bg-ok/20' : 'bg-danger-soft border-danger/25 text-danger-fg hover:bg-danger/20'}`}
                          >
                            {isToggling ? (
                              <RotateCw className="w-3 h-3 animate-spin" />
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
                            onClick={() => handleSync(cfg)}
                            className="h-8 px-2.5 rounded-ctl border text-xs font-medium flex items-center gap-1 press rs-focus cursor-pointer ms-auto bg-surface border-line text-ink-muted hover:text-ink hover:border-line-strong"
                          >
                            <RotateCw
                              className={`w-3 h-3 opacity-60 ${isSyncing ? 'animate-spin' : ''}`}
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
                <p className={`text-xs text-center py-8 ${textMuted}`}>
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
                      className={`p-3 sm:p-3.5 rounded-xl border flex items-center justify-between text-xs transition-colors ${subCardClass}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${isCredit ? 'bg-ok/10 border-ok/20 text-ok' : 'bg-danger/10 border-danger/20 text-danger'}`}
                        >
                          {isCredit ? (
                            <ArrowDownLeft className="w-3.5 h-3.5 rtl:-scale-x-100" />
                          ) : (
                            <ArrowUpRight className="w-3.5 h-3.5 rtl:-scale-x-100" />
                          )}
                        </div>
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-semibold text-xs truncate ${textPrimary}`}>
                              {typeLabel}
                            </span>
                            <bdi className={`text-[11px] tnum ${textMuted}`} dir="ltr">
                              {formatIsoDate(tx.createdAt)}
                            </bdi>
                          </div>
                          <div
                            className={`text-[11px] truncate ${textSecondary}`}
                            title={friendlyDesc}
                          >
                            {friendlyDesc}
                          </div>
                        </div>
                      </div>

                      <div className="text-end space-y-0.5 shrink-0">
                        <div
                          className={`tnum font-semibold text-xs sm:text-sm ${isCredit ? 'text-ok-fg' : 'text-danger-fg'}`}
                        >
                          <bdi dir="ltr">
                            {isCredit ? '+' : ''}
                            {formatMoney(tx.amount)}
                          </bdi>{' '}
                          <span className="font-normal text-xs">{t('common.currency')}</span>
                        </div>
                        <div className={`text-[11px] tnum ${textMuted}`}>
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
                <p className={`text-xs text-center py-8 ${textMuted}`}>
                  {t('admin.users.noOrders')}
                </p>
              ) : (
                orders.map((order) => (
                  <div
                    key={order.id}
                    className={`p-3 sm:p-3.5 rounded-tile border flex items-center justify-between text-xs ${subCardClass}`}
                  >
                    <div className="space-y-0.5">
                      <div className={`font-semibold text-xs sm:text-sm ${textPrimary}`}>
                        {order.packageName || t('admin.users.orderPackage')}
                      </div>
                      <div className={`text-[11px] tnum ${textMuted}`}>
                        {t('common.idLabel')} <bdi dir="ltr">{order.id}</bdi>
                      </div>
                    </div>
                    <div className="text-end space-y-0.5">
                      <div className="tnum font-semibold text-xs sm:text-sm text-ok-fg">
                        <bdi dir="ltr">{formatMoney(order.amount)}</bdi>{' '}
                        <span className="font-normal text-xs">{t('common.currency')}</span>
                      </div>
                      <bdi dir="ltr" className={`block text-[11px] tnum ${textMuted}`}>
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
                <p className={`text-xs text-center py-8 ${textMuted}`}>
                  {t('admin.users.noReceipts')}
                </p>
              ) : (
                receipts.map((rec) => (
                  <div
                    key={rec.id}
                    className={`p-3 sm:p-3.5 rounded-tile border flex items-center justify-between text-xs ${subCardClass}`}
                  >
                    <div className="space-y-0.5">
                      <div className={`font-semibold tnum text-xs sm:text-sm ${textPrimary}`}>
                        <bdi dir="ltr">{formatMoney(rec.amount)}</bdi> {t('common.currency')}
                      </div>
                      <div className={`text-[11px] tnum ${textMuted}`}>
                        {t('common.idLabel')} <bdi dir="ltr">{rec.id}</bdi>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {rec.photoFileId && (
                        <button
                          type="button"
                          className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg border transition-all active:scale-95 cursor-pointer bg-brand/10 border-brand/25 hover:bg-brand/20 text-brand`}
                          onClick={() => setPhotoReceiptId(rec.id)}
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
                              : 'warning'
                        }
                        dot
                        className="text-[10px]"
                      >
                        {rec.status === 'approved'
                          ? t('common.statusApproved')
                          : rec.status === 'rejected'
                            ? t('common.statusRejected')
                            : t('common.statusPending')}
                      </Badge>
                      <span dir="ltr" className={`text-[10px] ${textMuted}`}>
                        {formatIsoDate(rec.createdAt)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Bottom Action Bar */}
          <div className="modal-action flex flex-wrap justify-between items-center gap-2 pt-3 border-t border-line">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-9 px-3.5 rounded-ctl font-semibold text-xs border press rs-focus cursor-pointer inline-flex items-center gap-1.5 bg-brand hover:bg-brand-hover text-brand-ink border-transparent"
                onClick={() => {
                  onOpenBalanceModal(user);
                }}
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>{t('admin.users.btnChangeBalance')}</span>
              </button>

              {onBanUser && (
                <button
                  type="button"
                  className={`h-9 px-3.5 rounded-ctl font-semibold text-xs border press rs-focus cursor-pointer inline-flex items-center gap-1.5 ${
                    user.isBanned
                      ? 'bg-ok-soft border-ok/30 text-ok-fg hover:bg-ok/20'
                      : 'bg-danger-soft border-danger/30 text-danger-fg hover:bg-danger/20'
                  }`}
                  onClick={() =>
                    setConfirmModal({
                      type: user.isBanned ? 'unban' : 'ban',
                    })
                  }
                >
                  {user.isBanned ? (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  ) : (
                    <ShieldAlert className="w-3.5 h-3.5" />
                  )}
                  <span>{user.isBanned ? t('admin.users.btnUnban') : t('admin.users.btnBan')}</span>
                </button>
              )}
            </div>

            <button
              type="button"
              className="h-9 px-4 rounded-ctl text-xs font-medium border press rs-focus cursor-pointer flex items-center justify-center bg-surface-2 border-line text-ink-soft hover:border-line-strong hover:text-ink"
              onClick={onClose}
            >
              {t('admin.users.btnCloseReport')}
            </button>
          </div>
        </div>
      </Modal>

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
          onConfirm={handleConfirmAction}
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
          photoReceiptId ? `/api/admin/receipts/${encodeURIComponent(photoReceiptId)}/photo` : null
        }
        receiptId={photoReceiptId}
        onClose={() => setPhotoReceiptId(null)}
        onErrorNotify={() => onNotify?.(t('admin.receipts.noPhoto'), 'error')}
      />
    </>
  );
};
