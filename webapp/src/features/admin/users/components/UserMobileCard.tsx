import React from 'react';
import { Copy, Wallet, Eye, RotateCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import type { UserProfile } from '@/shared/types/admin.js';

interface UserMobileCardProps {
  user: UserProfile;
  onInspect: (telegramId: number) => void;
  onOpenBalanceModal: (user: UserProfile) => void;
  onCopyId: (id: string, key: string) => void;
  isCopied: boolean;
  inspecting?: boolean;
}

export const UserMobileCard: React.FC<UserMobileCardProps> = ({
  user,
  onInspect,
  onOpenBalanceModal,
  onCopyId,
  isCopied,
  inspecting = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber, sanitizeDisplayName } = useFormatters();
  const { isDark, subCardClass, textPrimary, textMuted } = useThemeTokens();

  const { displayName } = sanitizeDisplayName(user.firstName, user.lastName, t('user.guestUser'));

  return (
    <Card className="p-3.5 sm:p-4 space-y-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-white/20 group">
      {/* User Info Header */}
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Avatar name={user.firstName} username={user.username} size="md" />
          <div className="min-w-0 flex-1">
            <div className={`font-bold text-sm tracking-tight truncate ${textPrimary}`}>
              {displayName}
            </div>
            <div className="text-xs font-mono mt-0.5">
              {user.username ? (
                <span
                  dir="ltr"
                  className="inline-block unicode-isolate font-medium text-indigo-600 dark:text-indigo-400"
                >
                  @{user.username}
                </span>
              ) : (
                <span className={`font-sans ${textMuted}`}>{t('admin.users.noUsername')}</span>
              )}
            </div>
          </div>
        </div>

        {/* Telegram ID Chip */}
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded-lg border transition-all active:scale-95 shrink-0 cursor-pointer ${
            isDark
              ? 'bg-white/[0.04] border-white/10 hover:border-white/20 text-zinc-300'
              : 'bg-slate-50 border-slate-200/80 hover:border-slate-300 text-slate-700 shadow-xs'
          }`}
          onClick={() => onCopyId(String(user.telegramId), `user-${user.telegramId}`)}
          title={t('common.copy')}
        >
          <span className="text-[10px] opacity-50">#</span>
          <span dir="ltr">{user.telegramId}</span>
          {isCopied ? (
            <span className="text-[10px] text-emerald-500 font-sans font-medium">
              {t('common.copied')}
            </span>
          ) : (
            <Copy className={`w-2.5 h-2.5 ${textMuted}`} />
          )}
        </button>
      </div>

      {/* Financial & Status Metrics */}
      <div
        className={`flex items-center justify-between py-2 px-3 rounded-xl border text-xs ${subCardClass}`}
      >
        <div className="flex items-center gap-1.5">
          <Wallet className={`w-3.5 h-3.5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />
          <span
            className={`font-bold text-sm font-mono ${
              isDark ? 'text-emerald-400' : 'text-emerald-600'
            }`}
          >
            {formatMoney(user.balance)}
          </span>
          <span className={`text-[11px] ${textMuted}`}>{t('common.currency')}</span>
        </div>

        <div>
          {user.activeSubscriptionCount > 0 ? (
            <Badge variant="success" dot pulse className="text-[10px]">
              {t('admin.users.activeSubsCount', {
                count: formatNumber(user.activeSubscriptionCount),
              })}
            </Badge>
          ) : (
            <Badge variant="neutral" className="text-[10px]">
              {t('common.zeroActive')}
            </Badge>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <button
          type="button"
          className={`flex items-center justify-center gap-1.5 h-8.5 px-3 rounded-xl border text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
            isDark
              ? 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-zinc-200'
              : 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-800 shadow-xs'
          }`}
          disabled={inspecting}
          onClick={() => onInspect(user.telegramId)}
        >
          {inspecting ? (
            <RotateCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
          ) : (
            <Eye className={`w-3.5 h-3.5 ${textMuted}`} />
          )}
          <span>{t('admin.users.btnDetails')}</span>
        </button>

        <button
          type="button"
          className={`flex items-center justify-center gap-1.5 h-8.5 px-3 rounded-xl border text-xs font-semibold transition-all active:scale-[0.98] cursor-pointer ${
            isDark
              ? 'bg-indigo-500/15 hover:bg-indigo-500/25 border-indigo-500/25 text-indigo-300 shadow-xs'
              : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200/80 text-indigo-700 shadow-xs'
          }`}
          onClick={() => onOpenBalanceModal(user)}
        >
          <Wallet className="w-3.5 h-3.5" />
          <span>{t('admin.users.btnChangeBalance')}</span>
        </button>
      </div>
    </Card>
  );
};
