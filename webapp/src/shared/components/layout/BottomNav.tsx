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
 * Shared fixed bottom bar (`< md`) styled as an opaque instrument dock with
 * clean top edge rail and zero idle looping dot animations.
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

  return (
    <nav
      aria-label={ariaLabel}
      className={`fixed inset-x-0 bottom-0 z-40 md:hidden border-t border-line bg-surface shadow-[var(--shadow-popover)] safe-bottom ${className}`}
    >
      <div className="mx-auto grid h-16 max-w-lg grid-flow-col auto-cols-fr items-stretch px-1.5">
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
              className={`relative flex flex-col items-center justify-center gap-1 min-w-0 min-h-11 px-1 rs-focus press cursor-pointer select-none ${
                active ? 'text-brand-fg' : 'text-ink-muted hover:text-ink-soft'
              }`}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 inset-x-4 h-0.5 rounded-b-full bg-brand"
                />
              ) : null}

              <span className="relative flex h-7 w-11 items-center justify-center rounded-ctl">
                {active ? (
                  <span aria-hidden="true" className="absolute inset-0 rounded-ctl bg-brand-soft" />
                ) : null}

                <Icon
                  className={`relative w-[18px] h-[18px] transition-transform duration-150 ${
                    active ? 'stroke-[2.2]' : 'stroke-[1.75]'
                  }`}
                />

                {countStr !== null ? (
                  <span
                    className={`tnum absolute -top-0.5 -end-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none ${badgeBg}`}
                  >
                    {countStr}
                  </span>
                ) : item.dot ? (
                  <span
                    className="absolute top-1 end-2 w-1.5 h-1.5 rounded-full bg-warn"
                    aria-hidden="true"
                  />
                ) : null}
              </span>

              <span
                className={`truncate max-w-full text-[11px] leading-tight ${
                  active ? 'font-semibold' : 'font-medium'
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
