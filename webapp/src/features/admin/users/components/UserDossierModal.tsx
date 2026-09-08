import React, { useState } from 'react';
import { X, Copy, Wallet } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
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

  if (!dossier) return null;

  const { summary, orders, receipts } = dossier;
  const user = summary.user;
  const { displayName } = sanitizeDisplayName(user.firstName, user.lastName, t('user.guestUser'));

  return (
    <Modal isOpen={Boolean(dossier)} onClose={onClose} maxWidth="2xl">
      <div className="space-y-4 max-h-[80dvh] overflow-y-auto">
        {/* Header */}
        <div
          className={`flex items-center justify-between pb-3 border-b ${
            isDark ? 'border-white/10' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <Avatar name={user.firstName} username={user.username} size="lg" />
            <div>
              <h3 className={`text-base font-bold m-0 ${textPrimary}`}>{displayName}</h3>
              <div className={`flex items-center gap-2 text-xs mt-0.5 ${textSecondary}`}>
                <span className="text-indigo-500 font-mono">
                  {user.username ? (
                    <span dir="ltr" className="inline-block unicode-isolate">
                      @{user.username}
                    </span>
                  ) : (
                    t('admin.users.noUsername')
                  )}
                </span>
                <span>·</span>
                <button
                  type="button"
                  className="font-mono hover:text-indigo-400 flex items-center gap-1 cursor-pointer"
                  onClick={() => onCopyId(String(user.telegramId), 'dossier-id')}
                >
                  <span dir="ltr">{user.telegramId}</span>
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-circle btn-xs cursor-pointer text-slate-400 hover:text-white"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Dossier Tabs */}
        <div
          className={`flex gap-2 pb-2 border-b ${isDark ? 'border-white/5' : 'border-slate-200'}`}
        >
          <button
            type="button"
            className={`btn btn-xs rounded-lg cursor-pointer ${
              activeTab === 'finances'
                ? 'btn-primary text-white'
                : isDark
                  ? 'btn-ghost text-slate-400'
                  : 'btn-ghost text-slate-600'
            }`}
            onClick={() => setActiveTab('finances')}
          >
            {t('admin.users.tabFinances')}
          </button>
          <button
            type="button"
            className={`btn btn-xs rounded-lg cursor-pointer ${
              activeTab === 'orders'
                ? 'btn-primary text-white'
                : isDark
                  ? 'btn-ghost text-slate-400'
                  : 'btn-ghost text-slate-600'
            }`}
            onClick={() => setActiveTab('orders')}
          >
            {t('admin.users.tabOrders')} ({orders.length})
          </button>
          <button
            type="button"
            className={`btn btn-xs rounded-lg cursor-pointer ${
              activeTab === 'receipts'
                ? 'btn-primary text-white'
                : isDark
                  ? 'btn-ghost text-slate-400'
                  : 'btn-ghost text-slate-600'
            }`}
            onClick={() => setActiveTab('receipts')}
          >
            {t('admin.users.tabReceipts')} ({receipts.length})
          </button>
        </div>

        {/* Sub-tab 1: Finances Grid */}
        {activeTab === 'finances' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className={`p-3 rounded-xl border ${subCardClass}`}>
              <span className={`text-[11px] block ${textMuted}`}>
                {t('admin.users.userCurBalance')}
              </span>
              <div
                className={`text-sm sm:text-base font-bold font-mono mt-1 ${
                  isDark ? 'text-emerald-400' : 'text-emerald-600'
                }`}
              >
                {formatMoney(user.balance)} {t('common.currency')}
              </div>
            </div>

            <div className={`p-3 rounded-xl border ${subCardClass}`}>
              <span className={`text-[11px] block ${textMuted}`}>
                {t('admin.users.userTotalDeposit')}
              </span>
              <div className={`text-sm sm:text-base font-bold font-mono mt-1 ${textPrimary}`}>
                {formatMoney(summary.totalDeposit)} {t('common.currency')}
              </div>
            </div>

            <div className={`p-3 rounded-xl border ${subCardClass}`}>
              <span className={`text-[11px] block ${textMuted}`}>
                {t('admin.users.userTotalSpend')}
              </span>
              <div className={`text-sm sm:text-base font-bold font-mono mt-1 ${textPrimary}`}>
                {formatMoney(summary.totalSpend)} {t('common.currency')}
              </div>
            </div>

            <div className={`p-3 rounded-xl border ${subCardClass}`}>
              <span className={`text-[11px] block ${textMuted}`}>
                {t('admin.users.userActiveConfigs')}
              </span>
              <div className="text-sm sm:text-base font-bold text-indigo-500 font-mono mt-1">
                {formatNumber(summary.activeConfigsCount)}
              </div>
            </div>

            <div className={`p-3 rounded-xl border ${subCardClass}`}>
              <span className={`text-[11px] block ${textMuted}`}>
                {t('admin.users.userApprovedReceipts')}
              </span>
              <div
                className={`text-sm sm:text-base font-bold font-mono mt-1 ${
                  isDark ? 'text-emerald-400' : 'text-emerald-600'
                }`}
              >
                {formatNumber(summary.receiptsApprovedCount)}
              </div>
            </div>

            <div className={`p-3 rounded-xl border ${subCardClass}`}>
              <span className={`text-[11px] block ${textMuted}`}>
                {t('admin.users.userAuditEvents')}
              </span>
              <div className={`text-sm sm:text-base font-bold font-mono mt-1 ${textSecondary}`}>
                {formatNumber(summary.auditEventsCount)}
              </div>
            </div>
          </div>
        )}

        {/* Sub-tab 2: Orders List */}
        {activeTab === 'orders' && (
          <div className="space-y-2">
            {orders.length === 0 ? (
              <p className={`text-xs text-center py-4 ${textMuted}`}>{t('admin.users.noOrders')}</p>
            ) : (
              orders.map((order) => (
                <div
                  key={order.id}
                  className={`p-3 rounded-xl border flex items-center justify-between text-xs ${subCardClass}`}
                >
                  <div>
                    <div className={`font-semibold ${textPrimary}`}>
                      {order.packageName || t('admin.users.orderPackage')}
                    </div>
                    <div className={`text-[11px] font-mono ${textMuted}`}>ID: {order.id}</div>
                  </div>
                  <div className="text-right rtl:text-left">
                    <div
                      className={`font-mono font-bold ${
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
              <p className={`text-xs text-center py-4 ${textMuted}`}>
                {t('admin.users.noReceipts')}
              </p>
            ) : (
              receipts.map((rec) => (
                <div
                  key={rec.id}
                  className={`p-3 rounded-xl border flex items-center justify-between text-xs ${subCardClass}`}
                >
                  <div>
                    <div className={`font-semibold font-mono ${textPrimary}`}>
                      {formatMoney(rec.amount)} {t('common.currency')}
                    </div>
                    <div className={`text-[11px] font-mono ${textMuted}`}>ID: {rec.id}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`badge badge-xs text-[10px] font-medium ${
                        rec.status === 'approved'
                          ? 'badge-success text-white'
                          : rec.status === 'rejected'
                            ? 'badge-error text-white'
                            : 'badge-warning'
                      }`}
                    >
                      {rec.status}
                    </span>
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
          className={`modal-action flex justify-between items-center pt-2 border-t ${
            isDark ? 'border-white/10' : 'border-slate-200'
          }`}
        >
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1.5 text-xs text-white rounded-xl cursor-pointer"
            onClick={() => {
              onOpenBalanceModal(user);
            }}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>{t('admin.users.btnChangeBalance')}</span>
          </button>

          <button
            type="button"
            className={`btn btn-ghost btn-sm text-xs border rounded-xl cursor-pointer ${
              isDark ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-700'
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
