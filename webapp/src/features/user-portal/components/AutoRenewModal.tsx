import React, { useEffect, useState } from 'react';
import { RefreshCw, Check, ShieldCheck, AlertCircle, Loader2, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import type {
  ToggleAutoRenewResponse,
  UserConfigRecord,
  UserPackageItem,
} from '@/shared/types/userPortal.js';

interface AutoRenewModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: UserConfigRecord | null;
  currency?: string;
  onEnabled?: (res: ToggleAutoRenewResponse) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const AutoRenewModal: React.FC<AutoRenewModalProps> = ({
  isOpen,
  onClose,
  config,
  currency: propCurrency,
  onEnabled,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { formatToman, formatNumber } = useFormatters();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const currency = propCurrency || t('common.currency');

  const [packages, setPackages] = useState<UserPackageItem[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !config) return;
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    api
      .getRenewalOptions(config.id)
      .then((res) => {
        if (cancelled) return;
        setPackages(res.packages);
        const preferred =
          res.packages.find((p) => p.id === config.autoRenewPackageId) ?? res.packages[0];
        setSelectedPackageId(preferred?.id ?? '');
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(t('common.networkError'));
        setPackages([]);
        setSelectedPackageId('');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, config, t]);

  if (!isOpen || !config) return null;

  const selectedPkg = packages.find((p) => p.id === selectedPackageId) ?? null;

  const handleConfirm = async () => {
    if (!selectedPkg || isSubmitting) return;
    setIsSubmitting(true);
    triggerHaptic('medium');
    try {
      const cyclePrice = selectedPkg.originalPrice ?? selectedPkg.price;
      const res = await api.toggleAutoRenew(config.id, true, selectedPkg.id, cyclePrice);
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
      triggerHaptic('success');
      onNotify(t('user.services.autoRenewOn'), 'success');
      onEnabled?.(res);
      onClose();
    } catch {
      triggerHaptic('error');
      onNotify(t('common.error'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSubmitting ? () => undefined : onClose}
      maxWidth="md"
      closeOnBackdrop={!isSubmitting}
      hideCloseButton={isSubmitting}
      title={t('user.services.autoRenewModalTitle')}
      subtitle={t('user.services.autoRenewModalSubtitle')}
      icon={
        <IconTile tone="brand" size="sm">
          <RefreshCw />
        </IconTile>
      }
      footer={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="flex-1"
            onClick={() => void handleConfirm()}
            disabled={!selectedPkg || isLoading || isSubmitting}
            loading={isSubmitting}
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>{t('user.services.autoRenewConfirmEnable')}</span>
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-start">
        <div className="p-3 rounded-tile border border-brand/25 bg-brand-soft/60 text-xs text-ink-soft leading-relaxed flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-brand-fg shrink-0 mt-0.5" />
          <span>{t('user.services.autoRenewModalNotice')}</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-xs text-ink-muted">
            <Loader2 className="w-4 h-4 animate-spin text-brand-fg" />
            <span>{t('common.loading')}</span>
          </div>
        ) : loadError ? (
          <div className="p-4 rounded-tile border border-danger/25 bg-danger-soft text-danger-fg text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        ) : packages.length === 0 ? (
          <div className="p-4 rounded-tile border border-line bg-surface-2 text-xs text-ink-muted text-center">
            {t('user.services.autoRenewNoPackages')}
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pe-0.5">
            {packages.map((pkg) => {
              const isSelected = pkg.id === selectedPackageId;
              const cyclePrice = pkg.originalPrice ?? pkg.price;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => {
                    triggerHaptic('selection');
                    setSelectedPackageId(pkg.id);
                  }}
                  className={`w-full p-3 rounded-tile border text-start flex items-center justify-between gap-2.5 press rs-focus cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-brand-soft border-brand text-ink shadow-[var(--shadow-xs)]'
                      : 'bg-surface-2 border-line hover:border-line-strong text-ink-soft'
                  }`}
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-xs sm:text-sm font-semibold text-ink truncate">
                      {pkg.name}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="primary" size="xs">
                        <Zap className="w-3 h-3" />
                        <span>
                          {t('user.shop.trafficUnit').replace('{gb}', formatNumber(pkg.gbAmount))}
                        </span>
                      </Badge>
                      <Badge variant="neutral" size="xs">
                        {t('user.shop.daysUnit').replace('{days}', formatNumber(pkg.durationDays))}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-xs sm:text-sm font-semibold tnum text-ink">
                      <bdi dir="ltr">{formatToman(cyclePrice)}</bdi>
                    </span>
                    <span className="text-[10px] text-ink-muted">{currency}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};
