import type { BottomNavItem } from './BottomNav.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';

interface DesktopNavProps<T extends string> {
  items: BottomNavItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  /** Accessible name for the tab rail. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Desktop/tablet tab rail — the same information architecture and the same
 * active treatment as the mobile `BottomNav`, so both panels behave
 * identically whether the mini app is opened in Telegram desktop or on a phone.
 */
export function DesktopNav<T extends string>({
  items,
  activeId,
  onSelect,
  ariaLabel = 'ناوبری',
  className = '',
}: DesktopNavProps<T>) {
  const { formatNumber } = useFormatters();
  return (
    <nav
      className={`hidden md:flex items-center gap-1 p-1 mb-5 rounded-card border border-line bg-surface/70 backdrop-blur-xl shadow-e1 ${className}`}
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        const Icon = item.icon;

        return (
          <button
            key={item.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(item.id)}
            className={`press rs-focus inline-flex items-center gap-2 h-10 px-3.5 rounded-tile text-xs font-medium select-none cursor-pointer ${
              isActive
                ? 'bg-brand-soft text-ink border border-brand/25'
                : 'text-ink-muted hover:text-ink hover:bg-surface-2 border border-transparent'
            }`}
          >
            <Icon className={`w-4 h-4 ${isActive ? 'text-brand' : 'opacity-70'}`} />
            <span>{item.label}</span>
            {item.count !== undefined && item.count > 0 ? (
              <span className="px-1.5 h-5 inline-flex items-center rounded-full text-[10px] font-bold tnum bg-brand text-brand-ink">
                {formatNumber(item.count)}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
