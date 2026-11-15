import React, { type ReactNode } from 'react';

export interface TopBarProps {
  /** Brand mark / avatar tile rendered before the title. */
  icon?: ReactNode;
  title: string;
  badge?: ReactNode;
  /** Secondary line under the title (role, username, status). */
  subtitle?: ReactNode;
  /** Utility icon buttons rendered on the trailing edge. */
  actions?: ReactNode;
  /** Identity strip rendered under a clean hairline divider. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Unified top chrome shared by Coming-Soon, User Portal, and Admin Panel.
 * Uses flat matte surface depth and crisp 1px structural borders with zero glassmorphism.
 */
export const TopBar: React.FC<TopBarProps> = ({
  icon,
  title,
  badge,
  subtitle,
  actions,
  footer,
  className = '',
}) => (
  <header
    className={`rounded-card border border-line bg-surface px-4 py-3 shadow-[var(--shadow-card)] ${className}`}
  >
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {icon}
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="truncate font-semibold text-base text-ink leading-[1.4] m-0">{title}</h1>
            {badge}
          </div>
          {subtitle ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      {actions ? <div className="flex items-center gap-1.5 shrink-0">{actions}</div> : null}
    </div>

    {footer ? (
      <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2.5 text-xs">
        {footer}
      </div>
    ) : null}
  </header>
);
