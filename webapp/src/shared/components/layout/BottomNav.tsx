import React from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';

export interface BottomNavItem<T extends string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Numeric badge (e.g. pending receipts or service count). */
  count?: number;
  /** Optional per-item numeric badge accent colour override. */
  badgeTone?: 'brand' | 'warn' | 'danger';
  /** Dot badge for quiet attention state without a count. */
  dot?: boolean;
  /** Optional dot colour tone. */
  dotTone?: 'ok' | 'warn' | 'danger';
}

interface BottomNavProps<T extends string> {
  items: BottomNavItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
  /** Optional accent colour override kept subtle for unread counts. */
  badgeTone?: 'brand' | 'warn' | 'danger';
  className?: string;
}

/**
 * Shared fixed bottom dock (`< md`) styled with matte translucency,
 * crisp active top rail, full safe-area support, and adaptive 5/6-item density.
 */
export function BottomNav<T extends string>({
  items,
  activeId,
  onSelect,
  ariaLabel,
  badgeTone = 'brand',
  className = '',
}: BottomNavProps<T>) {
  const { locale } = useLanguage();
  const { formatNumber } = useFormatters();
  const isDense = items.length >= 6;

  return (
    <nav
      aria-label={ariaLabel}
      className={`fixed inset-x-0 bottom-0 z-40 md:hidden border-t border-line bg-surface/94 dark:bg-[#0d0f15]/92 rs-backdrop-blur shadow-[var(--shadow-nav)] safe-bottom ${className}`}
    >
      <div className="mx-auto grid h-[66px] max-w-xl grid-flow-col auto-cols-fr items-stretch px-1.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          const itemTone = item.badgeTone ?? badgeTone;
          const badgeBg =
            itemTone === 'danger'
              ? 'bg-danger text-white'
              : itemTone === 'warn'
                ? 'bg-warn-soft text-warn-fg border border-warn/40'
                : 'bg-brand text-brand-ink';
          const dotBg =
            item.dotTone === 'ok' ? 'bg-ok' : item.dotTone === 'danger' ? 'bg-danger' : 'bg-warn';
          const countStr =
            item.count !== undefined && item.count > 0
              ? item.count > 99
                ? locale === 'fa'
                  ? '۹۹+'
                  : '99+'
                : formatNumber(item.count)
              : null;

          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-w-0 min-h-11 px-0.5 rs-focus press cursor-pointer select-none transition-colors duration-150 ${
                active ? 'text-brand-fg' : 'text-ink-muted hover:text-ink-soft'
              }`}
            >
              <span
                className={`relative flex h-7 ${isDense ? 'w-11' : 'w-12'} items-center justify-center rounded-full transition-colors duration-200`}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-brand-soft anim-pop"
                  />
                ) : null}

                <Icon
                  className={`relative w-[19px] h-[19px] transition-transform duration-200 ease-[var(--ease-spring)] ${
                    active ? 'scale-105 stroke-[2.25]' : 'stroke-[1.75]'
                  }`}
                />

                {countStr !== null ? (
                  <bdi
                    dir="ltr"
                    className={`tnum absolute -top-0.5 end-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ring-2 ring-surface ${badgeBg}`}
                  >
                    {countStr}
                  </bdi>
                ) : item.dot ? (
                  <span
                    className={`absolute top-0.5 end-1.5 w-2 h-2 rounded-full ring-2 ring-surface ${dotBg}`}
                    aria-hidden="true"
                  />
                ) : null}
              </span>

              <span
                className={`truncate max-w-full ${
                  isDense ? 'text-[10px] sm:text-[11px]' : 'text-[10.5px] sm:text-[11px]'
                } leading-tight ${active ? 'font-semibold' : 'font-medium'}`}
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
