import React from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';

export interface BottomNavItem<T extends string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Numeric badge (e.g. pending receipts or service count). */
  count?: number;
  /** Dot badge for quiet attention state without a count. */
  dot?: boolean;
}

interface BottomNavProps<T extends string> {
  items: BottomNavItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
  /** Optional accent colour override kept subtle for unread counts. */
  badgeTone?: 'brand' | 'danger';
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
  const badgeBg = badgeTone === 'danger' ? 'bg-danger text-white' : 'bg-brand text-brand-ink';
  const isDense = items.length >= 6;

  return (
    <nav
      aria-label={ariaLabel}
      className={`fixed inset-x-0 bottom-0 z-40 md:hidden border-t border-line bg-surface/95 rs-backdrop-blur shadow-[var(--shadow-popover)] safe-bottom ${className}`}
    >
      <div className="mx-auto grid h-16 max-w-xl grid-flow-col auto-cols-fr items-stretch px-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
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
              className={`relative flex flex-col items-center justify-center gap-0.5 min-w-0 min-h-11 px-0.5 rs-focus press cursor-pointer select-none ${
                active ? 'text-brand-fg' : 'text-ink-muted hover:text-ink-soft'
              }`}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute top-0 ${isDense ? 'inset-x-2' : 'inset-x-3.5'} h-0.5 rounded-b-full bg-brand`}
                />
              ) : null}

              <span
                className={`relative flex h-7 ${isDense ? 'w-9' : 'w-10'} items-center justify-center rounded-ctl`}
              >
                {active ? (
                  <span aria-hidden="true" className="absolute inset-0 rounded-ctl bg-brand-soft" />
                ) : null}

                <Icon
                  className={`relative w-[18px] h-[18px] transition-transform duration-150 ${
                    active ? 'stroke-[2.2]' : 'stroke-[1.75]'
                  }`}
                />

                {countStr !== null ? (
                  <bdi
                    dir="ltr"
                    className={`tnum absolute -top-1 end-0 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ring-2 ring-surface ${badgeBg}`}
                  >
                    {countStr}
                  </bdi>
                ) : item.dot ? (
                  <span
                    className="absolute top-0.5 end-1 w-2 h-2 rounded-full bg-warn ring-2 ring-surface"
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
