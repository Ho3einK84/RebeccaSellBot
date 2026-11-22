import React, { useEffect, useState } from 'react';
import { Trash2, Loader2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import type { ConfigRefundQuoteResponse, UserConfigRecord } from '@/shared/types/userPortal.js';

interface ConfigDeleteRefundModalProps {
  isOpen: boolean;
  config: UserConfigRecord | null;
  currency?: string;
  onClose: () => void;
  onDeleted: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const ConfigDeleteRefundModal: React.FC<ConfigDeleteRefundModalProps> = ({
  isOpen,
  config,
  currency: propCurrency,
  onClose,
  onDeleted,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { formatToman } = useFormatters();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const currency = propCurrency || t('common.currency');

  const [quote, setQuote] = useState<ConfigRefundQuoteResponse | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    if (!isOpen || !config) return;
    let cancelled = false;
    setIsLoadingQuote(true);
    setQuote(null);
    api
      .getUserConfigRefundQuote(config.id)
      .then((res) => {
        if (!cancelled) setQuote(res);
      })
      .catch(() => {
        if (!cancelled) setQuote({ eligible: false, reason: 'remote_unavailable' });
      })
      .finally(() => {
        if (!cancelled) setIsLoadingQuote(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, config]);

  if (!isOpen || !config) return null;

  const resolveReasonText = (reason?: string) => {
    switch (reason) {
      case 'already_used':
        return t('user.services.refundReasonUsed');
      case 'renewed_service':
        return t('user.services.refundReasonRenewed');
      case 'refund_window_expired':
        return t('user.services.refundReasonWindowExpired');
      case 'referral_reward_attached':
        return t('user.services.refundReasonReferral');
      default:
        return t('user.services.refundReasonOther');
    }
  };

  const handleDelete = async (withRefund: boolean) => {
    if (isExecuting) return;
    setIsExecuting(true);
    triggerHaptic('warning');
    try {
      const res = await api.deleteUserConfig(config.id, withRefund);
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
      await queryClient.invalidateQueries({ queryKey: ['user', 'transactions'] });
      triggerHaptic('success');
      if (res.refunded && res.refundAmount > 0) {
        onNotify(
          t('user.services.deleteRefundSuccess')
            .replace('{amount}', formatToman(res.refundAmount))
            .replace('{currency}', currency),
          'success'
        );
      } else {
        onNotify(t('user.services.deleteConfirmSuccess'), 'success');
      }
      onDeleted();
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.status === 202) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
        await queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
        onNotify(t('user.services.deleteRefundPending'), 'success');
        onDeleted();
        return;
      }
      triggerHaptic('error');
      const msg =
        err instanceof ApiClientError && err.code === 'PANEL_DOWN'
          ? t('user.services.panelDownError')
          : t('common.error');
      onNotify(msg, 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isExecuting ? () => undefined : onClose}
      maxWidth="sm"
      closeOnBackdrop={!isExecuting}
      hideCloseButton={isExecuting}
      title={t('user.services.deleteModalTitle')}
      subtitle={t('user.services.deleteModalSubtitle')}
      icon={
        <IconTile tone="danger" size="sm">
          <Trash2 />
        </IconTile>
      }
    >
      <div className="flex flex-col gap-3.5 text-start">
        <div className="rounded-tile border border-line bg-surface-2 px-3 py-2 text-xs flex items-center justify-between gap-2">
          <span className="text-ink-muted">{t('user.shop.configUsername')}</span>
          <bdi dir="ltr" className="font-mono font-semibold text-ink">
            {config.configUsername}
          </bdi>
        </div>

        {isLoadingQuote ? (
          <div className="flex items-center justify-center py-6 gap-2 text-xs text-ink-muted">
            <Loader2 className="w-4 h-4 animate-spin text-brand-fg" />
            <span>{t('common.loading')}</span>
          </div>
        ) : quote?.eligible && (quote.refundAmount ?? 0) > 0 ? (
          <div className="rounded-tile border border-ok/35 bg-ok-soft p-3.5 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-ok-fg">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{t('user.services.refundEligibleTitle')}</span>
            </div>
            <p className="text-xs text-ink-soft m-0 leading-relaxed">
              {t('user.services.refundEligibleDesc')}
            </p>
            <div className="flex items-baseline gap-1.5 text-lg font-bold tnum text-ok-fg">
              <bdi dir="ltr">{formatToman(quote.refundAmount ?? 0)}</bdi>
              <span className="text-xs font-medium">{currency}</span>
            </div>
            {(quote.cashbackWithheld ?? 0) > 0 && (
              <span className="text-[11px] text-ink-muted tnum">
                {t('user.services.refundCashbackWithheld')
                  .replace('{amount}', formatToman(quote.cashbackWithheld ?? 0))
                  .replace('{currency}', currency)}
              </span>
            )}
          </div>
        ) : (
          <div className="rounded-tile border border-warn/30 bg-warn-soft p-3.5 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-warn-fg shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink">
                {t('user.services.refundIneligibleTitle')}
              </span>
              <span className="text-[11px] text-ink-soft leading-relaxed">
                {resolveReasonText(quote?.reason)}
              </span>
            </div>
          </div>
        )}

        {!isLoadingQuote && (
          <div className="flex flex-col gap-2 pt-1">
            {quote?.eligible && (quote.refundAmount ?? 0) > 0 && (
              <Button
                type="button"
                variant="primary"
                size="md"
                block
                loading={isExecuting}
                disabled={isExecuting}
                onClick={() => void handleDelete(true)}
              >
                <RefreshCw className="w-4 h-4 shrink-0" />
                <span>
                  {t('user.services.deleteWithRefundButton')
                    .replace('{amount}', formatToman(quote.refundAmount ?? 0))
                    .replace('{currency}', currency)}
                </span>
              </Button>
            )}

            <Button
              type="button"
              variant="danger"
              size="md"
              block
              loading={isExecuting}
              disabled={isExecuting}
              onClick={() => void handleDelete(false)}
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              <span>{t('user.services.deleteWithoutRefundButton')}</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="md"
              block
              disabled={isExecuting}
              onClick={onClose}
            >
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};
