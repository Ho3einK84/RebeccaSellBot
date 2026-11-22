import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Clock, Gift, Trophy, History, CheckCircle2, Lock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { useUserWheelStatus } from '../hooks/useUserPortalData.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Skeleton } from '@/shared/components/ui/Skeleton.js';
import type { LuckyWheelSpinResponse } from '@/shared/types/userPortal.js';

interface LuckyWheelSectionProps {
  currency?: string;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const SLICE_COUNT = 8;
const SLICE_ANGLE = 360 / SLICE_COUNT;

const SLICE_PALETTE = [
  '#0a84ff',
  '#5e5ce6',
  '#30d158',
  '#ff9f0a',
  '#007aff',
  '#bf5af2',
  '#00c7be',
  '#ff375f',
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function buildSlicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

function formatCompactPrize(amount: number, locale: string): string {
  const isFa = locale === 'fa';
  if (amount >= 1_000_000) {
    const val = (amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1);
    return isFa ? `${val}M` : `${val}M`;
  }
  if (amount >= 1_000) {
    const val = Math.round(amount / 1_000);
    return isFa ? `${val.toLocaleString('fa-IR')} هزار` : `${val}K`;
  }
  return amount.toLocaleString(isFa ? 'fa-IR' : 'en-US');
}

function formatCooldownClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hrs, mins, secs].map((n) => String(n).padStart(2, '0')).join(':');
}

