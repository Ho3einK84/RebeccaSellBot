import React, { useEffect, useState } from 'react';
import {
  RefreshCw,
  Check,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Zap,
  Package,
  Sliders,
  Minus,
  Plus,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { SegmentedControl } from '@/shared/components/ui/SegmentedControl.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import type {
  CustomVolumeQuoteResponse,
  CustomVolumeSettings,
  ToggleAutoRenewResponse,
  UserConfigRecord,
  UserPackageItem,
} from '@/shared/types/userPortal.js';

interface AutoRenewModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: UserConfigRecord | null;
  currency?: string;
  customVolumeSettings?: CustomVolumeSettings;
  onEnabled?: (res: ToggleAutoRenewResponse) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const CUSTOM_PRESETS = [10, 20, 30, 50, 100];

export const AutoRenewModal: React.FC<AutoRenewModalProps> = ({
  isOpen,
  onClose,
  config,
  currency: propCurrency,
  customVolumeSettings,
  onEnabled,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { formatToman, formatNumber } = useFormatters();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const currency = propCurrency || t('common.currency');
  const minGb = customVolumeSettings?.minGb ?? 5;
  const maxGb = customVolumeSettings?.maxGb ?? 500;
  const defaultDays = customVolumeSettings?.defaultDays ?? 30;
  const basePricePerGb = customVolumeSettings?.pricePerGb ?? 5000;
  const pricePerDay = customVolumeSettings?.pricePerDay ?? 0;

  const [packages, setPackages] = useState<UserPackageItem[]>([]);
  const [customVolumeAllowed, setCustomVolumeAllowed] = useState(false);
  const [mode, setMode] = useState<'packages' | 'custom'>('packages');
  const [selectedPackageId, setSelectedPackageId] = useState<string>('');
  const [customGb, setCustomGb] = useState<number>(() => Math.min(Math.max(30, minGb), maxGb));
  const [typedGb, setTypedGb] = useState<string>(() =>
    String(Math.min(Math.max(30, minGb), maxGb))
  );
  const [customQuote, setCustomQuote] = useState<CustomVolumeQuoteResponse | null>(null);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
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
        setCustomVolumeAllowed(Boolean(res.customVolumeEnabled));

        const customMatch = config.autoRenewPackageId
          ? /^custom_(\d+)gb_(\d+)d$/i.exec(config.autoRenewPackageId)
          : null;
        if (customMatch && res.customVolumeEnabled) {
          const clamped = Math.min(Math.max(Number(customMatch[1]), minGb), maxGb);
          setMode('custom');
          setCustomGb(clamped);
          setTypedGb(String(clamped));
        } else {
          setMode(
            res.packages.length > 0 ? 'packages' : res.customVolumeEnabled ? 'custom' : 'packages'
          );
        }

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
  }, [isOpen, config, t, minGb, maxGb]);

  useEffect(() => {
    if (!isOpen || mode !== 'custom' || !customVolumeAllowed) return;
    let cancelled = false;
    setIsFetchingQuote(true);
    const timer = setTimeout(async () => {
      try {
        const quote = await api.getUserQuote(customGb, defaultDays);
        if (!cancelled) setCustomQuote(quote);
      } catch {
        if (!cancelled) setCustomQuote(null);
      } finally {
        if (!cancelled) setIsFetchingQuote(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, mode, customVolumeAllowed, customGb, defaultDays]);

  if (!isOpen || !config) return null;

  const selectedPkg = packages.find((p) => p.id === selectedPackageId) ?? null;
  const fallbackCustomPrice = Math.max(0, customGb * basePricePerGb + defaultDays * pricePerDay);
  const customPrice = customQuote?.totalPrice ?? fallbackCustomPrice;
  const canConfirm =
    mode === 'custom' ? customVolumeAllowed && customGb >= minGb : Boolean(selectedPkg);

  const handleGbChange = (val: number) => {
    const clamped = Math.min(Math.max(val, minGb), maxGb);
    setCustomGb(clamped);
    setTypedGb(String(clamped));
  };

  const handleConfirm = async () => {
    if (!canConfirm || isSubmitting) return;
    setIsSubmitting(true);
    triggerHaptic('medium');
    try {
      const res =
        mode === 'custom'
          ? await api.toggleAutoRenew(config.id, true, undefined, customPrice, {
              gb: customGb,
              days: defaultDays,
            })
          : await api.toggleAutoRenew(
              config.id,
              true,
              selectedPkg!.id,
              selectedPkg!.originalPrice ?? selectedPkg!.price
            );
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

  const validPresets = CUSTOM_PRESETS.filter((v) => v >= minGb && v <= maxGb);

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
            disabled={!canConfirm || isLoading || isSubmitting}
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
        ) : (
          <>
            {customVolumeAllowed && packages.length > 0 && (
              <SegmentedControl
                value={mode}
                onChange={setMode}
                ariaLabel={t('user.services.autoRenewModalTitle')}
                options={[
                  {
                    id: 'packages',
                    label: t('user.services.autoRenewPackagesTab'),
                    icon: Package,
                    count: formatNumber(packages.length),
                    tone: 'brand',
                  },
                  {
                    id: 'custom',
                    label: t('user.services.autoRenewCustomTab'),
                    icon: Sliders,
                    tone: 'brand',
                  },
                ]}
              />
            )}

            {mode === 'packages' ? (
              packages.length === 0 ? (
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
                                {t('user.shop.trafficUnit').replace(
                                  '{gb}',
                                  formatNumber(pkg.gbAmount)
                                )}
                              </span>
                            </Badge>
                            <Badge variant="neutral" size="xs">
                              {t('user.shop.daysUnit').replace(
                                '{days}',
                                formatNumber(pkg.durationDays)
                              )}
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
              )
            ) : (
              <div className="flex flex-col gap-3">
                {validPresets.length > 0 && (
                  <div className="grid grid-cols-5 gap-1.5">
                    {validPresets.map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          triggerHaptic('selection');
                          handleGbChange(val);
                        }}
                        className={`h-8 rounded-ctl text-xs font-medium border press cursor-pointer tnum ${
                          customGb === val
                            ? 'bg-brand border-brand text-brand-ink'
                            : 'bg-surface-2 border-line text-ink-soft'
                        }`}
                      >
                        <bdi dir="ltr">{formatNumber(val)}</bdi>
                      </button>
                    ))}
                  </div>
                )}

                <div className="p-3 rounded-tile border border-line bg-surface-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-soft font-medium">
                    {t('user.shop.customVolumeGbLabel')}
                  </span>
                  <div dir="ltr" className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={customGb <= minGb}
                      onClick={() => handleGbChange(customGb - 5)}
                      className="w-8 h-8 rounded-ctl border border-line-strong bg-surface flex items-center justify-center disabled:opacity-40 cursor-pointer"
                      aria-label={t('user.shop.decreaseGb')}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      value={typedGb}
                      onChange={(e) => {
                        setTypedGb(e.target.value);
                        const parsed = parseInt(normalizeInputDigits(e.target.value), 10);
                        if (!isNaN(parsed)) {
                          setCustomGb(Math.min(Math.max(parsed, minGb), maxGb));
                        }
                      }}
                      onBlur={() => handleGbChange(customGb)}
                      className="w-12 text-center tnum font-semibold text-sm text-brand-fg bg-transparent border-b border-line-strong focus:border-brand focus:outline-hidden"
                    />
                    <button
                      type="button"
                      disabled={customGb >= maxGb}
                      onClick={() => handleGbChange(customGb + 5)}
                      className="w-8 h-8 rounded-ctl border border-line-strong bg-surface flex items-center justify-center disabled:opacity-40 cursor-pointer"
                      aria-label={t('user.shop.increaseGb')}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs px-1">
                  <span className="text-ink-muted">
                    {t('user.shop.daysUnit').replace('{days}', formatNumber(defaultDays))}
                  </span>
                  <div className="flex items-baseline gap-1 tnum">
                    {isFetchingQuote && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-muted self-center" />
                    )}
                    <bdi dir="ltr" className="text-base font-semibold text-ink">
                      {formatToman(customPrice)}
                    </bdi>
                    <span className="text-ink-muted">{currency}</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
