import React from 'react';
import { Copy, Check, Eye, Wallet, Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import type { UserProfile } from '@/shared/types/admin.js';

interface UserTableProps {
  users: UserProfile[];
  onInspect: (telegramId: number) => void;
  onOpenBalanceModal: (user: UserProfile) => void;
  onCopyId: (id: string, key: string) => void;
  isCopied?: (key: string) => boolean;
  inspectingId: number | null;
  isInspecting?: boolean;
}

export const UserTable: React.FC<UserTableProps> = ({
  users,
  onInspect,
  onOpenBalanceModal,
  onCopyId,
  isCopied = () => false,
  inspectingId,
  isInspecting = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber, formatId, sanitizeDisplayName } = useFormatters();

  return (
    <Card className="hidden md:block overflow-x-auto">
      <table className="w-full text-xs text-start border-collapse">
        <thead className="text-[11px] font-semibold border-b text-ink-muted border-line bg-surface-2">
          <tr>
            <th className="py-3 px-4 text-start">{t('admin.users.colId')}</th>
            <th className="py-3 px-4 text-start">{t('admin.users.colUsername')}</th>
            <th className="py-3 px-4 text-start">{t('admin.users.colName')}</th>
            <th className="py-3 px-4 text-start">{t('admin.users.colBalance')}</th>
            <th className="py-3 px-4 text-start">{t('admin.users.colActiveSubs')}</th>
            <th className="py-3 px-4 text-center">{t('admin.users.colActions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {users.map((u) => {
            const isInspectingThis = inspectingId === u.telegramId && isInspecting;
            const copyKey = `table-user-${u.telegramId}`;
            const copied = isCopied(copyKey);
            return (
              <tr key={u.telegramId} className="transition-colors hover:bg-surface-2">
                <td className="py-3 px-4 tnum">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2 rounded-ctl border tnum text-xs press rs-focus cursor-pointer bg-surface-2 border-line hover:border-line-strong text-ink-soft"
                    onClick={() => onCopyId(String(u.telegramId), copyKey)}
                    title={t('common.copy')}
                  >
                    <bdi dir="ltr" className="tnum font-medium">
                      #{formatId(u.telegramId)}
                    </bdi>
                    {copied ? (
                      <Check className="w-3 h-3 text-ok-fg shrink-0" />
                    ) : (
                      <Copy className="w-3 h-3 text-ink-muted shrink-0" />
                    )}
                  </button>
                </td>
                <td className="py-3 px-4 text-brand-fg tnum">
                  {u.username ? (
                    <bdi dir="ltr" className="font-medium">
                      @{u.username}
                    </bdi>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td className="py-3 px-4 font-medium text-ink">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>
                      {
                        sanitizeDisplayName(
                          u.firstName,
                          u.lastName,
                          u.username ? `@${u.username}` : '—'
                        ).displayName
                      }
                    </span>
                    {u.group && (u.group.isAssigned || u.group.badge) && (
                      <Badge variant="primary" size="xs" className="shrink-0">
                        {u.group.badge || u.group.name}
                      </Badge>
                    )}
                    {u.isBanned && (
                      <Badge variant="error" size="xs" className="shrink-0">
                        {t('admin.users.bannedBadge')}
                      </Badge>
                    )}
                  </div>
                </td>
                <td
                  className={`py-3 px-4 font-semibold tnum ${
                    u.balance < 0 ? 'text-danger-fg' : 'text-ok-fg'
                  }`}
                >
                  <bdi dir="ltr">{formatMoney(u.balance)}</bdi>{' '}
                  <span className="text-[11px] font-normal text-ink-muted">
                    {t('common.currency')}
                  </span>
                </td>
                <td className="py-3 px-4">
                  {u.activeSubscriptionCount > 0 ? (
                    <Badge variant="success" dot size="xs">
                      {t('admin.users.activeSubsCount', {
                        count: formatNumber(u.activeSubscriptionCount),
                      })}
                    </Badge>
                  ) : (
                    <Badge variant="neutral" size="xs">
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
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-fg" />
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
