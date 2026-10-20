import React from 'react';
import { Copy, Eye, Wallet, RotateCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
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
  const { textMuted, textPrimary } = useThemeTokens();

  return (
    <Card className="hidden md:block overflow-x-auto shadow-xs">
      <table className="w-full text-xs text-start border-collapse">
        <thead
          className={`text-[11px] font-semibold border-b text-ink-muted border-line/[0.08] bg-surface/[0.01]`}
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
        <tbody className="divide-y divide-line/60">
          {users.map((u) => {
            const isInspectingThis = inspectingId === u.telegramId;
            return (
              <tr
                key={u.telegramId}
                className={`transition-colors duration-150 hover:bg-surface/[0.025]`}
              >
                <td className="py-3 px-4 tnum">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border tnum text-xs transition-all active:scale-95 cursor-pointer bg-black/5 border-black/5 hover:border-brand/40"
                    onClick={() => onCopyId(String(u.telegramId), `table-user-${u.telegramId}`)}
                    title={t('common.copy')}
                  >
                    <span dir="ltr">{u.telegramId}</span>
                    <Copy className={`w-3 h-3 ${textMuted}`} />
                  </button>
                </td>
                <td className="py-3 px-4 text-brand tnum">
                  {u.username ? (
                    <span dir="ltr" className="inline-block unicode-isolate font-medium">
                      @{u.username}
                    </span>
                  ) : (
                    <span className={textMuted}>—</span>
                  )}
                </td>
                <td className={`py-3 px-4 font-medium ${textPrimary}`}>
                  <div className="flex items-center gap-2">
                    <span>{[u.firstName, u.lastName].filter(Boolean).join('') || '—'}</span>
                    {u.isBanned && (
                      <Badge variant="error" className="text-[10px] shrink-0">
                        {t('admin.users.bannedBadge')}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className={`py-3 px-4 font-bold tnum text-ok`}>
                  {formatMoney(u.balance)}
                  {''}
                  <span className="text-[10px] font-normal text-ink-muted">
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
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isInspectingThis}
                      onClick={() => onInspect(u.telegramId)}
                    >
                      {isInspectingThis ? (
                        <RotateCw className="w-3.5 h-3.5 animate-spin text-brand" />
                      ) : (
                        <Eye className="w-3.5 h-3.5 opacity-70" />
                      )}
                      <span>{t('admin.users.btnDetails')}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => onOpenBalanceModal(u)}
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      <span>{t('admin.users.btnChangeBalance')}</span>
                    </Button>
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
