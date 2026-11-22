import React from 'react';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

export type SegmentedTone = 'default' | 'brand' | 'ok' | 'warn' | 'danger';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  count?: string | number | null;
  tone?: SegmentedTone;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  role?: 'tablist' | 'group';
  fullWidth?: boolean;
  className?: string;
}

const activeToneClasses: Record<SegmentedTone, string> = {
  default:
    'bg-surface dark:bg-surface-3 border-line text-ink font-semibold shadow-[var(--shadow-xs)]',
  brand:
    'bg-surface dark:bg-surface-3 border-brand/30 text-brand-fg font-semibold shadow-[var(--shadow-xs)]',
  ok: 'bg-surface dark:bg-surface-3 border-ok/30 text-ok-fg font-semibold shadow-[var(--shadow-xs)]',
  warn: 'bg-surface dark:bg-surface-3 border-warn/35 text-warn-fg font-semibold shadow-[var(--shadow-xs)]',
  danger:
    'bg-surface dark:bg-surface-3 border-danger/30 text-danger-fg font-semibold shadow-[var(--shadow-xs)]',
};

const activeBadgeToneClasses: Record<SegmentedTone, string> = {
  default: 'bg-brand-soft text-brand-fg',
  brand: 'bg-brand-soft text-brand-fg',
  ok: 'bg-ok-soft text-ok-fg',
  warn: 'bg-warn text-warn-ink',
  danger: 'bg-danger-soft text-danger-fg',
};

/**
 * Unified matte segmented switcher shared across Admin and User Portal views.
 * Eliminates mismatched tab-rail styling and ensures clean RTL scroll & contrast.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  role = 'tablist',
  fullWidth = true,
  className = '',
}: SegmentedControlProps<T>) {
  const { triggerHaptic } = useHaptic();

  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={`p-1 rounded-tile bg-surface-2/90 border border-line shadow-[var(--shadow-inset-track)] flex items-center gap-1 overflow-x-auto no-scrollbar overscroll-x-contain touch-pan-x ${className}`}
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = opt.id === value;
        const tone = opt.tone ?? 'default';

        return (
          <button
            key={opt.id}
            type="button"
            role={role === 'tablist' ? 'tab' : undefined}
            aria-selected={role === 'tablist' ? active : undefined}
            aria-pressed={role === 'group' ? active : undefined}
            onClick={() => {
              if (!active) {
                triggerHaptic('selection');
                onChange(opt.id);
              }
            }}
            className={`${
              fullWidth ? 'flex-1 min-w-max' : 'shrink-0'
            } h-9 px-3 rounded-ctl text-xs cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none border transition-all duration-200 rs-focus press ${
              active
                ? activeToneClasses[tone]
                : 'border-transparent text-ink-soft hover:text-ink font-medium'
            }`}
          >
            {Icon ? <Icon className="w-3.5 h-3.5 shrink-0" /> : null}
            <span className="truncate">{opt.label}</span>
            {opt.count !== undefined && opt.count !== null ? (
              <span
                className={`tnum inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-none shrink-0 ${
                  active ? activeBadgeToneClasses[tone] : 'bg-surface-3 text-ink-muted'
                }`}
              >
                {opt.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