export const LuckyWheelSection: React.FC<LuckyWheelSectionProps> = ({
  currency: propCurrency,
  onNotify,
}) => {
  const { t, locale } = useLanguage();
  const { formatToman, formatNumber, formatIsoDate } = useFormatters();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const currency = propCurrency || t('common.currency');
  const { data: wheelData, isLoading } = useUserWheelStatus(true);

  const [rotationDeg, setRotationDeg] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [winResult, setWinResult] = useState<LuckyWheelSpinResponse | null>(null);
  const [remainingSec, setRemainingSec] = useState<number>(0);

  const tickTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAnimTimers = () => {
    for (const timer of tickTimersRef.current) clearTimeout(timer);
    tickTimersRef.current = [];
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearAnimTimers();
  }, []);

  // Live countdown ticker while cooldown is active
  useEffect(() => {
    if (!wheelData?.nextSpinAt || wheelData.canSpin) {
      setRemainingSec(0);
      return;
    }
    const targetMs = new Date(wheelData.nextSpinAt).getTime();
    const update = () => {
      const diff = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
      setRemainingSec(diff);
      if (diff === 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.user.wheel });
        void queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [wheelData?.nextSpinAt, wheelData?.canSpin, queryClient]);

  // Build 8 evenly spread display prizes across [minPrize, maxPrize]
  const sliceValues = useMemo(() => {
    const min = wheelData?.minPrize ?? 1_000;
    const max = wheelData?.maxPrize ?? 50_000;
    if (min >= max) return Array.from({ length: SLICE_COUNT }, () => min);
    const step = (max - min) / (SLICE_COUNT - 1);
    const raw = Array.from({ length: SLICE_COUNT }, (_, i) => {
      const val = min + step * i;
      return Math.max(min, Math.min(max, Math.round(val / 1000) * 1000));
    });
    // Interleave high and low values around the wheel for visual excitement
    const order = [0, 5, 2, 7, 1, 6, 3, 4];
    return order.map((idx) => raw[idx] ?? min);
  }, [wheelData?.minPrize, wheelData?.maxPrize]);

  const handleSpin = async () => {
    if (isSpinning || !wheelData?.canSpin) return;
    setIsSpinning(true);
    setWinResult(null);
    triggerHaptic('medium');

    try {
      const res = await api.spinUserWheel();

      // Find slice closest to server-awarded prize
      let bestIdx = 0;
      let bestDiff = Number.POSITIVE_INFINITY;
      sliceValues.forEach((val, idx) => {
        const diff = Math.abs(val - res.amount);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = idx;
        }
      });

      // Calculate final rotation so pointer at 12 o'clock lands squarely on bestIdx
      const sliceCenterAngle = bestIdx * SLICE_ANGLE + SLICE_ANGLE / 2;
      const targetModulo = (360 - sliceCenterAngle + 360) % 360;
      const currentModulo = ((rotationDeg % 360) + 360) % 360;
      const deltaToTarget = (targetModulo - currentModulo + 360) % 360;
      const fullSpins = 5 * 360;
      setRotationDeg((prev) => prev + fullSpins + deltaToTarget);

      // Schedule decelerating haptic ticks during the 4.2s wheel spin
      clearAnimTimers();
      const tickDelays = [180, 360, 560, 780, 1020, 1300, 1620, 1980, 2400, 2900, 3450, 3900];
      tickTimersRef.current = tickDelays.map((delay) =>
        setTimeout(() => {
          triggerHaptic('selection');
        }, delay)
      );

      finishTimerRef.current = setTimeout(() => {
        setIsSpinning(false);
        setWinResult(res);
        triggerHaptic('success');
        onNotify(
          t('user.wheel.winDesc')
            .replace('{amount}', formatToman(res.amount))
            .replace('{currency}', currency),
          'success'
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.user.wheel });
        void queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
        void queryClient.invalidateQueries({ queryKey: ['user', 'transactions'] });
      }, 4300);
    } catch (err: unknown) {
      setIsSpinning(false);
      triggerHaptic('error');
      let msg = t('user.wheel.errorGeneric');
      if (err instanceof ApiClientError) {
        if (err.code === 'COOLDOWN_ACTIVE') msg = t('user.wheel.cooldownBadge');
        else if (err.code === 'MAX_SPINS_REACHED') msg = t('user.wheel.maxSpinsTitle');
        else if (err.code === 'LUCKY_WHEEL_DISABLED') msg = t('user.wheel.disabledTitle');
      }
      onNotify(msg, 'error');
      void queryClient.invalidateQueries({ queryKey: queryKeys.user.wheel });
    }
  };

  if (isLoading) {
    return (
      <Card padding="lg" className="flex flex-col gap-4">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-56 w-56 rounded-full mx-auto" />
        <Skeleton className="h-11 w-full rounded-ctl" />
      </Card>
    );
  }

  if (!wheelData || !wheelData.enabled) {
    return (
      <Card padding="lg" className="flex items-start gap-3.5 text-start">
        <IconTile tone="neutral" size="lg">
          <Lock />
        </IconTile>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-ink m-0">{t('user.wheel.disabledTitle')}</h3>
          <p className="text-xs text-ink-muted m-0 leading-relaxed">
            {t('user.wheel.disabledDesc')}
          </p>
        </div>
      </Card>
    );
  }

  const spinsLeft = Math.max(0, wheelData.maxSpins - wheelData.totalSpins);
  const isExhausted = wheelData.reason === 'max_spins_reached' || spinsLeft <= 0;
  const isCooldown = !wheelData.canSpin && !isExhausted && remainingSec > 0;

  return (
    <Card padding="lg" className="flex flex-col gap-5 text-start overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <IconTile tone="accent" size="md">
            <Sparkles />
          </IconTile>
          <div className="flex flex-col min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-ink m-0">
              {t('user.wheel.title')}
            </h2>
            <p className="text-xs text-ink-muted mt-0.5 m-0 leading-relaxed">
              {t('user.wheel.subtitle')}
            </p>
          </div>
        </div>

        <Badge
          variant={wheelData.canSpin ? 'success' : isCooldown ? 'warning' : 'neutral'}
          size="xs"
        >
          {wheelData.canSpin
            ? t('user.wheel.readyBadge')
            : isCooldown
              ? t('user.wheel.cooldownBadge')
              : t('user.wheel.exhaustedBadge')}
        </Badge>
      </div>

      {/* Interactive Apple Precision Wheel */}
      <div className="relative flex flex-col items-center justify-center py-3">
        {/* Top precision ticker */}
        <div
          aria-hidden="true"
          className="z-20 -mb-2.5 flex flex-col items-center drop-shadow-[0_3px_8px_rgba(0,0,0,0.45)]"
        >
          <div className="w-3.5 h-5 rounded-full bg-white dark:bg-amber-300 border-2 border-slate-900 shadow-md" />
        </div>

        {/* Wheel wrapper */}
        <div className="relative w-64 h-64 sm:w-72 sm:h-72 select-none">
          <svg
            viewBox="0 0 240 240"
            className="w-full h-full drop-shadow-[0_14px_30px_rgba(0,0,0,0.32)]"
            style={{
              transform: `rotate(${rotationDeg}deg)`,
              transition: isSpinning ? 'transform 4.2s cubic-bezier(0.12, 0.85, 0.16, 1)' : 'none',
            }}
            aria-label={t('user.wheel.title')}
          >
            <defs>
              <radialGradient id="wheelSheen" cx="35%" cy="28%" r="70%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
                <stop offset="55%" stopColor="rgba(255,255,255,0.03)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.18)" />
              </radialGradient>
            </defs>

            {/* Outer Brushed Bezel */}
            <circle
              cx="120"
              cy="120"
              r="116"
              fill="#15171e"
              stroke="rgba(255,255,255,0.28)"
              strokeWidth="3.5"
            />

            {sliceValues.map((val, idx) => {
              const startAngle = idx * SLICE_ANGLE;
              const endAngle = startAngle + SLICE_ANGLE;
              const midAngle = startAngle + SLICE_ANGLE / 2;
              const labelPos = polarToCartesian(120, 120, 76, midAngle);
              const pinPos = polarToCartesian(120, 120, 111, startAngle);
              return (
                <g key={idx}>
                  <path
                    d={buildSlicePath(120, 120, 107, startAngle, endAngle)}
                    fill={SLICE_PALETTE[idx % SLICE_PALETTE.length]}
                    stroke="rgba(255,255,255,0.26)"
                    strokeWidth="1.25"
                  />
                  <text
                    x={labelPos.x}
                    y={labelPos.y}
                    fill="#ffffff"
                    fontSize="11"
                    fontWeight="700"
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${midAngle}, ${labelPos.x}, ${labelPos.y})`}
                  >
                    {formatCompactPrize(val, locale)}
                  </text>
                  <circle cx={pinPos.x} cy={pinPos.y} r="2.2" fill="rgba(255,255,255,0.88)" />
                </g>
              );
            })}

            {/* Glossy Apple glass sheen overlay */}
            <circle cx="120" cy="120" r="107" fill="url(#wheelSheen)" pointerEvents="none" />

            {/* Center hub */}
            <circle
              cx="120"
              cy="120"
              r="25"
              fill="#14161d"
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="2.5"
            />
          </svg>

          {/* Center Spin Trigger Overlay */}
          <button
            type="button"
            onClick={() => void handleSpin()}
            disabled={!wheelData.canSpin || isSpinning}
            aria-label={t('user.wheel.spinButton')}
            className="absolute inset-0 m-auto w-13 h-13 rounded-full bg-white text-[#111318] hover:scale-105 font-bold text-xs flex items-center justify-center shadow-[0_6px_18px_rgba(0,0,0,0.4)] ring-2 ring-white/30 press rs-focus cursor-pointer disabled:opacity-65 disabled:cursor-not-allowed transition-transform"
          >
            <Gift className={`w-5 h-5 text-[#007aff] ${isSpinning ? 'animate-bounce' : ''}`} />
          </button>
        </div>
      </div>

      {/* Celebration Win Card */}
      {winResult && (
        <div className="anim-pop rounded-tile border border-ok/35 bg-ok-soft p-3.5 flex items-start gap-3">
          <IconTile tone="ok" size="sm">
            <Trophy />
          </IconTile>
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs sm:text-sm font-semibold text-ok-fg">
                {t('user.wheel.winTitle')}
              </span>
              <bdi dir="ltr" className="text-sm sm:text-base font-bold tnum text-ok-fg">
                +{formatToman(winResult.amount)} {currency}
              </bdi>
            </div>
            <p className="text-[11px] text-ink-soft m-0">
              {t('user.wheel.newBalanceLabel')}:{' '}
              <bdi dir="ltr" className="font-semibold tnum text-ink">
                {formatToman(winResult.balanceAfter)}
              </bdi>{' '}
              {currency}
            </p>
          </div>
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-tile border border-line bg-surface-2 p-3 flex flex-col gap-0.5">
          <span className="text-[11px] text-ink-muted">{t('user.wheel.prizeRangeLabel')}</span>
          <span className="text-xs sm:text-sm font-semibold text-ink tnum">
            <bdi dir="ltr">
              {formatToman(wheelData.minPrize)} – {formatToman(wheelData.maxPrize)}
            </bdi>{' '}
            <span className="text-[10px] font-normal text-ink-muted">{currency}</span>
          </span>
        </div>

        <div className="rounded-tile border border-line bg-surface-2 p-3 flex flex-col gap-0.5">
          <span className="text-[11px] text-ink-muted">{t('user.wheel.spinsLeftLabel')}</span>
          <span className="text-xs sm:text-sm font-semibold text-ink tnum">
            {formatNumber(spinsLeft)} / {formatNumber(wheelData.maxSpins)}
          </span>
        </div>
      </div>

      {/* Primary Action / Cooldown / Exhausted */}
      {wheelData.canSpin ? (
        <Button
          type="button"
          variant="primary"
          size="md"
          block
          loading={isSpinning}
          disabled={isSpinning}
          onClick={() => void handleSpin()}
        >
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>{isSpinning ? t('user.wheel.spinning') : t('user.wheel.spinButton')}</span>
        </Button>
      ) : isCooldown ? (
        <div className="rounded-tile border border-warn/30 bg-warn-soft p-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-warn-fg font-medium">
            <Clock className="w-4 h-4 shrink-0" />
            <span>{t('user.wheel.nextSpinLabel')}</span>
          </div>
          <bdi dir="ltr" className="font-mono text-sm font-bold tnum text-warn-fg">
            {formatCooldownClock(remainingSec)}
          </bdi>
        </div>
      ) : (
        <div className="rounded-tile border border-line bg-surface-2 p-3 flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-ink-muted shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold text-ink">{t('user.wheel.maxSpinsTitle')}</span>
            <span className="text-[11px] text-ink-muted leading-relaxed">
              {t('user.wheel.maxSpinsDesc')}
            </span>
          </div>
        </div>
      )}

      {/* Recent Spin History */}
      {wheelData.history && wheelData.history.length > 0 && (
        <div className="flex flex-col gap-2 pt-3 border-t border-line">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
            <History className="w-3.5 h-3.5" />
            <span>{t('user.wheel.historyTitle')}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {wheelData.history.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-tile bg-surface-2 border border-line px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-ink">
                    {t('user.wheel.spinLabel').replace('{num}', formatNumber(item.spinNumber))}
                  </span>
                  <span className="text-[11px] text-ink-muted truncate">
                    {formatIsoDate(item.createdAt)}
                  </span>
                </div>
                <bdi dir="ltr" className="font-semibold tnum text-ok-fg shrink-0">
                  +{formatToman(item.amount)} {currency}
                </bdi>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};
