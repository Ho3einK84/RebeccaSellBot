import React, { useState, useMemo, useEffect } from 'react';
import { Wallet, X, Check, Plus, Minus, Settings2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import type { UserProfile, BalanceOperation } from '@/shared/types/admin.js';

interface BalanceModalProps {
  user: UserProfile | null;
  onClose: () => void;
  onSubmit: (data: { operation: BalanceOperation; amount: number; reason: string }) => void;
  loading?: boolean;
}

export const BalanceModal: React.FC<BalanceModalProps> = ({
  user,
  onClose,
  onSubmit,
  loading = false,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber } = useFormatters();
  const { inputClass, textPrimary, textSecondary } = useThemeTokens();

  const [operation, setOperation] = useState<BalanceOperation>('add');
  const [amountStr, setAmountStr] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    setOperation('add');
    setAmountStr('');
    setReason('');
  }, [user?.telegramId]);

  const numAmount = Number(amountStr);
  const isValidAmount =
    amountStr.trim() !== '' &&
    Number.isSafeInteger(numAmount) &&
    (operation === 'set' ? numAmount >= 0 : numAmount > 0);

  const previewNewBalance = useMemo(() => {
    if (!user) return 0;
    const cur = user.balance;
    if (operation === 'add') return cur + numAmount;
    if (operation === 'deduct') return Math.max(0, cur - numAmount);
    return numAmount;
  }, [user, operation, numAmount]);

  if (!user) return null;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidAmount || !reason.trim()) return;
    onSubmit({ operation, amount: numAmount, reason: reason.trim() });
  };

  const handleClose = () => {
    setAmountStr('');
    setReason('');
    setOperation('add');
    onClose();
  };

  const quickAmounts = [50000, 100000, 200000, 500000, 1000000];
  const quickReasons = [
    t('admin.users.quickReasonCard'),
    t('admin.users.quickReasonCompensation'),
    t('admin.users.quickReasonAdjustment'),
  ];

  return (
    <Modal isOpen={Boolean(user)} onClose={handleClose} maxWidth="md" closeOnBackdrop={!loading}>
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div className="flex items-center gap-2.5 min-w-0">
            <IconTile tone="brand" size="md">
              <Wallet />
            </IconTile>
            <div className="min-w-0">
              <h3 className={`font-semibold text-sm sm:text-base m-0 ${textPrimary}`}>
                {t('admin.modals.balanceTitle')}
              </h3>
              <div className="text-xs tnum text-brand-fg truncate mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>{[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}</span>
                {user.username && <bdi dir="ltr">(@{user.username})</bdi>}
                <span className="opacity-40">·</span>
                <bdi dir="ltr" className="font-mono">
                  #{user.telegramId}
                </bdi>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-ctl text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer shrink-0 rs-focus"
            onClick={handleClose}
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-4">
          <Card subCard padding="sm" className="flex items-center justify-between text-xs">
            <span className={textSecondary}>{t('admin.users.balanceCurLabel')}</span>
            <span className={`font-semibold tnum text-sm sm:text-base ${textPrimary}`}>
              <bdi dir="ltr">{formatMoney(user.balance)}</bdi>{' '}
              <span className="text-xs font-normal text-ink-muted">{t('common.currency')}</span>
            </span>
          </Card>

          <div className="grid grid-cols-3 gap-1 p-1 rounded-tile border text-xs bg-surface-2 border-line">
            <button
              type="button"
              className={`h-9 rounded-ctl font-medium flex items-center justify-center gap-1.5 cursor-pointer select-none rs-focus ${
                operation === 'add'
                  ? 'bg-ok-soft text-ok-fg font-semibold border border-ok/30'
                  : 'text-ink-muted hover:text-ink border border-transparent'
              }`}
              onClick={() => setOperation('add')}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('admin.modals.balanceOpAdd')}</span>
            </button>

            <button
              type="button"
              className={`h-9 rounded-ctl font-medium flex items-center justify-center gap-1.5 cursor-pointer select-none rs-focus ${
                operation === 'deduct'
                  ? 'bg-danger-soft text-danger-fg font-semibold border border-danger/30'
                  : 'text-ink-muted hover:text-ink border border-transparent'
              }`}
              onClick={() => setOperation('deduct')}
            >
              <Minus className="w-3.5 h-3.5" />
              <span>{t('admin.modals.balanceOpDeduct')}</span>
            </button>

            <button
              type="button"
              className={`h-9 rounded-ctl font-medium flex items-center justify-center gap-1.5 cursor-pointer select-none rs-focus ${
                operation === 'set'
                  ? 'bg-brand-soft text-brand-fg font-semibold border border-brand/30'
                  : 'text-ink-muted hover:text-ink border border-transparent'
              }`}
              onClick={() => setOperation('set')}
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>{t('admin.modals.balanceOpSet')}</span>
            </button>
          </div>

          <div className="space-y-2">
            <label className={`text-xs font-semibold block ${textPrimary}`}>
              {t('admin.modals.balanceAmountLabel')}
            </label>
            <input
              type="text"
              inputMode="numeric"
              dir="ltr"
              required
              className={`w-full h-11 px-3.5 text-sm tnum rounded-tile border outline-none rs-focus ${inputClass}`}
              placeholder={t('admin.modals.balanceAmountPlaceholder')}
              value={amountStr}
              onChange={(e) => {
                const normalized = normalizeInputDigits(e.target.value).replace(/[^0-9]/g, '');
                setAmountStr(normalized);
              }}
            />

            <div className="grid grid-cols-5 gap-1.5 pt-0.5">
              {quickAmounts.map((quickAmt) => {
                const isSelected = numAmount === quickAmt;
                const label =
                  quickAmt >= 1000000
                    ? t('admin.users.quickAmountM', {
                        amount: formatNumber(quickAmt / 1000000),
                      })
                    : t('admin.users.quickAmountK', {
                        amount: formatNumber(quickAmt / 1000),
                      });

                return (
                  <button
                    key={quickAmt}
                    type="button"
                    className={`h-8 px-1 rounded-ctl text-xs press rs-focus cursor-pointer border flex items-center justify-center select-none tnum ${
                      isSelected
                        ? 'bg-brand-soft border-brand/35 text-brand-fg font-semibold'
                        : 'bg-surface-2 border-line text-ink-soft hover:border-line-strong font-medium'
                    }`}
                    onClick={() => setAmountStr(String(quickAmt))}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {isValidAmount && (
            <div className="p-3 rounded-tile border flex items-center justify-between text-xs bg-brand-soft border-brand/25">
              <span className="text-brand-fg font-medium">
                {t('admin.users.balancePreviewLabel')}
              </span>
              <span className={`font-semibold tnum text-sm sm:text-base ${textPrimary}`}>
                <bdi dir="ltr">{formatMoney(previewNewBalance)}</bdi>{' '}
                <span className="text-xs font-normal text-ink-muted">{t('common.currency')}</span>
              </span>
            </div>
          )}

          <div className="space-y-2">
            <label className={`text-xs font-semibold block ${textPrimary}`}>
              {t('admin.modals.balanceReasonLabel')}
            </label>
            <input
              type="text"
              required
              className={`w-full h-11 px-3.5 text-xs sm:text-sm rounded-tile border outline-none rs-focus ${inputClass}`}
              placeholder={t('admin.modals.balanceReasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />

            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {quickReasons.map((quickReason) => {
                const isSelected = reason === quickReason;
                return (
                  <button
                    key={quickReason}
                    type="button"
                    className={`h-8 px-3 rounded-ctl text-xs press rs-focus cursor-pointer border select-none ${
                      isSelected
                        ? 'bg-brand-soft border-brand/35 text-brand-fg font-semibold'
                        : 'bg-surface-2 border-line text-ink-muted hover:border-line-strong hover:text-ink'
                    }`}
                    onClick={() => setReason(quickReason)}
                  >
                    {quickReason}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2.5 pt-3 mt-4 border-t border-line">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={handleClose}
              disabled={loading}
            >
              {t('common.cancel')}
            </Button>

            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={loading || !isValidAmount || !reason.trim()}
              loading={loading}
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {loading ? t('admin.modals.balanceSubmitting') : t('admin.modals.balanceSubmit')}
              </span>
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
