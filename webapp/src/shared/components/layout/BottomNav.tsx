import React from 'react';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';

export interface BottomNavItem<T extends string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Numeric badge (e.g. pending receipts). */
  count?: number;
  /** Dot badge for "something needs attention" without a count. */
  dot?: boolean;
}

interface BottomNavProps<T extends string> {
  items: BottomNavItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
  /** Show on small screens only (default) or always. */
  className?: string;
}

/**
 * The single bottom navigation used by the admin panel and the user portal.
 *
 * Fixes the drift the two previous copies had:
 *  - one sliding active pill instead of "pill + filled icon + extra dot";
 *  - badges keep a canvas-coloured ring so they no longer merge into the bar;
 *  - every item is a 52px touch target, evenly sized by the grid;
 *  - safe-area inset is honoured, and the bar's height is matched by
 *    `nav-inset` on the scroll container so content never hides behind it.
 */
export function BottomNav<T extends string>({
  items,
  activeId,
  onSelect,
  ariaLabel,
  className = '',
}: BottomNavProps<T>) {
  const { formatNumber } = useFormatters();
  const { triggerHaptic } = useHaptic();
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === activeId)
  );
  const share = 100 / items.length;

  return (
    <nav
      aria-label={ariaLabel}
      className={`md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-line bg-canvas/85 backdrop-blur-2xl shadow-[0_-8px_28px_rgba(0,0,0,0.28)] ${className}`}
    >
      <div
        className="relative mx-auto grid max-w-md"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {/* sliding active pill */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1.5 h-7 transition-[inset-inline-start] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ insetInlineStart: `${activeIndex * share}%`, width: `${share}%` }}
        >
          <span className="mx-auto block h-7 w-11 rounded-full bg-brand-soft ring-1 ring-brand/25 anim-pop" />
        </span>

        {items.map((item) => {
          const isActive = item.id === activeId;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                triggerHaptic('selection');
                onSelect(item.id);
              }}
              className="press relative flex min-h-[52px] w-full min-w-0 flex-col items-center justify-start px-0.5 pt-1.5 pb-[max(env(safe-area-inset-bottom,0px),0.62rem)] cursor-pointer select-none"
            >
              <span className="relative flex h-7 w-7 items-center justify-center">
                <Icon
                  className={`w-[18px] h-[18px] transition-colors duration-200 ${
                    isActive ? 'text-brand' : 'text-ink-muted'
                  }`}
                />
                {item.count !== undefined && item.count > 0 ? (
                  <span className="absolute -top-1.5 -end-1.5 min-w-[17px] h-[17px] px-1 rounded-full bg-brand text-brand-ink font-bold text-[10px] leading-none flex items-center justify-center tnum ring-2 ring-canvas">
                    {formatNumber(item.count)}
                  </span>
                ) : null}
                {item.dot ? (
                  <span className="absolute -top-1 -end-1 h-[9px] w-[9px] rounded-full bg-warn ring-2 ring-canvas anim-breathe" />
                ) : null}
              </span>
              <span
                className={`mt-0.5 w-full max-w-full truncate text-center text-[10px] leading-tight transition-colors duration-200 ${
                  isActive ? 'text-ink font-semibold' : 'text-ink-muted font-medium'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
