import React, { useState } from 'react';
import {
  Wallet,
  CreditCard,
  Copy,
  Check,
  Send,
  History,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import {
  openTelegramLinkAndMinimize,
  minimizeOrCloseWebApp,
} from '@/shared/lib/telegramNavigation.js';
import { TransactionItem } from '@/features/user-portal/components/TransactionItem.js';
import { formatCardNumberSpaced } from '@/shared/lib/formatters.js';
import { useUserTransactions } from '../hooks/useUserPortalData.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { Pagination } from '@/shared/components/ui/Pagination.js';
import { SkeletonList } from '@/shared/components/ui/Skeleton.js';
import type {
  UserPortalProfile,
  UserPortalSettings,
  UserTransactionRecord,
  PendingReceiptInfo,
} from '@/shared/types/userPortal.js';

interface WalletTabProps {
  profile: UserPortalProfile | null;
  settings: UserPortalSettings | null;
  transactions: UserTransactionRecord[];
  pendingReceipt?: PendingReceiptInfo | null;
  onNotify: (message: string) => void;
}

export const WalletTab: React.FC<WalletTabProps> = ({
  profile,
  settings,
  transactions,
  pendingReceipt,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { formatToman, formatNumber } = useFormatters();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();

  const [page, setPage] = useState<number>(1);

  const { data: txQueryData, isFetching: isFetchingTx } = useUserTransactions(page, 10);
  const isLoadingPage = page > 1 && isFetchingTx && !txQueryData;
  const currentTransactions = txQueryData?.transactions ?? (page === 1 ? transactions : []);
  const totalPages = txQueryData?.totalPages ?? 1;

  const currency = settings?.currency || t('common.currency');
  const balance = profile?.balance ?? 0;
  const availableBalance = profile?.availableBalance ?? 0;
  const cardNumber = settings?.cardNumber || '';
  const cardHolder = settings?.cardHolder || '';
  const minAmount = settings?.topupMinAmount ?? 10_000;
  const maxAmount = settings?.topupMaxAmount ?? 10_000_000;

  const handleCopyCard = async () => {
    if (!cardNumber) return;
    triggerHaptic('light');
    const ok = await copy(cardNumber.replace(/\s+/g, ''), 'bank-card');
    if (ok) {
      onNotify(t('user.wallet.cardCopied'));
    }
  };

  const handleOpenBotForReceipt = (payload = 'receipt') => {
    triggerHaptic('medium');
    const botUser = (settings?.botUsername || '').replace(/^@/, '').trim();
    if (botUser) {
      const url = `https://t.me/${botUser}?start=${payload}`;
      openTelegramLinkAndMinimize(url);
      return;
    }
    minimizeOrCloseWebApp();
  };

  return (
    <div className="w-full flex flex-col gap-5 pb-6">
      {/* Top Wallet Summary */}
      <Card padding="lg" className="flex items-center justify-between gap-3 flex-wrap text-start">
        <div className="flex items-center gap-3.5">
          <IconTile tone="brand" size="lg">
            <Wallet />
          </IconTile>
          <div className="flex flex-col">
            <span className="text-xs text-ink-muted">{t('user.wallet.currentBalance')}</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <bdi dir="ltr" className="text-xl sm:text-2xl tnum font-semibold text-ink">
                {formatToman(availableBalance)}
              </bdi>
              <span className="text-xs text-ink-muted font-medium">{currency}</span>
            </div>
          </div>
        </div>

        {profile?.reservedBalance && profile.reservedBalance > 0 ? (
          <div className="flex flex-col items-end gap-0.5 text-xs text-ink-muted tnum">
            <span>{t('user.wallet.totalLabel').replace('{amount}', formatToman(balance))}</span>
            <span className="text-warn-fg font-medium">
              {t('user.wallet.reservedLabel').replace(
                '{amount}',
                formatToman(profile.reservedBalance)
              )}
            </span>
          </div>
        ) : null}
      </Card>

      {/* Pending Receipt Status Banner */}
      {pendingReceipt && (
        <Card tone="warn" padding="md" className="flex flex-col gap-3 text-start">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-warn shrink-0" aria-hidden="true" />
              <h3 className="text-xs sm:text-sm font-semibold text-ink m-0">
                {t('user.wallet.pendingReceiptTitle')}
              </h3>
            </div>

            <Badge variant="warning" size="xs">
              {t('user.wallet.pendingReceiptStatusLabel')}
            </Badge>
          </div>

          <p className="text-xs leading-relaxed text-ink-soft m-0">
            {t('user.wallet.pendingReceiptSubtitle')}
          </p>

          <div className="rounded-tile border border-warn/25 bg-surface p-3 flex items-center justify-between gap-3 text-xs tnum">
            <div className="flex flex-col">
              <span className="text-[11px] text-ink-muted">
                {t('user.wallet.pendingReceiptAmountLabel')}
              </span>
              <span className="font-semibold text-sm text-ink mt-0.5">
                <bdi dir="ltr">{formatToman(pendingReceipt.amount)}</bdi> {currency}
              </span>
            </div>

            <div className="flex flex-col items-end">
              <span className="text-[11px] text-ink-muted">
                {t('user.wallet.pendingReceiptTrackingId')}
              </span>
              <button
                type="button"
                onClick={async () => {
                  triggerHaptic('light');
                  const ok = await copy(pendingReceipt.id, 'receipt-id');
                  if (ok) {
                    onNotify(t('common.copied'));
                  }
                }}
                className="h-9 inline-flex items-center gap-1.5 text-xs font-mono text-brand-fg hover:underline cursor-pointer px-1.5 rounded-ctl rs-focus"
                aria-label={t('common.copy')}
              >
                <bdi dir="ltr">
                  {pendingReceipt.id.length > 15
                    ? `${pendingReceipt.id.slice(0, 8)}...${pendingReceipt.id.slice(-4)}`
                    : pendingReceipt.id}
                </bdi>
                {isCopied('receipt-id') ? (
                  <Check className="w-3.5 h-3.5 text-ok-fg shrink-0 anim-pop" />
                ) : (
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                )}
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Main Split: Card-to-Card Topup & Transaction Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-7">
          {cardNumber ? (
            <Card padding="lg" className="flex flex-col gap-4 text-start">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-warn-fg shrink-0" />
                  <h3 className="text-sm font-semibold text-ink m-0">
                    {t('user.wallet.cardTopupTitle')}
                  </h3>
                </div>

                <span className="text-[11px] text-ink-muted tnum">
                  {t('user.wallet.topupMinMaxHint')
                    .replace('{min}', formatToman(minAmount))
                    .replace('{max}', formatToman(maxAmount))}
                </span>
              </div>

              <p className="text-xs leading-relaxed text-ink-muted m-0">
                {t('user.wallet.cardTopupDesc')}
              </p>

              {/* Anodized Matte Bank Card Presentation */}
              <div className="rounded-card rs-hero-bank text-obsidian-ink p-4 sm:p-5 flex flex-col justify-between gap-4">
                <div className="flex items-center justify-between gap-2">
                  {/* Minimalist EMV metallic chip mark */}
                  <div
                    className="w-10 h-7 rounded-md bg-gradient-to-br from-amber-200/30 via-amber-300/20 to-amber-500/15 border border-amber-300/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] flex items-center justify-center"
                    aria-hidden="true"
                  >
                    <div className="w-6 h-4 border border-amber-300/40 rounded-xs grid grid-cols-2" />
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-medium text-white/80">
                    <ShieldCheck className="w-4 h-4 text-sky-400" />
                    <span>{t('user.wallet.bankCard')}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 my-1">
                  <span className="text-[11px] text-white/65">{t('user.wallet.cardNumber')}</span>
                  <bdi
                    dir="ltr"
                    className="font-mono text-lg sm:text-xl font-semibold tracking-wider text-amber-300 text-start select-all"
                  >
                    {formatCardNumberSpaced(cardNumber)}
                  </bdi>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-white/10 gap-3">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] text-white/65">{t('user.wallet.cardHolder')}</span>
                    <span className="text-xs sm:text-sm font-semibold text-white truncate">
                      {cardHolder || '—'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleCopyCard()}
                    className={`h-11 px-3.5 rounded-ctl font-medium text-xs inline-flex items-center justify-center gap-1.5 press rs-focus cursor-pointer shrink-0 border transition-colors ${
                      isCopied('bank-card')
                        ? 'bg-ok border-ok text-white'
                        : 'bg-white/12 hover:bg-white/20 text-white border-white/20'
                    }`}
                    aria-label={t('user.wallet.copyCard')}
                  >
                    {isCopied('bank-card') ? (
                      <>
                        <Check className="w-3.5 h-3.5 anim-pop" />
                        <span>{t('user.wallet.cardCopied')}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>{t('user.wallet.copyCard')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Step-by-Step Instructions */}
              <Card subCard padding="md" className="flex flex-col gap-3">
                {[
                  { num: 1, title: t('user.wallet.step1Title'), desc: t('user.wallet.step1Desc') },
                  { num: 2, title: t('user.wallet.step2Title'), desc: t('user.wallet.step2Desc') },
                  { num: 3, title: t('user.wallet.step3Title'), desc: t('user.wallet.step3Desc') },
                ].map((step) => (
                  <div key={step.num} className="flex items-start gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-brand-soft border border-brand/25 text-brand-fg flex items-center justify-center font-semibold text-xs shrink-0 tnum">
                      {formatNumber(step.num)}
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-semibold text-ink">{step.title}</span>
                      <span className="text-xs text-ink-muted leading-snug">{step.desc}</span>
                    </div>
                  </div>
                ))}
              </Card>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
                <Button
                  size="md"
                  variant="primary"
                  onClick={() => handleOpenBotForReceipt('receipt')}
                  className="w-full sm:flex-1"
                >
                  <Send className="w-4 h-4 shrink-0" />
                  <span>{t('user.wallet.sendReceiptDirect')}</span>
                </Button>

                <Button
                  size="md"
                  variant="secondary"
                  onClick={() => handleOpenBotForReceipt('topup')}
                  className="w-full sm:w-auto shrink-0"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <span>{t('user.wallet.openBotTopup')}</span>
                </Button>
              </div>
            </Card>
          ) : (
            <Card padding="lg" className="flex flex-col items-center text-center gap-3.5">
              <IconTile tone="warn" size="lg">
                <CreditCard />
              </IconTile>
              <div className="flex flex-col gap-1 max-w-sm">
                <h3 className="text-sm font-semibold text-ink m-0">
                  {t('user.wallet.cardTopupUnavailableTitle')}
                </h3>
                <p className="text-xs text-ink-muted leading-relaxed m-0">
                  {t('user.wallet.cardTopupUnavailableDesc')}
                </p>
              </div>
              <Button size="md" variant="primary" onClick={() => handleOpenBotForReceipt('topup')}>
                <ExternalLink className="w-4 h-4 shrink-0" />
                <span>{t('user.wallet.topupInBot')}</span>
              </Button>
            </Card>
          )}
        </div>

        {/* Transaction History Ledger */}
        <section className="lg:col-span-5 flex flex-col gap-3">
          <SectionHeader icon={<History />} title={t('user.wallet.txHistory')} />

          {isLoadingPage ? (
            <SkeletonList count={3} />
          ) : currentTransactions.length === 0 ? (
            <Card padding="lg" className="text-center text-xs text-ink-muted">
              {t('user.wallet.txEmpty')}
            </Card>
          ) : (
            <div className="flex flex-col gap-2 anim-stagger">
              {currentTransactions.map((tx) => (
                <TransactionItem key={tx.id} tx={tx} currency={currency} />
              ))}

              <Pagination
                page={page}
                totalPages={totalPages}
                disabled={isFetchingTx}
                prevLabel={t('user.wallet.paginationPrev')}
                nextLabel={t('user.wallet.paginationNext')}
                pageLabel={t('user.wallet.paginationPage')
                  .replace('{page}', formatNumber(page))
                  .replace('{totalPages}', formatNumber(totalPages))}
                onPageChange={(nextPage) => {
                  triggerHaptic('selection');
                  setPage(nextPage);
                }}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
