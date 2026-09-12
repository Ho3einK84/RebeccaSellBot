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
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { UserConfigQrModal } from './UserConfigQrModal.js';
import { UserConfirmModal } from './UserConfirmModal.js';
import type { UserDossierResponse } from '@/shared/types/api.js';
import type { UserProfile, UserConfigItem } from '@/shared/types/admin.js';

interface UserDossierModalProps {
  dossier: UserDossierResponse | null;
  onClose: () => void;
  onOpenBalanceModal: (user: UserProfile) => void;
  onCopyId: (id: string, key: string) => void;
  isCopied?: (key: string) => boolean;
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
  onBanUser,
  onToggleConfig,
  onResetConfigUsage,
  onRevokeConfigSubUrl,
  onSyncConfig,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber, formatIsoDate, formatBytes, sanitizeDisplayName } =
    useFormatters();
  const { isDark, subCardClass, textPrimary, textSecondary, textMuted } = useThemeTokens();

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

  // Reset to first tab whenever a different user dossier is opened
  useEffect(() => {
    setActiveTab('finances');
    setQrModalConfig(null);
    setConfirmModal(null);
    setActionLoading(null);
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
      } else if (type === 'unban' && onBanUser) {
        await onBanUser(user.telegramId, false, reason);
      } else if (type === 'reset-usage' && config && onResetConfigUsage) {
        await onResetConfigUsage(user.telegramId, config.configUsername, config.panelId);
      } else if (type === 'revoke' && config && onRevokeConfigSubUrl) {
        await onRevokeConfigSubUrl(user.telegramId, config.configUsername, config.panelId);
      }
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
    } finally {
      setActionLoading(null);
    }
  };

  const handleSync = async (cfg: UserConfigItem) => {
    if (!onSyncConfig) return;
    setActionLoading(`sync-${cfg.id}`);
    try {
      await onSyncConfig(user.telegramId, cfg.configUsername, cfg.panelId);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <>
      <Modal isOpen={Boolean(dossier)} onClose={onClose} maxWidth="2xl">
        <div className="space-y-4 max-h-[82dvh] overflow-y-auto">
          {/* Executive Profile Header */}
          <div
            className={`flex items-start justify-between pb-4 border-b ${
              isDark ? 'border-white/[0.08]' : 'border-slate-200/80'
            }`}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <Avatar name={user.firstName} username={user.username} size="lg" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3
                    className={`text-base sm:text-lg font-bold m-0 tracking-tight truncate ${textPrimary}`}
                  >
                    {displayName}
                  </h3>
                  {user.isBanned ? (
                    <Badge variant="error" dot pulse className="text-[10px]">
                      {t('admin.users.bannedBadge')}
                    </Badge>
                  ) : (
                    <Badge variant="success" className="text-[10px]">
                      {t('admin.users.activeBadge')}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs mt-1 flex-wrap">
                  <span className="text-indigo-500 font-mono">
                    {user.username ? (
                      <span dir="ltr" className="inline-block unicode-isolate font-medium">
                        @{user.username}
                      </span>
                    ) : (
                      <span className={textMuted}>{t('admin.users.noUsername')}</span>
                    )}
                  </span>
                  <span className={textMuted}>·</span>
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-lg border transition-all active:scale-95 cursor-pointer ${
                      isDark
                        ? 'bg-white/[0.04] border-white/10 hover:border-white/20 text-zinc-300'
                        : 'bg-slate-100 border-slate-200/80 hover:border-slate-300 text-slate-700'
                    }`}
                    onClick={() => onCopyId(String(user.telegramId), 'dossier-id')}
                    title={t('common.copy')}
                  >
                    <span className="text-[10px] opacity-60">#</span>
                    <span dir="ltr">{user.telegramId}</span>
                    {isCopied('dossier-id') ? (
                      <Check className="w-2.5 h-2.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-2.5 h-2.5 opacity-50" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Segmented Dossier Tabs */}
          <div className="p-1 rounded-xl bg-slate-100 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/[0.06] flex items-center gap-1 overflow-x-auto scrollbar-none">
            <button
              type="button"
              className={`py-1.5 px-2.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer shrink-0 text-center ${
                activeTab === 'finances'
                  ? isDark
                    ? 'bg-white/10 text-white font-semibold shadow-xs'
                    : 'bg-white text-slate-950 font-semibold shadow-xs'
                  : isDark
                    ? 'text-zinc-400 hover:text-zinc-200'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              onClick={() => setActiveTab('finances')}
            >
              {t('admin.users.tabFinances')}
            </button>

            <button
              type="button"
              className={`py-1.5 px-2.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer shrink-0 text-center ${
                activeTab === 'configs'
                  ? isDark
                    ? 'bg-white/10 text-white font-semibold shadow-xs'
                    : 'bg-white text-slate-950 font-semibold shadow-xs'
                  : isDark
                    ? 'text-zinc-400 hover:text-zinc-200'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              onClick={() => setActiveTab('configs')}
            >
              {t('admin.users.tabConfigs')} ({formatNumber(configs.length)})
            </button>

            <button
              type="button"
              className={`py-1.5 px-2.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer shrink-0 text-center ${
                activeTab === 'transactions'
                  ? isDark
                    ? 'bg-white/10 text-white font-semibold shadow-xs'
                    : 'bg-white text-slate-950 font-semibold shadow-xs'
                  : isDark
                    ? 'text-zinc-400 hover:text-zinc-200'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              onClick={() => setActiveTab('transactions')}
            >
              {t('admin.users.tabTransactions')} ({formatNumber(transactions.length)})
            </button>

            <button
              type="button"
              className={`py-1.5 px-2.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer shrink-0 text-center ${
                activeTab === 'orders'
                  ? isDark
                    ? 'bg-white/10 text-white font-semibold shadow-xs'
                    : 'bg-white text-slate-950 font-semibold shadow-xs'
                  : isDark
                    ? 'text-zinc-400 hover:text-zinc-200'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              onClick={() => setActiveTab('orders')}
            >
              {t('admin.users.tabOrders')} ({formatNumber(orders.length)})
            </button>

            <button
              type="button"
              className={`py-1.5 px-2.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer shrink-0 text-center ${
                activeTab === 'receipts'
                  ? isDark
                    ? 'bg-white/10 text-white font-semibold shadow-xs'
                    : 'bg-white text-slate-950 font-semibold shadow-xs'
                  : isDark
                    ? 'text-zinc-400 hover:text-zinc-200'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              onClick={() => setActiveTab('receipts')}
            >
              {t('admin.users.tabReceipts')} ({formatNumber(receipts.length)})
            </button>
          </div>

          {/* Sub-tab 1: Finances Grid */}
          {activeTab === 'finances' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div className={`p-3.5 rounded-xl border ${subCardClass}`}>
                <span className={`text-[11px] font-medium block ${textMuted}`}>
                  {t('admin.users.userCurBalance')}
                </span>
                <div
                  className={`text-base sm:text-lg font-bold font-mono tracking-tight mt-1 ${
                    isDark ? 'text-emerald-400' : 'text-emerald-600'
                  }`}
                >
                  {formatMoney(user.balance)} {t('common.currency')}
                </div>
              </div>

              <div className={`p-3.5 rounded-xl border ${subCardClass}`}>
                <span className={`text-[11px] font-medium block ${textMuted}`}>
                  {t('admin.users.userTotalDeposit')}
                </span>
                <div
                  className={`text-base sm:text-lg font-bold font-mono tracking-tight mt-1 ${textPrimary}`}
                >
                  {formatMoney(summary.totalDeposit)} {t('common.currency')}
                </div>
              </div>

              <div className={`p-3.5 rounded-xl border ${subCardClass}`}>
                <span className={`text-[11px] font-medium block ${textMuted}`}>
                  {t('admin.users.userTotalSpend')}
                </span>
                <div
                  className={`text-base sm:text-lg font-bold font-mono tracking-tight mt-1 ${textPrimary}`}
                >
                  {formatMoney(summary.totalSpend)} {t('common.currency')}
                </div>
              </div>

              <div className={`p-3.5 rounded-xl border ${subCardClass}`}>
                <span className={`text-[11px] font-medium block ${textMuted}`}>
                  {t('admin.users.userActiveConfigs')}
                </span>
                <div className="text-base sm:text-lg font-bold text-indigo-500 font-mono tracking-tight mt-1">
                  {formatNumber(summary.activeConfigsCount)}
                </div>
              </div>

              <div className={`p-3.5 rounded-xl border ${subCardClass}`}>
                <span className={`text-[11px] font-medium block ${textMuted}`}>
                  {t('admin.users.userApprovedReceipts')}
                </span>
                <div
                  className={`text-base sm:text-lg font-bold font-mono tracking-tight mt-1 ${
                    isDark ? 'text-emerald-400' : 'text-emerald-600'
                  }`}
                >
                  {formatNumber(summary.receiptsApprovedCount)}
                </div>
              </div>

              <div className={`p-3.5 rounded-xl border ${subCardClass}`}>
                <span className={`text-[11px] font-medium block ${textMuted}`}>
                  {t('admin.users.userAuditEvents')}
                </span>
                <div
                  className={`text-base sm:text-lg font-bold font-mono tracking-tight mt-1 ${textSecondary}`}
                >
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
                          <span
                            dir="ltr"
                            className={`font-mono font-bold text-xs sm:text-sm truncate ${textPrimary}`}
                          >
                            {cfg.configUsername}
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-md border font-medium ${
                              isDark
                                ? 'bg-white/[0.04] border-white/10 text-zinc-300'
                                : 'bg-slate-100 border-slate-200 text-slate-700'
                            }`}
                          >
                            {cfg.panelName || cfg.panelId}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {cfg.panelStatus === 'active' && !isExpired && (
                            <Badge variant="success" dot pulse className="text-[10px]">
                              {t('admin.users.statusActive')}
                            </Badge>
                          )}
                          {cfg.panelStatus === 'disabled' && (
                            <Badge variant="error" className="text-[10px]">
                              {t('admin.users.statusDisabled')}
                            </Badge>
                          )}
                          {cfg.panelStatus === 'limited' && (
                            <Badge variant="warning" className="text-[10px]">
                              {t('admin.users.statusLimited')}
                            </Badge>
                          )}
                          {isExpired && (
                            <Badge variant="neutral" className="text-[10px]">
                              {t('admin.users.statusExpired')}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Traffic Usage Progress & Expiration */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                        {/* Traffic Bar */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-[11px]">
                            <span className={textMuted}>{t('admin.users.configTraffic')}</span>
                            <span className="font-mono font-semibold">
                              {formatBytes(usedTraffic)} /{' '}
                              {dataLimit > 0
                                ? formatBytes(dataLimit)
                                : t('admin.users.configTrafficUnlimited')}
                              {progressPct !== null && ` (${formatNumber(progressPct)}%)`}
                            </span>
                          </div>
                          {progressPct !== null && (
                            <div className="w-full h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  progressPct > 90
                                    ? 'bg-rose-500'
                                    : progressPct > 70
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-500'
                                }`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          )}
                        </div>

                        {/* Expiry Date */}
                        <div className="flex items-center justify-between sm:justify-end gap-2 text-[11px]">
                          <span className={textMuted}>{t('admin.users.configExpire')}</span>
                          <span className="font-mono font-medium">
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
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-200/50 dark:border-white/[0.04]">
                        {/* Sub link actions */}
                        {cfg.subUrl && (
                          <>
                            <button
                              type="button"
                              onClick={() => onCopyId(cfg.subUrl!, `sub-${cfg.id}`)}
                              className={`h-7.5 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                                isCopied(`sub-${cfg.id}`)
                                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500'
                                  : isDark
                                    ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]'
                                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              {isCopied(`sub-${cfg.id}`) ? (
                                <Check className="w-3 h-3 text-emerald-500" />
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
                              className={`h-7.5 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                                isDark
                                  ? 'bg-indigo-500/15 border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/25'
                                  : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                              }`}
                            >
                              <QrCode className="w-3 h-3" />
                              <span>{t('admin.users.btnShowQr')}</span>
                            </button>
                          </>
                        )}

                        {/* Toggle Enable/Disable */}
                        {onToggleConfig && (
                          <button
                            type="button"
                            disabled={isToggling}
                            onClick={() => handleToggle(cfg)}
                            className={`h-7.5 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                              cfg.panelStatus === 'disabled'
                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25'
                                : 'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20'
                            }`}
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

                        {/* Reset Usage */}
                        {onResetConfigUsage && (
                          <button
                            type="button"
                            onClick={() => setConfirmModal({ type: 'reset-usage', config: cfg })}
                            className={`h-7.5 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                              isDark
                                ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <RotateCcw className="w-3 h-3 opacity-60" />
                            <span>{t('admin.users.btnResetTraffic')}</span>
                          </button>
                        )}

                        {/* Revoke / Rotate URL */}
                        {onRevokeConfigSubUrl && (
                          <button
                            type="button"
                            onClick={() => setConfirmModal({ type: 'revoke', config: cfg })}
                            className={`h-7.5 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                              isDark
                                ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <RefreshCw className="w-3 h-3 opacity-60" />
                            <span>{t('admin.users.btnRevokeSub')}</span>
                          </button>
                        )}

                        {/* Live Sync */}
                        {onSyncConfig && (
                          <button
                            type="button"
                            disabled={isSyncing}
                            onClick={() => handleSync(cfg)}
                            className={`h-7.5 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-all active:scale-95 cursor-pointer ms-auto ${
                              isDark
                                ? 'bg-white/[0.04] border-white/10 text-zinc-400 hover:text-zinc-200'
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900'
                            }`}
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
                  return (
                    <div
                      key={tx.id}
                      className={`p-3 sm:p-3.5 rounded-xl border flex items-center justify-between text-xs transition-colors ${subCardClass}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                            isCredit
                              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                              : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
                          }`}
                        >
                          {isCredit ? (
                            <ArrowDownLeft className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="space-y-0.5 min-w-0">
                          <div className={`font-semibold text-xs truncate ${textPrimary}`}>
                            {tx.description}
                          </div>
                          <div className={`text-[10px] font-mono ${textMuted}`}>
                            {formatIsoDate(tx.createdAt)}
                          </div>
                        </div>
                      </div>

                      <div className="text-right rtl:text-left space-y-0.5 shrink-0">
                        <div
                          className={`font-mono font-bold text-xs sm:text-sm ${
                            isCredit
                              ? 'text-emerald-500 dark:text-emerald-400'
                              : 'text-rose-500 dark:text-rose-400'
                          }`}
                        >
                          {isCredit ? '+' : ''}
                          {formatMoney(tx.amount)} {t('common.currency')}
                        </div>
                        <div className={`text-[10px] font-mono ${textMuted}`}>
                          {t('admin.users.txBalanceAfter')}: {formatMoney(tx.balanceAfter)}
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
                    className={`p-3 sm:p-3.5 rounded-xl border flex items-center justify-between text-xs transition-colors ${subCardClass}`}
                  >
                    <div className="space-y-0.5">
                      <div className={`font-semibold text-xs sm:text-sm ${textPrimary}`}>
                        {order.packageName || t('admin.users.orderPackage')}
                      </div>
                      <div className={`text-[11px] font-mono ${textMuted}`}>
                        {t('common.idLabel')} <span dir="ltr">{order.id}</span>
                      </div>
                    </div>
                    <div className="text-right rtl:text-left space-y-0.5">
                      <div
                        className={`font-mono font-bold text-xs sm:text-sm ${
                          isDark ? 'text-emerald-400' : 'text-emerald-600'
                        }`}
                      >
                        {formatMoney(order.amount)} {t('common.currency')}
                      </div>
                      <div className={`text-[10px] ${textMuted}`}>
                        {formatIsoDate(order.createdAt)}
                      </div>
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
                    className={`p-3 sm:p-3.5 rounded-xl border flex items-center justify-between text-xs transition-colors ${subCardClass}`}
                  >
                    <div className="space-y-0.5">
                      <div className={`font-bold font-mono text-xs sm:text-sm ${textPrimary}`}>
                        {formatMoney(rec.amount)} {t('common.currency')}
                      </div>
                      <div className={`text-[11px] font-mono ${textMuted}`}>
                        {t('common.idLabel')} <span dir="ltr">{rec.id}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
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
                      <span className={`text-[10px] ${textMuted}`}>
                        {formatIsoDate(rec.createdAt)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Bottom Action Bar */}
          <div
            className={`modal-action flex flex-wrap justify-between items-center gap-2 pt-3 border-t ${
              isDark ? 'border-white/[0.08]' : 'border-slate-200/80'
            }`}
          >
            <div className="flex items-center gap-2">
              {/* Balance adjust button */}
              <button
                type="button"
                className={`h-9 px-3.5 rounded-xl font-semibold text-xs border transition-all active:scale-95 cursor-pointer inline-flex items-center gap-1.5 ${
                  isDark
                    ? 'bg-indigo-500 hover:bg-indigo-400 text-white border-indigo-500 shadow-xs'
                    : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900 shadow-xs'
                }`}
                onClick={() => {
                  onOpenBalanceModal(user);
                }}
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>{t('admin.users.btnChangeBalance')}</span>
              </button>

              {/* Ban / Unban User Button */}
              {onBanUser && (
                <button
                  type="button"
                  className={`h-9 px-3.5 rounded-xl font-semibold text-xs border transition-all active:scale-95 cursor-pointer inline-flex items-center gap-1.5 ${
                    user.isBanned
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25'
                      : 'bg-rose-500/15 border-rose-500/30 text-rose-400 hover:bg-rose-500/25'
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
              className={`h-9 px-4 rounded-xl text-xs font-medium border transition-all active:scale-95 cursor-pointer flex items-center justify-center ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-xs'
              }`}
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
    </>
  );
};
