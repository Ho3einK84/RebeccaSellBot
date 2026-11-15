import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { BottomNavItem } from './BottomNav.js';

interface DesktopNavProps<T extends string> {
  items: BottomNavItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
}

/**
 * Clean tabbed instrument rail on `md+` screens aligned with the matte surface system.
 * Uses a sharp bottom indicator rule instead of bulky pill buttons.
 */
export function DesktopNav<T extends string>({
  items,
  activeId,
  onSelect,
  ariaLabel,
}: DesktopNavProps<T>) {
  const { locale } = useLanguage();
  const { formatNumber } = useFormatters();

  return (
    <nav
      aria-label={ariaLabel}
      className="hidden md:flex items-center gap-1 border-b border-line px-1 overflow-x-auto no-scrollbar"
    >
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
            className={`relative inline-flex h-11 items-center gap-2 px-3.5 text-[13px] whitespace-nowrap rounded-t-ctl rs-focus cursor-pointer transition-colors duration-150 ${
              active
                ? 'font-semibold text-ink'
                : 'font-medium text-ink-soft hover:text-ink hover:bg-surface-2'
            }`}
          >
            <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-brand-fg' : 'text-ink-muted'}`} />
            <span>{item.label}</span>
            {countStr !== null ? (
              <span
                className={`tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium ${
                  active
                    ? 'bg-brand-soft text-brand-fg'
                    : 'bg-surface-2 text-ink-soft border border-line'
                }`}
              >
                {countStr}
              </span>
            ) : item.dot ? (
              <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" aria-hidden="true" />
            ) : null}
            {active ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-2.5 bottom-0 h-0.5 rounded-t-full bg-brand"
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
