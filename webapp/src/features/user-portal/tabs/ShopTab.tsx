import React, { useEffect, useState } from 'react';
import {
  ShoppingBag,
  Zap,
  Sliders,
  Plus,
  Minus,
  Send,
  ShieldCheck,
  Package,
  Loader2,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
import { openTelegramLinkAndMinimize } from '@/shared/lib/telegramNavigation.js';
import { api } from '@/shared/lib/api.js';
import type { UserPackageItem, CustomVolumeSettings } from '@/shared/types/userPortal.js';

interface ShopTabProps {
  packages: UserPackageItem[];
  currency?: string;
  customVolumeSettings?: CustomVolumeSettings;
  botUsername?: string;
  onSelectPackage: (pkg: UserPackageItem) => void;
}

const PRESET_GB_OPTIONS = [10, 20, 30, 50, 100, 200];

export const ShopTab: React.FC<ShopTabProps> = ({
  packages,
  currency: propCurrency,
  customVolumeSettings,
  botUsername,
  onSelectPackage,
}) => {
  const { t } = useLanguage();
  const { formatToman, formatNumber } = useFormatters();
  const { triggerHaptic } = useHaptic();

  const currency = propCurrency || t('common.currency');

  const isCustomEnabled = customVolumeSettings?.enabled !== false;
  const minGb = customVolumeSettings?.minGb ?? 5;
  const maxGb = customVolumeSettings?.maxGb ?? 500;
  const pricePerGb = customVolumeSettings?.pricePerGb ?? 5000;
  const pricePerDay = customVolumeSettings?.pricePerDay ?? 0;
  const defaultDays = customVolumeSettings?.defaultDays ?? 30;

  const [customGb, setCustomGb] = useState<number>(() => Math.min(Math.max(30, minGb), maxGb));
  const [typedGb, setTypedGb] = useState<string>(() =>
    String(Math.min(Math.max(30, minGb), maxGb))
  );
  const [customDays, setCustomDays] = useState<number>(defaultDays);
  const [serverQuote, setServerQuote] = useState<number | null>(null);
  const [isFetchingQuote, setIsFetchingQuote] = useState<boolean>(false);

  useEffect(() => {
    setCustomDays(defaultDays);
  }, [defaultDays]);

  useEffect(() => {
    setCustomGb((prev) => {
      const clamped = Math.min(Math.max(prev, minGb), maxGb);
      if (clamped !== prev) {
        setTypedGb(String(clamped));
      }
      return clamped;
    });
  }, [minGb, maxGb]);

  const linearPrice = Math.max(0, customGb * pricePerGb + customDays * pricePerDay);
  const customPrice = serverQuote !== null ? serverQuote : linearPrice;

  useEffect(() => {
    if (!isCustomEnabled) return;
    let isCancelled = false;
    setIsFetchingQuote(true);

    const timer = setTimeout(async () => {
      try {
        const quote = await api.getUserQuote(customGb, customDays);
        if (!isCancelled) {
          setServerQuote(quote.totalPrice);
        }
      } catch {
        if (!isCancelled) {
          setServerQuote(null);
        }
      } finally {
        if (!isCancelled) {
          setIsFetchingQuote(false);
        }
      }
    }, 220);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [customGb, customDays, isCustomEnabled]);

  const handleSelect = (pkg: UserPackageItem) => {
    triggerHaptic('selection');
    onSelectPackage(pkg);
  };

  const handleCustomGbChange = (val: number) => {
    const clamped = Math.min(Math.max(val, minGb), maxGb);
    setCustomGb(clamped);
    setTypedGb(String(clamped));
  };

  const handleTypedGbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setTypedGb(raw);
    const normalized = normalizeInputDigits(raw);
    const parsed = parseInt(normalized, 10);
    if (!isNaN(parsed)) {
      const clamped = Math.min(Math.max(parsed, minGb), maxGb);
      setCustomGb(clamped);
    }
  };

  const handleTypedGbBlur = () => {
    const normalized = normalizeInputDigits(typedGb);
    let parsed = parseInt(normalized, 10);
    if (isNaN(parsed)) {
      parsed = minGb;
    }
    const clamped = Math.min(Math.max(parsed, minGb), maxGb);
    setCustomGb(clamped);
    setTypedGb(String(clamped));
  };

  const handleOrderCustom = () => {
    triggerHaptic('medium');
    const customPkg: UserPackageItem = {
      id: 'custom',
      name: t('user.shop.customPackageName')
        .replace('{gb}', formatNumber(customGb))
        .replace('{days}', formatNumber(customDays)),
      gbAmount: customGb,
      durationDays: customDays,
      price: customPrice,
    };
    onSelectPackage(customPkg);
  };

  const handleOpenBotCustom = () => {
    triggerHaptic('medium');
    const cleanBot = botUsername?.replace(/^@/, '').trim();
    if (cleanBot) {
      const url = `https://t.me/${cleanBot}?start=custom`;
      openTelegramLinkAndMinimize(url);
      return;
    }
    handleOrderCustom();
  };

  const validPresets = PRESET_GB_OPTIONS.filter((val) => val >= minGb && val <= maxGb);

  return (
    <div className="w-full flex flex-col gap-5 pb-6">
      {/* Header */}
      <div className="flex flex-col text-start gap-1">
        <SectionHeader icon={<ShoppingBag />} title={t('user.shop.title')} />
        <p className="text-xs text-ink-muted m-0">{t('user.shop.desc')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Custom Volume Builder */}
        {isCustomEnabled && (
          <Card
            padding="lg"
            className="lg:col-span-5 lg:sticky lg:top-5 flex flex-col gap-4 text-start"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <IconTile tone="brand" size="md">
                  <Sliders />
                </IconTile>
                <div className="flex flex-col min-w-0">
                  <h3 className="text-sm font-semibold truncate text-ink m-0">
                    {t('user.shop.customVolumeTitle')}
                  </h3>
                  <span className="text-xs text-ink-muted truncate">
                    {t('user.shop.customVolumeSubtitle')}
                  </span>
                </div>
              </div>

              <Badge variant="primary" size="xs" className="shrink-0">
                {t('user.shop.customVolumeBadge')}
              </Badge>
            </div>

            {validPresets.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {validPresets.map((val) => {
                  const isSelected = customGb === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => {
                        triggerHaptic('selection');
                        handleCustomGbChange(val);
                      }}
                      className={`h-9 px-2 rounded-ctl text-xs font-medium border press rs-focus cursor-pointer flex items-center justify-center tnum transition-colors ${
                        isSelected
                          ? 'bg-brand border-brand text-brand-ink'
                          : 'bg-surface-2 border-line hover:border-line-strong hover:bg-surface-3 text-ink-soft'
                      }`}
                    >
                      <bdi dir="ltr">{formatNumber(val)} GB</bdi>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Slider & Stepper Box */}
            <Card subCard padding="md" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-ink-soft font-medium">
                  {t('user.shop.customVolumeGbLabel')}
                </span>
                <div dir="ltr" className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={customGb <= minGb}
                    onClick={() => {
                      triggerHaptic('light');
                      handleCustomGbChange(customGb - 5);
                    }}
                    className="w-9 h-9 rounded-ctl border flex items-center justify-center press rs-focus disabled:opacity-40 cursor-pointer disabled:pointer-events-none bg-surface border-line-strong text-ink-soft hover:bg-surface-3 hover:text-ink"
                    aria-label={t('user.shop.decreaseGb')}
                  >
                    <Minus className="w-4 h-4" />
                  </button>

                  <div className="flex items-baseline gap-1 min-w-[78px] justify-center px-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      value={typedGb}
                      onChange={handleTypedGbChange}
                      onBlur={handleTypedGbBlur}
                      aria-label={t('user.shop.customGbInputLabel')}
                      className="w-12 text-center tnum font-semibold text-base sm:text-lg text-brand-fg bg-transparent border-b border-line-strong focus:border-brand focus:outline-hidden py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-xs text-ink-muted">GB</span>
                  </div>

                  <button
                    type="button"
                    disabled={customGb >= maxGb}
                    onClick={() => {
                      triggerHaptic('light');
                      handleCustomGbChange(customGb + 5);
                    }}
                    className="w-9 h-9 rounded-ctl border flex items-center justify-center press rs-focus disabled:opacity-40 cursor-pointer disabled:pointer-events-none bg-surface border-line-strong text-ink-soft hover:bg-surface-3 hover:text-ink"
                    aria-label={t('user.shop.increaseGb')}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <input
                type="range"
                min={minGb}
                max={maxGb}
                step={1}
                value={customGb}
                onChange={(e) => handleCustomGbChange(Number(e.target.value))}
                aria-label={t('user.shop.customGbInputLabel')}
                className="rs-range w-full cursor-pointer"
              />

              <div className="flex items-center justify-between text-[11px] text-ink-muted tnum">
                <bdi dir="ltr">{formatNumber(minGb)} GB</bdi>
                <span>{t('user.shop.daysUnit').replace('{days}', formatNumber(customDays))}</span>
                <bdi dir="ltr">{formatNumber(maxGb)} GB</bdi>
              </div>
            </Card>

            {/* Price & Order CTAs */}
            <div className="flex flex-col gap-3 pt-3 border-t border-line">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div
                  className={`flex items-baseline gap-1.5 transition-opacity ${
                    isFetchingQuote ? 'opacity-65' : 'opacity-100'
                  }`}
                >
                  <bdi dir="ltr" className="text-xl tnum font-semibold text-ink">
                    {formatToman(customPrice)}
                  </bdi>
                  <span className="text-xs text-ink-muted">{currency}</span>
                  {isFetchingQuote && (
                    <Loader2
                      className="w-3.5 h-3.5 animate-spin text-ink-muted self-center"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <span className="text-[11px] text-ink-muted tnum">
                  {t('user.shop.customVolumePricePerGb').replace(
                    '{price}',
                    `${formatToman(pricePerGb)} ${currency}`
                  )}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {botUsername && (
                  <Button
                    size="md"
                    variant="secondary"
                    onClick={handleOpenBotCustom}
                    title={t('user.shop.customVolumeOrderBotButton')}
                    aria-label={t('user.shop.customVolumeOrderBotButton')}
                  >
                    <Send className="w-4 h-4 shrink-0" />
                    <span className="hidden sm:inline">
                      {t('user.shop.customVolumeOrderBotButton')}
                    </span>
                  </Button>
                )}

                <Button size="md" variant="primary" onClick={handleOrderCustom} className="flex-1">
                  <Zap className="w-4 h-4 shrink-0" />
                  <span>{t('user.shop.customVolumeOrderButton')}</span>
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Pre-configured Packages Grid */}
        <div className={isCustomEnabled ? 'lg:col-span-7' : 'lg:col-span-12'}>
          {packages.length === 0 ? (
            <EmptyState
              icon={<Package />}
              tone="neutral"
              title={t('user.shop.emptyPackages')}
              description={t('user.shop.emptyPackagesDesc')}
            />
          ) : (
            <div
              className={`grid grid-cols-1 sm:grid-cols-2 ${
                isCustomEnabled ? '' : 'lg:grid-cols-3'
              } gap-3.5`}
            >
              {packages.map((pkg) => (
                <Card
                  key={pkg.id}
                  padding="md"
                  className="flex flex-col justify-between gap-4 text-start hover:border-line-strong transition-colors"
                >
                  <div className="flex flex-col gap-2.5">
                    <h3 className="text-sm sm:text-[15px] font-semibold truncate text-ink m-0">
                      {pkg.name}
                    </h3>

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

                    <div className="flex flex-col gap-1.5 mt-1 text-xs text-ink-muted">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-ok-fg shrink-0" />
                        <span>{t('user.shop.fastConnectionFeature')}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-ok-fg shrink-0" />
                        <span>{t('user.shop.allPlatformsFeature')}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-line gap-2">
                    <div className="flex items-baseline gap-1 min-w-0">
                      <bdi dir="ltr" className="text-base sm:text-lg tnum font-semibold text-ink">
                        {formatToman(pkg.price)}
                      </bdi>
                      <span className="text-xs text-ink-muted">{currency}</span>
                    </div>

                    <Button size="sm" variant="primary" onClick={() => handleSelect(pkg)}>
                      {t('user.shop.selectPlan')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
