import React, { useState, useEffect } from 'react';
import { X, Copy, Wallet } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import type { UserDossierResponse } from '@/shared/types/api.js';
import type { UserProfile } from '@/shared/types/admin.js';

interface UserDossierModalProps {
  dossier: UserDossierResponse | null;
  onClose: () => void;
  onOpenBalanceModal: (user: UserProfile) => void;
  onCopyId: (id: string, key: string) => void;
}

export const UserDossierModal: React.FC<UserDossierModalProps> = ({
  dossier,
  onClose,
  onOpenBalanceModal,
  onCopyId,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber, formatIsoDate, sanitizeDisplayName } = useFormatters();
  const { isDark, subCardClass, textPrimary, textSecondary, textMuted } = useThemeTokens();
  const [activeTab, setActiveTab] = useState<'finances' | 'orders' | 'receipts'>('finances');

  // Reset to the first tab whenever a different user dossier is opened.
  useEffect(() => {
    setActiveTab('finances');
  }, [dossier?.summary?.user?.telegramId]);

  if (!dossier) return null;

  const { summary, orders, receipts } = dossier;
  const user = summary.user;
  const { displayName } = sanitizeDisplayName(user.firstName, user.lastName, t('user.guestUser'));

  return (
    <Modal isOpen={Boolean(dossier)} onClose={onClose} maxWidth="2xl">
      <div className="space-y-4 max-h-[80dvh] overflow-y-auto">
        {/* Executive Profile Header */}
        <div
          className={`flex items-start justify-between pb-4 border-b ${
            isDark ? 'border-white/[0.08]' : 'border-slate-200/80'
          }`}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <Avatar name={user.firstName} username={user.username} size="lg" />
            <div className="min-w-0">
              <h3
                className={`text-base sm:text-lg font-bold m-0 tracking-tight truncate ${textPrimary}`}
              >
                {displayName}
              </h3>
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
                  <Copy className="w-2.5 h-2.5 opacity-50" />
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
        <div className="p-1 rounded-xl bg-slate-100 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/[0.06] flex items-center gap-1">
          <button
            type="button"
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer text-center ${
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
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer text-center ${
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
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer text-center ${
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

        {/* Sub-tab 2: Orders List */}
        {activeTab === 'orders' && (
          <div className="space-y-2">
            {orders.length === 0 ? (
              <p className={`text-xs text-center py-8 ${textMuted}`}>{t('admin.users.noOrders')}</p>
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

        {/* Sub-tab 3: Receipts List */}
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

        {/* Action Bar */}
        <div
          className={`modal-action flex justify-between items-center pt-3 border-t ${
            isDark ? 'border-white/[0.08]' : 'border-slate-200/80'
          }`}
        >
          <button
            type="button"
            className={`h-9 px-4 rounded-xl font-semibold text-xs border transition-all active:scale-95 cursor-pointer inline-flex items-center gap-1.5 ${
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
  );
};
