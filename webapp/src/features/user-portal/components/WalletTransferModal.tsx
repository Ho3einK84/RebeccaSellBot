import React, { useState } from 'react';
import { Send, Search, UserCheck, AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import type { RecipientPreview } from '@/shared/types/userPortal.js';

interface WalletTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableBalance: number;
  hasCreditLimit?: boolean;
  debtAmount?: number;
  minAmount: number;
  currency?: string;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const WalletTransferModal: React.FC<WalletTransferModalProps> = ({
  isOpen,
  onClose,
  availableBalance,
  hasCreditLimit = false,
  debtAmount = 0,
  minAmount,
  currency: propCurrency,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { formatToman } = useFormatters();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const currency = propCurrency || t('common.currency');

  const [recipientInput, setRecipientInput] = useState('');
  const [recipient, setRecipient] = useState<RecipientPreview | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [note, setNote] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  if (!isOpen) return null;

  const parsedAmount = parseInt(normalizeInputDigits(amountInput).replace(/[^\d]/g, ''), 10) || 0;
  const isAmountValid = parsedAmount >= minAmount && parsedAmount <= availableBalance;

  const resetAndClose = () => {
    if (isSending) return;
    setRecipientInput('');
    setRecipient(null);
    setAmountInput('');
    setNote('');
    setErrorText(null);
    onClose();
  };

  const mapError = (err: unknown): string => {
    if (err instanceof ApiClientError) {
      if (err.code === 'TRANSFER_TARGET_NOT_FOUND')
        return t('user.services.transferTargetNotFound');
      if (err.code === 'TRANSFER_TO_SELF') return t('user.services.transferToSelf');
      if (err.code === 'TRANSFER_TARGET_BANNED') return t('user.services.transferTargetBanned');
      if (err.code === 'INSUFFICIENT_BALANCE') return t('user.shop.insufficientBalance');
      if (err.code === 'TRANSFER_BELOW_MIN') {
        return t('user.wallet.transferMinHint')
          .replace('{min}', formatToman(minAmount))
          .replace('{currency}', currency);
      }
    }
    return t('common.error');
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = recipientInput.trim();
    if (!trimmed || isLookingUp) return;
    setIsLookingUp(true);
    setErrorText(null);
    triggerHaptic('light');

    try {
      const res = await api.previewWalletTransfer(trimmed);
      setRecipient(res.recipient);
      triggerHaptic('selection');
    } catch (err) {
      triggerHaptic('error');
      setRecipient(null);
      setErrorText(mapError(err));
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleExecute = async () => {
    if (!recipient || !isAmountValid || isSending) return;
    setIsSending(true);
    setErrorText(null);
    triggerHaptic('medium');

    try {
      const res = await api.executeWalletTransfer({
        toTelegramId: recipient.telegramId,
        amount: parsedAmount,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
      await queryClient.invalidateQueries({ queryKey: ['user', 'transactions'] });
      triggerHaptic('success');
      onNotify(
        t('user.wallet.transferSuccess')
          .replace('{amount}', formatToman(res.amount))
          .replace('{currency}', currency),
        'success'
      );
      resetAndClose();
    } catch (err) {
      triggerHaptic('error');
      setErrorText(mapError(err));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      maxWidth="sm"
      closeOnBackdrop={!isSending}
      hideCloseButton={isSending}
      title={t('user.wallet.transferModalTitle')}
      subtitle={t('user.wallet.transferModalSubtitle')}
      icon={
        <IconTile tone="brand" size="sm">
          <Send />
        </IconTile>
      }
    >
      <div className="flex flex-col gap-3.5 text-start">
        <div className="rounded-tile border border-line bg-surface-2 px-3 py-2 text-xs flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-muted">{t('user.dashboard.availableBalance')}</span>
            <bdi dir="ltr" className="font-semibold tnum text-ink">
              {formatToman(Math.max(0, availableBalance))} {currency}
            </bdi>
          </div>
          {(hasCreditLimit || debtAmount > 0) && (
            <span className="text-[11px] text-ink-muted leading-snug">
              {t('user.wallet.transferPositiveBalanceNote')}
            </span>
          )}
        </div>

        {/* Step 1: Recipient Lookup */}
        <form onSubmit={(e) => void handleLookup(e)} className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-ink-soft">
            {t('user.services.transferRecipientLabel')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              dir="ltr"
              value={recipientInput}
              onChange={(e) => {
                setRecipientInput(e.target.value);
                if (recipient) setRecipient(null);
                if (errorText) setErrorText(null);
              }}
              placeholder={t('user.services.transferRecipientPlaceholder')}
              disabled={isLookingUp || isSending}
              className="flex-1 min-h-11 px-3 rounded-ctl border border-line bg-surface-2 text-xs sm:text-sm font-mono text-ink placeholder:text-ink-muted rs-focus"
            />
            <Button
              type="submit"
              size="md"
              variant="secondary"
              loading={isLookingUp}
              disabled={!recipientInput.trim() || isLookingUp || isSending}
            >
              <Search className="w-4 h-4 shrink-0" />
              <span>{t('user.services.transferLookup')}</span>
            </Button>
          </div>
        </form>

        {/* Step 2: Verified Recipient + Amount */}
        {recipient && (
          <div className="anim-pop flex flex-col gap-3">
            <div className="rounded-tile border border-ok/30 bg-ok-soft p-3 flex items-center gap-2.5">
              <IconTile tone="ok" size="sm">
                <UserCheck />
              </IconTile>
              <div className="flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-semibold text-ink truncate">
                  {recipient.displayName}
                </span>
                <span className="text-[11px] font-mono text-ink-soft">
                  <bdi dir="ltr">
                    {recipient.username ? `${recipient.username} · ` : ''}#{recipient.telegramId}
                  </bdi>
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-soft">
                {t('user.wallet.transferAmountLabel').replace('{currency}', currency)}
              </label>
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  if (errorText) setErrorText(null);
                }}
                placeholder={String(minAmount)}
                disabled={isSending}
                className="w-full min-h-11 px-3 rounded-ctl border border-line bg-surface-2 text-sm font-mono font-semibold text-ink tnum rs-focus"
              />
              <span className="text-[11px] text-ink-muted tnum">
                {t('user.wallet.transferMinHint')
                  .replace('{min}', formatToman(minAmount))
                  .replace('{currency}', currency)}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-soft">
                {t('user.wallet.transferNoteLabel')}
              </label>
              <input
                type="text"
                maxLength={120}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('user.wallet.transferNotePlaceholder')}
                disabled={isSending}
                className="w-full min-h-10 px-3 rounded-ctl border border-line bg-surface-2 text-xs text-ink placeholder:text-ink-muted rs-focus"
              />
            </div>

            <Button
              type="button"
              variant="primary"
              size="md"
              block
              loading={isSending}
              disabled={!isAmountValid || isSending}
              onClick={() => void handleExecute()}
            >
              <Send className="w-4 h-4 shrink-0" />
              <span>
                {parsedAmount > 0
                  ? t('user.wallet.transferConfirmButton')
                      .replace('{amount}', formatToman(parsedAmount))
                      .replace('{currency}', currency)
                  : t('common.confirm')}
              </span>
            </Button>
          </div>
        )}

        {errorText && (
          <div className="rounded-tile border border-danger/30 bg-danger-soft p-2.5 text-xs text-danger-fg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorText}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};
