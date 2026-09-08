import React from 'react';
import { Copy, Eye, Wallet, RotateCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Card } from '@/shared/components/ui/Card.js';
import type { UserProfile } from '@/shared/types/admin.js';

interface UserTableProps {
  users: UserProfile[];
  onInspect: (telegramId: number) => void;
  onOpenBalanceModal: (user: UserProfile) => void;
  onCopyId: (id: string, key: string) => void;
  inspectingId: number | null;
}

export const UserTable: React.FC<UserTableProps> = ({
  users,
  onInspect,
  onOpenBalanceModal,
  onCopyId,
  inspectingId,
}) => {
  const { t } = useLanguage();
  const { formatMoney } = useFormatters();
  const { isDark, textMuted } = useThemeTokens();

  return (
    <Card className="hidden md:block overflow-x-auto">
      <table className="table table-zebra w-full text-xs">
        <thead
          className={`text-xs border-b ${
            isDark ? 'text-zinc-400 border-white/10' : 'text-slate-500 border-slate-200'
          }`}
        >
          <tr>
            <th>{t('admin.users.colId')}</th>
            <th>{t('admin.users.colUsername')}</th>
            <th>{t('admin.users.colName')}</th>
            <th>{t('admin.users.colBalance')}</th>
            <th>{t('admin.users.colActiveSubs')}</th>
            <th className="text-center">{t('admin.users.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isInspectingThis = inspectingId === u.telegramId;
            return (
              <tr
                key={u.telegramId}
                className={`transition-colors ${
                  isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-slate-50'
                }`}
              >
                <td className="font-mono">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 hover:text-indigo-400 cursor-pointer"
                    onClick={() => onCopyId(String(u.telegramId), `table-user-${u.telegramId}`)}
                  >
                    <span dir="ltr">{u.telegramId}</span>
                    <Copy className={`w-3 h-3 ${textMuted}`} />
                  </button>
                </td>
                <td className="text-indigo-500 font-mono">
                  {u.username ? (
                    <span dir="ltr" className="inline-block unicode-isolate">
                      @{u.username}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</td>
                <td
                  className={`font-bold font-mono ${
                    isDark ? 'text-emerald-400' : 'text-emerald-600'
                  }`}
                >
                  {formatMoney(u.balance)} {t('common.currency')}
                </td>
                <td>
                  <span
                    className={`badge badge-sm text-[10px] ${
                      u.activeSubscriptionCount > 0 ? 'badge-success text-white' : 'badge-ghost'
                    }`}
                  >
                    {t('admin.users.activeSubsCount', { count: u.activeSubscriptionCount })}
                  </span>
                </td>
                <td>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      className={`btn btn-ghost btn-xs gap-1 border rounded-lg cursor-pointer ${
                        isDark
                          ? 'border-white/10 text-slate-300 hover:bg-white/10'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                      disabled={isInspectingThis}
                      onClick={() => onInspect(u.telegramId)}
                    >
                      {isInspectingThis ? (
                        <RotateCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                      <span>{t('admin.users.btnDetails')}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-xs gap-1 text-white shadow-sm rounded-lg cursor-pointer"
                      onClick={() => onOpenBalanceModal(u)}
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      <span>{t('admin.users.btnChangeBalance')}</span>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
};
