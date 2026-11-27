import React, { useEffect, useMemo, useState } from 'react';
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
  Flame,
  Sparkles,
  Clock,
  Tag,
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
import { SegmentedControl } from '@/shared/components/ui/SegmentedControl.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
import { openTelegramLinkAndMinimize } from '@/shared/lib/telegramNavigation.js';
import { api } from '@/shared/lib/api.js';
import { FreeTrialBanner } from '@/features/user-portal/components/FreeTrialSection.js';
import type {
  UserPackageItem,
  UserCategoryItem,
  UserGroupSummary,
  CustomVolumeSettings,
  CustomVolumeQuoteResponse,
  UserTrialStatus,
  TrialClaimResponse,
  VolumePricingTierItem,
} from '@/shared/types/userPortal.js';

interface ShopTabProps {
  packages: UserPackageItem[];
  categories?: UserCategoryItem[];
  group?: UserGroupSummary | null;
  currency?: string;
  customVolumeSettings?: CustomVolumeSettings;
  trial?: UserTrialStatus | null;
  botUsername?: string;
  onSelectPackage: (pkg: UserPackageItem) => void;
  onTrialClaimed?: (res: TrialClaimResponse) => void;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

function formatDiscountTimeLeft(
  expiresAt: string | null | undefined,
  locale: string
): string | null {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return null;
  const totalMins = Math.max(1, Math.ceil(diffMs / 60_000));
  const days = Math.floor(totalMins / (24 * 60));
  const hours = Math.floor((totalMins % (24 * 60)) / 60);
  const mins = totalMins % 60;
  const numLoc = locale === 'fa' ? 'fa-IR' : 'en-US';
  if (days > 0) {
    return locale === 'fa'
      ? `${days.toLocaleString(numLoc)} روز و ${hours.toLocaleString(numLoc)} ساعت`
      : `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return locale === 'fa'
      ? `${hours.toLocaleString(numLoc)} ساعت و ${mins.toLocaleString(numLoc)} دقیقه`
      : `${hours}h ${mins}m`;
  }
  return locale === 'fa' ? `${mins.toLocaleString(numLoc)} دقیقه` : `${mins}m`;
}

function resolveTierRate(tier: VolumePricingTierItem, basePricePerGb: number): number {
  if (typeof tier.pricePerGb === 'number' && tier.pricePerGb > 0) return tier.pricePerGb;
  if (typeof tier.discountPercent === 'number' && tier.discountPercent > 0) {
    return Math.max(0, Math.round(basePricePerGb * (1 - tier.discountPercent / 100)));
  }
  return basePricePerGb;
}

const PRESET_GB_OPTIONS = [10, 20, 30, 50, 100, 200];

export const ShopTab: React.FC<ShopTabProps> = ({
  packages,
  categories,
  group,
  currency: propCurrency,
  customVolumeSettings,
  trial,
  botUsername,
  onSelectPackage,
  onTrialClaimed,
  onNotify,
}) => {
  const { t, locale } = useLanguage();
  const { formatToman, formatNumber } = useFormatters();
  const { triggerHaptic } = useHaptic();
  const [, setClockTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const currency = propCurrency || t('common.currency');

  const isCustomEnabled = customVolumeSettings?.enabled !== false;
  const minGb = customVolumeSettings?.minGb ?? 5;
  const maxGb = customVolumeSettings?.maxGb ?? 500;
  const basePricePerGb = customVolumeSettings?.pricePerGb ?? 5000;
  const pricePerDay = customVolumeSettings?.pricePerDay ?? 0;
  const defaultDays = customVolumeSettings?.defaultDays ?? 30;

  const [mobileSection, setMobileSection] = useState<'preset' | 'custom'>(() =>
    packages.length > 0 ? 'preset' : 'custom'
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [customGb, setCustomGb] = useState<number>(() => Math.min(Math.max(30, minGb), maxGb));
  const [typedGb, setTypedGb] = useState<string>(() =>
    String(Math.min(Math.max(30, minGb), maxGb))
  );
  const [customDays, setCustomDays] = useState<number>(defaultDays);
  const [serverQuote, setServerQuote] = useState<CustomVolumeQuoteResponse | null>(null);
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

  const groupDiscountPct =
    customVolumeSettings?.groupDiscountPercent !== undefined
      ? customVolumeSettings.groupDiscountPercent
      : group?.applyDiscountToCustomVolume
        ? (group.discountPercent ?? 0)
        : 0;
  const rawLinearPrice = Math.max(0, customGb * basePricePerGb + customDays * pricePerDay);
  const linearPrice =
    groupDiscountPct > 0
      ? Math.max(0, rawLinearPrice - Math.floor((rawLinearPrice * groupDiscountPct) / 100))
      : rawLinearPrice;
  const customPrice = serverQuote ? serverQuote.totalPrice : linearPrice;
  const effectivePricePerGb = serverQuote?.pricePerGb ?? basePricePerGb;
  const isTierDiscounted =
    serverQuote !== null && serverQuote.pricePerGb > 0 && serverQuote.pricePerGb < basePricePerGb;
  const customOriginalPrice =
    serverQuote?.originalPrice && serverQuote.originalPrice > customPrice
      ? serverQuote.originalPrice
      : groupDiscountPct > 0 && rawLinearPrice > customPrice
        ? rawLinearPrice
        : null;
  const groupDisplayLabel = group ? [group.badge, group.name].filter(Boolean).join(' ').trim() : '';
  const hasGroupPricingPerk = Boolean(
    group &&
    (group.discountPercent > 0 ||
      group.customPricePerGb !== null ||
      (group.customPricePerDay !== null && group.customPricePerDay > 0))
  );

  useEffect(() => {
    if (!isCustomEnabled) return;
    let isCancelled = false;
    setIsFetchingQuote(true);

    const timer = setTimeout(async () => {
      try {
        const quote = await api.getUserQuote(customGb, customDays);
        if (!isCancelled) {
          setServerQuote(quote);
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

  const visibleCategories = useMemo(() => {
    if (!categories || categories.length === 0) return [];
    return categories
      .filter((cat) => packages.some((pkg) => pkg.categoryId === cat.id))
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [categories, packages]);

  useEffect(() => {
    if (
      selectedCategoryId !== 'all' &&
      !visibleCategories.some((cat) => cat.id === selectedCategoryId)
    ) {
      setSelectedCategoryId('all');
    }
  }, [selectedCategoryId, visibleCategories]);

  const filteredPackages = useMemo(() => {
    if (selectedCategoryId === 'all') return packages;
    return packages.filter((pkg) => pkg.categoryId === selectedCategoryId);
  }, [packages, selectedCategoryId]);

  const activeFlashSale = useMemo(() => {
    return (
      packages.find(
        (pkg) =>
          Boolean(pkg.activeDiscountTitle) &&
          ((pkg.discountAmount ?? 0) > 0 ||
            (typeof pkg.originalPrice === 'number' && pkg.originalPrice > pkg.price))
      ) ?? null
    );
  }, [packages]);

  const bestValuePackageId = useMemo(() => {
    if (filteredPackages.length < 2) return null;
    let bestId: string | null = null;
    let bestRate = Number.POSITIVE_INFINITY;
    for (const pkg of filteredPackages) {
      if (pkg.gbAmount <= 0 || pkg.featured || pkg.available === false) continue;
      const rate = pkg.price / pkg.gbAmount;
      if (rate < bestRate) {
        bestRate = rate;
        bestId = pkg.id;
      }
    }
    return bestId;
  }, [filteredPackages]);

  const isCustomUnavailable = customVolumeSettings?.available === false;

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
      ...(customOriginalPrice ? { originalPrice: customOriginalPrice } : {}),
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
  const rangePct =
    maxGb > minGb ? Math.min(100, Math.max(0, ((customGb - minGb) / (maxGb - minGb)) * 100)) : 0;

  const showMobileToggle = isCustomEnabled && packages.length > 0;

  return (
    <div className="w-full flex flex-col gap-4 pb-6">
      {/* Header */}
      <div className="flex flex-col text-start gap-1">
        <SectionHeader icon={<ShoppingBag />} title={t('user.shop.title')} />
        <p className="text-xs text-ink-muted m-0">{t('user.shop.desc')}</p>
      </div>

      {/* Group Pricing Banner */}
      {group && hasGroupPricingPerk && (
        <div className="rounded-tile border border-brand/30 bg-brand-soft px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-brand-fg flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 shrink-0" />
            <span className="font-semibold truncate">
              {t('user.shop.groupPricingBanner').replace(
                '{group}',
                groupDisplayLabel || t('user.group.badgeDefault')
              )}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {group.discountPercent > 0 && (
              <Badge variant="primary" size="xs" className="tnum">
                {t('user.shop.groupDiscountOff').replace(
                  '{percent}',
                  formatNumber(group.discountPercent)
                )}
              </Badge>
            )}
            {(group.customPricePerGb !== null ||
              (group.customPricePerDay !== null && group.customPricePerDay > 0)) && (
              <Badge variant="success" size="xs">
                {t('user.shop.groupCustomRateBadge')}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Eligible Free Trial Banner */}
      {trial?.eligible && (
        <FreeTrialBanner
          trial={trial}
          botUsername={botUsername}
          compact
          onClaimed={onTrialClaimed}
          onNotify={onNotify ?? (() => {})}
        />
      )}

      {/* Active Flash Sale Banner with Live Countdown */}
      {activeFlashSale && activeFlashSale.activeDiscountTitle && (
        <div className="rounded-tile border border-warn/35 bg-warn-soft px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-warn-fg flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Flame className="w-4 h-4 shrink-0" />
            <span className="font-semibold truncate">
              {t('user.shop.flashSaleBanner').replace(
                '{title}',
                activeFlashSale.activeDiscountTitle
              )}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {formatDiscountTimeLeft(activeFlashSale.discountExpiresAt, locale) && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium tnum">
                <Clock className="w-3 h-3 shrink-0" />
                <span>
                  {t('user.shop.discountEndsIn').replace(
                    '{remaining}',
                    formatDiscountTimeLeft(activeFlashSale.discountExpiresAt, locale)!
                  )}
                </span>
              </span>
            )}
            {activeFlashSale.originalPrice &&
              activeFlashSale.originalPrice > activeFlashSale.price && (
                <Badge variant="warning" size="xs" className="shrink-0 tnum">
                  {t('user.shop.discountBadgeOff').replace(
                    '{percent}',
                    formatNumber(
                      Math.round(
                        ((activeFlashSale.originalPrice - activeFlashSale.price) /
                          activeFlashSale.originalPrice) *
                          100
                      )
                    )
                  )}
                </Badge>
              )}
          </div>
        </div>
      )}

      {/* Mobile Preset / Custom Switcher */}
      {showMobileToggle && (
        <div className="lg:hidden">
          <SegmentedControl
            value={mobileSection}
            onChange={setMobileSection}
            ariaLabel={t('user.shop.title')}
            options={[
              {
                id: 'preset',
                label: t('user.shop.presetPlansTab'),
                icon: Package,
                count: formatNumber(packages.length),
                tone: 'brand',
              },
              {
                id: 'custom',
                label: t('user.shop.customPlanTab'),
                icon: Sliders,
                tone: 'brand',
              },
            ]}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Pre-configured Packages Grid */}
        <div
          className={`${isCustomEnabled ? 'lg:col-span-7' : 'lg:col-span-12'} ${
            showMobileToggle && mobileSection !== 'preset' ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Category Filter Chips */}
          {visibleCategories.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setSelectedCategoryId('all');
                }}
                className={`h-8 px-3 rounded-full text-xs font-medium border shrink-0 press rs-focus cursor-pointer transition-colors ${
                  selectedCategoryId === 'all'
                    ? 'bg-brand border-brand text-brand-ink'
                    : 'bg-surface-2 border-line text-ink-soft hover:border-line-strong'
                }`}
              >
                {t('user.shop.allCategories')}
              </button>
              {visibleCategories.map((cat) => {
                const active = selectedCategoryId === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection');
                      setSelectedCategoryId(cat.id);
                    }}
                    className={`h-8 px-3 rounded-full text-xs font-medium border shrink-0 press rs-focus cursor-pointer transition-colors inline-flex items-center gap-1 ${
                      active
                        ? 'bg-brand border-brand text-brand-ink'
                        : 'bg-surface-2 border-line text-ink-soft hover:border-line-strong'
                    }`}
                  >
                    {cat.icon ? <span>{cat.icon}</span> : null}
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {filteredPackages.length === 0 ? (
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
              } gap-3.5 anim-stagger`}
            >
              {filteredPackages.map((pkg) => {
                const isUnavailable = pkg.available === false;
                const hasDiscount =
                  typeof pkg.originalPrice === 'number' && pkg.originalPrice > pkg.price;
                const discountPct =
                  hasDiscount && pkg.originalPrice
                    ? Math.round(((pkg.originalPrice - pkg.price) / pkg.originalPrice) * 100)
                    : 0;
                const unitPrice = pkg.gbAmount > 0 ? Math.round(pkg.price / pkg.gbAmount) : null;
                const isBestValue = !isUnavailable && pkg.id === bestValuePackageId;
                const unavailableLabel = pkg.userLimitReached
                  ? t('user.shop.userLimitReachedBadge')
                  : pkg.unavailableReason === 'panel_capacity_full' ||
                      pkg.unavailableReason === 'service_capacity_full'
                    ? t('user.shop.capacityFullBadge')
                    : t('user.shop.outOfStockBadge');

                return (
                  <Card
                    key={pkg.id}
                    padding="md"
                    className={`flex flex-col justify-between gap-4 text-start ${
                      isUnavailable
                        ? 'opacity-70 bg-surface-2/60'
                        : pkg.featured
                          ? 'rs-card-interactive border-brand/35 ring-1 ring-brand/15 bg-gradient-to-b from-brand-soft/45 via-surface to-surface shadow-[var(--shadow-card-hover)]'
                          : 'rs-card-interactive'
                    }`}
                  >
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm sm:text-[15px] font-semibold truncate text-ink m-0">
                          {pkg.name}
                        </h3>
                        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                          {isUnavailable ? (
                            <Badge variant="error" size="xs">
                              {unavailableLabel}
                            </Badge>
                          ) : (
                            <>
                              {pkg.lowStock &&
                                pkg.remainingStock != null &&
                                pkg.remainingStock > 0 && (
                                  <Badge variant="warning" size="xs" className="tnum">
                                    <Flame className="w-3 h-3" />
                                    <span>
                                      {t('user.shop.lowStockBadge').replace(
                                        '{count}',
                                        formatNumber(pkg.remainingStock)
                                      )}
                                    </span>
                                  </Badge>
                                )}
                              {hasDiscount && discountPct > 0 && (
                                <Badge variant="warning" size="xs" className="tnum">
                                  <Flame className="w-3 h-3" />
                                  <span>
                                    {t('user.shop.discountBadgeOff').replace(
                                      '{percent}',
                                      formatNumber(discountPct)
                                    )}
                                  </span>
                                </Badge>
                              )}
                              {!hasDiscount && pkg.featured && (
                                <Badge variant="primary" size="xs">
                                  <Sparkles className="w-3 h-3" />
                                  <span>{t('user.shop.featuredBadge')}</span>
                                </Badge>
                              )}
                              {!hasDiscount && !pkg.featured && isBestValue && (
                                <Badge variant="success" size="xs">
                                  <Tag className="w-3 h-3" />
                                  <span>{t('user.shop.bestValueBadge')}</span>
                                </Badge>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="primary" size="xs">
                          <Zap className="w-3 h-3" />
                          <span>
                            {t('user.shop.trafficUnit').replace('{gb}', formatNumber(pkg.gbAmount))}
                          </span>
                        </Badge>

                        <Badge variant="neutral" size="xs">
                          {t('user.shop.daysUnit').replace(
                            '{days}',
                            formatNumber(pkg.durationDays)
                          )}
                        </Badge>

                        {pkg.startOnFirstUse && (
                          <Badge variant="info" size="xs">
                            <Clock className="w-3 h-3" />
                            <span>{t('user.shop.onHoldBadge')}</span>
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5 mt-0.5 text-xs text-ink-muted">
                        {unitPrice !== null && (
                          <div className="text-[11px] font-medium text-ink-soft tnum">
                            {t('user.shop.pricePerGbUnit').replace(
                              '{price}',
                              `${formatToman(unitPrice)} ${currency}`
                            )}
                          </div>
                        )}
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

                    <div className="flex items-end justify-between pt-3 border-t border-line gap-2">
                      <div className="flex flex-col min-w-0">
                        {hasDiscount && pkg.originalPrice && (
                          <span className="text-[11px] line-through text-ink-muted tnum leading-tight">
                            <bdi dir="ltr">{formatToman(pkg.originalPrice)}</bdi> {currency}
                          </span>
                        )}
                        <div className="flex items-baseline gap-1 min-w-0">
                          <bdi
                            dir="ltr"
                            className="text-base sm:text-lg tnum font-semibold text-ink"
                          >
                            {formatToman(pkg.price)}
                          </bdi>
                          <span className="text-xs text-ink-muted">{currency}</span>
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant={isUnavailable ? 'secondary' : 'primary'}
                        disabled={isUnavailable}
                        onClick={() => handleSelect(pkg)}
                      >
                        {isUnavailable ? t('user.shop.soldOutButton') : t('user.shop.selectPlan')}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom Volume Builder */}
        {isCustomEnabled && (
          <Card
            padding="lg"
            className={`lg:col-span-5 lg:sticky lg:top-5 flex-col gap-4 text-start ${
              showMobileToggle && mobileSection !== 'custom' ? 'hidden lg:flex' : 'flex'
            }`}
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
                    {t('user.shop.customVolumeFixedDaysSubtitle').replace(
                      '{days}',
                      formatNumber(customDays)
                    )}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isCustomUnavailable ? (
                  <Badge variant="error" size="xs">
                    {t('user.shop.capacityFullBadge')}
                  </Badge>
                ) : customVolumeSettings?.lowStock &&
                  customVolumeSettings.remainingStock != null &&
                  customVolumeSettings.remainingStock > 0 ? (
                  <Badge variant="warning" size="xs" className="tnum">
                    <Flame className="w-3 h-3" />
                    <span>
                      {t('user.shop.lowStockBadge').replace(
                        '{count}',
                        formatNumber(customVolumeSettings.remainingStock)
                      )}
                    </span>
                  </Badge>
                ) : (
                  <Badge variant="primary" size="xs">
                    {t('user.shop.customVolumeBadge')}
                  </Badge>
                )}
              </div>
            </div>

            {isCustomUnavailable && (
              <div className="rounded-ctl border border-danger/25 bg-danger-soft px-3 py-2 text-xs text-danger-fg leading-relaxed">
                {t('user.shop.customVolumeUnavailable')}
              </div>
            )}

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
                      className={`h-9 px-2 rounded-ctl text-xs font-medium border press rs-focus cursor-pointer flex items-center justify-center tnum transition-all duration-150 ${
                        isSelected
                          ? 'bg-brand border-brand text-brand-ink shadow-[var(--shadow-brand)]'
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
                style={{ '--rs-range-pct': `${rangePct}%` } as React.CSSProperties}
                className="rs-range w-full cursor-pointer"
              />

              <div className="flex items-center justify-between text-[11px] text-ink-muted tnum">
                <bdi dir="ltr">{formatNumber(minGb)} GB</bdi>
                <span>{t('user.shop.daysUnit').replace('{days}', formatNumber(customDays))}</span>
                <bdi dir="ltr">{formatNumber(maxGb)} GB</bdi>
              </div>
            </Card>

            {/* Volume Pricing Tiers Table */}
            {customVolumeSettings?.tiers && customVolumeSettings.tiers.length > 0 && (
              <div className="rounded-tile border border-line bg-surface-2 p-2.5 flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-ink-soft">
                  {t('user.shop.volumeTiersTitle')}
                </span>
                <div className="flex flex-col gap-1">
                  {customVolumeSettings.tiers.map((tier) => {
                    const isHit =
                      customGb >= tier.minGb &&
                      (tier.maxGb === undefined || customGb <= tier.maxGb);
                    const rate = resolveTierRate(tier, basePricePerGb);
                    const label = tier.maxGb
                      ? t('user.shop.volumeTierRowRange')
                          .replace('{min}', formatNumber(tier.minGb))
                          .replace('{max}', formatNumber(tier.maxGb))
                          .replace('{price}', formatToman(rate))
                          .replace('{currency}', currency)
                      : t('user.shop.volumeTierRow')
                          .replace('{min}', formatNumber(tier.minGb))
                          .replace('{price}', formatToman(rate))
                          .replace('{currency}', currency);
                    return (
                      <div
                        key={tier.id}
                        className={`text-[11px] px-2 py-1 rounded-ctl tnum flex items-center justify-between ${
                          isHit
                            ? 'bg-ok-soft text-ok-fg font-semibold border border-ok/25'
                            : 'text-ink-muted'
                        }`}
                      >
                        <span>{label}</span>
                        {isHit && <Sparkles className="w-3 h-3 shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {isTierDiscounted && (
              <div className="px-2.5 py-1.5 rounded-ctl bg-ok-soft border border-ok/25 text-ok-fg text-[11px] font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>{t('user.shop.tierDiscountApplied')}</span>
              </div>
            )}

            {/* Price & Order CTAs */}
            <div className="flex flex-col gap-3 pt-3 border-t border-line">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div className="flex flex-col">
                  {customOriginalPrice && (
                    <span className="text-[11px] line-through text-ink-muted tnum">
                      <bdi dir="ltr">{formatToman(customOriginalPrice)}</bdi> {currency}
                    </span>
                  )}
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
                </div>
                <span className="text-[11px] text-ink-muted tnum">
                  {t('user.shop.customVolumePricePerGb').replace(
                    '{price}',
                    `${formatToman(effectivePricePerGb)} ${currency}`
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

                <Button
                  size="md"
                  variant={isCustomUnavailable ? 'secondary' : 'primary'}
                  disabled={isCustomUnavailable}
                  onClick={handleOrderCustom}
                  className="flex-1"
                >
                  <Zap className="w-4 h-4 shrink-0" />
                  <span>
                    {isCustomUnavailable
                      ? t('user.shop.soldOutButton')
                      : t('user.shop.customVolumeOrderButton')}
                  </span>
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
