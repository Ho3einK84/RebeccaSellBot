import React from 'react';
import { Copy, Eye, Wallet, RotateCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
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
  const { formatMoney, formatNumber } = useFormatters();
  const { isDark, textMuted, textPrimary } = useThemeTokens();

  return (
    <Card className="hidden md:block overflow-x-auto shadow-xs">
      <table className="w-full text-xs text-start border-collapse">
        <thead
          className={`text-[11px] font-semibold border-b ${
            isDark
              ? 'text-zinc-400 border-white/[0.08] bg-white/[0.01]'
              : 'text-slate-500 border-slate-200/80 bg-slate-50/70'
          }`}
        >
          <tr>
            <th className="py-3 px-4 text-start">{t('admin.users.colId')}</th>
            <th className="py-3 px-4 text-start">{t('admin.users.colUsername')}</th>
            <th className="py-3 px-4 text-start">{t('admin.users.colName')}</th>
            <th className="py-3 px-4 text-start">{t('admin.users.colBalance')}</th>
            <th className="py-3 px-4 text-start">{t('admin.users.colActiveSubs')}</th>
            <th className="py-3 px-4 text-center">{t('admin.users.colActions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04]">
          {users.map((u) => {
            const isInspectingThis = inspectingId === u.telegramId;
            return (
              <tr
                key={u.telegramId}
                className={`transition-colors duration-150 ${
                  isDark ? 'hover:bg-white/[0.025]' : 'hover:bg-slate-50/80'
                }`}
              >
                <td className="py-3 px-4 font-mono">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border font-mono text-xs transition-all active:scale-95 cursor-pointer bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 hover:border-indigo-400/40"
                    onClick={() => onCopyId(String(u.telegramId), `table-user-${u.telegramId}`)}
                    title={t('common.copy')}
                  >
                    <span dir="ltr">{u.telegramId}</span>
                    <Copy className={`w-3 h-3 ${textMuted}`} />
                  </button>
                </td>
                <td className="py-3 px-4 text-indigo-500 font-mono">
                  {u.username ? (
                    <span dir="ltr" className="inline-block unicode-isolate font-medium">
                      @{u.username}
                    </span>
                  ) : (
                    <span className={textMuted}>—</span>
                  )}
                </td>
                <td className={`py-3 px-4 font-medium ${textPrimary}`}>
                  {[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}
                </td>
                <td
                  className={`py-3 px-4 font-bold font-mono ${
                    isDark ? 'text-emerald-400' : 'text-emerald-600'
                  }`}
                >
                  {formatMoney(u.balance)}{' '}
                  <span className="text-[10px] font-normal text-slate-400">
                    {t('common.currency')}
                  </span>
                </td>
                <td className="py-3 px-4">
                  {u.activeSubscriptionCount > 0 ? (
                    <Badge variant="success" dot pulse className="text-[10px]">
                      {t('admin.users.activeSubsCount', {
                        count: formatNumber(u.activeSubscriptionCount),
                      })}
                    </Badge>
                  ) : (
                    <Badge variant="neutral" className="text-[10px]">
                      {t('common.zeroActive')}
                    </Badge>
                  )}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border text-xs font-medium cursor-pointer transition-all active:scale-95 ${
                        isDark
                          ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 shadow-xs'
                      }`}
                      disabled={isInspectingThis}
                      onClick={() => onInspect(u.telegramId)}
                    >
                      {isInspectingThis ? (
                        <RotateCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                      ) : (
                        <Eye className="w-3.5 h-3.5 opacity-70" />
                      )}
                      <span>{t('admin.users.btnDetails')}</span>
                    </button>
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
                        isDark
                          ? 'bg-indigo-500/15 hover:bg-indigo-500/25 border-indigo-500/25 text-indigo-300 shadow-xs'
                          : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200/80 text-indigo-700 shadow-xs'
                      }`}
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
