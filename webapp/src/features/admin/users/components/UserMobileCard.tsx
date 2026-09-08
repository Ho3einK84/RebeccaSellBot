import React from 'react';
import { Copy, Wallet, Eye, RotateCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Avatar } from '@/shared/components/ui/Avatar.js';
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
  const { formatMoney, sanitizeDisplayName } = useFormatters();
  const { isDark, subCardClass, textPrimary, textMuted } = useThemeTokens();

  const { displayName } = sanitizeDisplayName(user.firstName, user.lastName, t('user.guestUser'));

  return (
    <Card className="p-3.5 sm:p-4 space-y-3 transition-all hover:border-indigo-500/40">
      {/* User Info Header */}
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Avatar name={user.firstName} username={user.username} size="md" />
          <div className="min-w-0 flex-1">
            <div className={`font-bold text-sm truncate ${textPrimary}`}>{displayName}</div>
            <div className="text-xs text-indigo-500 font-mono mt-0.5">
              {user.username ? (
                <span dir="ltr" className="inline-block unicode-isolate font-medium">
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
          className={`flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-lg border transition-all active:scale-95 shrink-0 cursor-pointer ${
            isDark
              ? 'bg-white/[0.04] border-white/10 hover:border-white/20 text-zinc-300'
              : 'bg-slate-100 border-slate-200 hover:border-slate-300 text-slate-700'
          }`}
          onClick={() => onCopyId(String(user.telegramId), `user-${user.telegramId}`)}
        >
          <Copy className={`w-3 h-3 ${textMuted}`} />
          <span dir="ltr">{user.telegramId}</span>
          {isCopied && (
            <span className="text-[10px] text-emerald-500 font-sans font-medium">
              {t('common.copied')}
            </span>
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
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                isDark
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 status-pulse" />
              <span>
                {t('admin.users.activeSubsCount', { count: user.activeSubscriptionCount })}
              </span>
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] border ${
                isDark
                  ? 'bg-white/5 border-white/5 text-zinc-400'
                  : 'bg-slate-100 border-slate-200 text-slate-500'
              }`}
            >
              <span>{t('common.zeroActive')}</span>
            </span>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <button
          type="button"
          className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
            isDark
              ? 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-slate-200'
              : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-800 shadow-2xs'
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
          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-sm transition-all active:scale-[0.98] cursor-pointer"
          onClick={() => onOpenBalanceModal(user)}
        >
          <Wallet className="w-3.5 h-3.5" />
          <span>{t('admin.users.btnChangeBalance')}</span>
        </button>
      </div>
    </Card>
  );
};
