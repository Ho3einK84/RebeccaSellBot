import React from 'react';
import { Users, Gift, Copy, Check, Share2, Award, UserCheck, Percent } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import type { UserPortalProfile, UserPortalSettings } from '@/shared/types/userPortal.js';
import { LuckyWheelSection } from '@/features/user-portal/components/LuckyWheelSection.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';

interface ReferralTabProps {
  profile: UserPortalProfile | null;
  settings: UserPortalSettings | null;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const ReferralTab: React.FC<ReferralTabProps> = ({ profile, settings, onNotify }) => {
  const { t } = useLanguage();
  const { formatToman, formatNumber } = useFormatters();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();

  const currency = settings?.currency || t('common.currency');
  const referralCode = profile?.referralCode || '';
  const cleanBotUsername = (settings?.botUsername || '').replace(/^@/, '').trim();
  const inviteLink =
    referralCode && cleanBotUsername
      ? `https://t.me/${cleanBotUsername}?start=${referralCode}`
      : '';

  const referralBonusToman = settings?.referralBonusToman ?? 0;
  const cashbackPercent = settings?.cashbackPercent ?? 0;

  const handleCopyLink = async () => {
    if (!inviteLink) return;
    triggerHaptic('light');
    const ok = await copy(inviteLink, 'referral-link');
    if (ok) {
      onNotify(t('user.referral.linkCopied'), 'success');
    }
  };

  const handleCopyCode = async () => {
    if (!referralCode) return;
    triggerHaptic('light');
    const ok = await copy(referralCode, 'referral-code');
    if (ok) {
      onNotify(t('user.referral.codeCopied'), 'success');
    }
  };

  const handleShareTelegram = () => {
    triggerHaptic('medium');
    if (!inviteLink) return;
    const shareText = encodeURIComponent(t('user.referral.shareMessage'));
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${shareText}`;

    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="w-full flex flex-col gap-5 pb-6 text-start">
      {/* Unified Rewards Hub: Interactive Lucky Wheel */}
      <LuckyWheelSection currency={currency} onNotify={onNotify} />

      {/* Referrals & Cashback Program */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left column: Program Summary + 4 Complete Metrics */}
        <div className="lg:col-span-5 flex flex-col gap-3.5">
          <Card padding="lg" className="flex flex-col gap-3">
            <div className="flex items-start gap-3.5">
              <IconTile tone="accent" size="lg">
                <Gift />
              </IconTile>
              <div className="flex flex-col min-w-0">
                <h2 className="text-sm sm:text-base font-semibold text-ink m-0">
                  {t('user.referral.title')}
                </h2>
                <p className="mt-1 text-xs text-ink-muted leading-relaxed m-0">
                  {t('user.referral.ruleDesc')}
                </p>
              </div>
            </div>

            {(referralBonusToman > 0 || cashbackPercent > 0) && (
              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-line">
                {referralBonusToman > 0 && (
                  <Badge variant="success" size="xs" className="tnum">
                    {t('user.referral.bonusPerFriend')
                      .replace('{amount}', formatToman(referralBonusToman))
                      .replace('{currency}', currency)}
                  </Badge>
                )}
                {cashbackPercent > 0 && (
                  <Badge variant="primary" size="xs" className="tnum">
                    {t('user.referral.cashbackRate').replace(
                      '{percent}',
                      formatNumber(cashbackPercent)
                    )}
                  </Badge>
                )}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-3 anim-stagger">
            <Card padding="md" className="flex flex-col items-center text-center gap-1.5">
              <IconTile tone="accent" size="sm">
                <Users />
              </IconTile>
              <span className="text-xs text-ink-muted mt-0.5">
                {t('user.referral.statsInvited')}
              </span>
              <span className="tnum text-lg sm:text-xl font-semibold text-ink">
                {formatNumber(profile?.referredUserCount ?? 0)}
              </span>
            </Card>

            <Card padding="md" className="flex flex-col items-center text-center gap-1.5">
              <IconTile tone="brand" size="sm">
                <UserCheck />
              </IconTile>
              <span className="text-xs text-ink-muted mt-0.5">
                {t('user.referral.statsActiveBuyers')}
              </span>
              <span className="tnum text-lg sm:text-xl font-semibold text-ink">
                {formatNumber(profile?.activeBuyersCount ?? 0)}
              </span>
            </Card>

            <Card padding="md" className="flex flex-col items-center text-center gap-1.5">
              <IconTile tone="ok" size="sm">
                <Award />
              </IconTile>
              <span className="text-xs text-ink-muted mt-0.5">
                {t('user.referral.statsEarned')}
              </span>
              <div className="flex items-baseline justify-center gap-1 flex-wrap tnum text-base sm:text-lg font-semibold text-ok-fg">
                <bdi dir="ltr">{formatToman(profile?.referralBonusEarned ?? 0)}</bdi>
                <span className="text-[11px] font-medium text-ink-muted">{currency}</span>
              </div>
            </Card>

            <Card padding="md" className="flex flex-col items-center text-center gap-1.5">
              <IconTile tone="info" size="sm">
                <Percent />
              </IconTile>
              <span className="text-xs text-ink-muted mt-0.5">
                {t('user.referral.statsCashback')}
              </span>
              <div className="flex items-baseline justify-center gap-1 flex-wrap tnum text-base sm:text-lg font-semibold text-brand-fg">
                <bdi dir="ltr">{formatToman(profile?.cashbackEarned ?? 0)}</bdi>
                <span className="text-[11px] font-medium text-ink-muted">{currency}</span>
              </div>
            </Card>
          </div>
        </div>

        {/* Right column: Code, Link & Share Controls */}
        <Card padding="lg" className="lg:col-span-7 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-soft">{t('user.referral.yourCode')}</span>
            <button
              type="button"
              onClick={() => void handleCopyCode()}
              disabled={!referralCode}
              className="w-full p-3 rounded-tile border border-line bg-surface-2 hover:bg-surface-3 flex items-center justify-between gap-2.5 rs-card-interactive rs-focus cursor-pointer disabled:opacity-50 disabled:pointer-events-none text-start"
            >
              <bdi
                dir="ltr"
                className="font-mono font-medium text-xs sm:text-sm text-brand-fg truncate flex-1 min-w-0 select-all"
              >
                {referralCode || '—'}
              </bdi>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-ctl text-xs font-medium shrink-0 border ${
                  isCopied('referral-code')
                    ? 'bg-ok-soft text-ok-fg border-ok/25'
                    : 'bg-surface text-ink-soft border-line'
                }`}
              >
                {isCopied('referral-code') ? (
                  <>
                    <Check className="w-3.5 h-3.5 anim-pop" />
                    <span>{t('common.copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>{t('common.copy')}</span>
                  </>
                )}
              </span>
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-soft">{t('user.referral.yourLink')}</span>
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              disabled={!inviteLink}
              className="w-full p-3 rounded-tile border border-line bg-surface-2 hover:bg-surface-3 flex items-center justify-between gap-2.5 rs-card-interactive rs-focus cursor-pointer disabled:opacity-50 disabled:pointer-events-none text-start"
            >
              <bdi
                dir="ltr"
                className="font-mono text-xs truncate flex-1 min-w-0 text-ink-soft select-all"
              >
                {inviteLink || '—'}
              </bdi>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-ctl text-xs font-medium shrink-0 border ${
                  isCopied('referral-link')
                    ? 'bg-ok-soft text-ok-fg border-ok/25'
                    : 'bg-surface text-ink-soft border-line'
                }`}
              >
                {isCopied('referral-link') ? (
                  <>
                    <Check className="w-3.5 h-3.5 anim-pop" />
                    <span>{t('common.copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>{t('common.copy')}</span>
                  </>
                )}
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <Button
              size="md"
              variant={isCopied('referral-link') ? 'success' : 'secondary'}
              onClick={() => void handleCopyLink()}
              disabled={!inviteLink}
              block
            >
              {isCopied('referral-link') ? (
                <>
                  <Check className="w-4 h-4 shrink-0 anim-pop" />
                  <span>{t('user.referral.linkCopied')}</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 shrink-0" />
                  <span>{t('user.referral.copyLink')}</span>
                </>
              )}
            </Button>

            <Button
              size="md"
              variant="primary"
              onClick={handleShareTelegram}
              disabled={!inviteLink}
              block
            >
              <Share2 className="w-4 h-4 shrink-0" />
              <span>{t('user.referral.shareTelegram')}</span>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
};
