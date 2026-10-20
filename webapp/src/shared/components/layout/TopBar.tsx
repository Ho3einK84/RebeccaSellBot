import React, { type ReactNode } from 'react';

export interface TopBarProps {
  /** Brand mark / avatar tile rendered before the title. */
  icon?: ReactNode;
  title: string;
  badge?: ReactNode;
  /** Secondary line under the title (role, welcome name, …). */
  subtitle?: ReactNode;
  /** Utility icon buttons rendered on the trailing edge. */
  actions?: ReactNode;
  /** Identity strip rendered under a hairline (avatar, chips, id, balance). */
  footer?: ReactNode;
  className?: string;
}

/**
 * The single header used by the admin panel and the user portal.
 *
 * Before this existed each panel had its own header markup (one card, one
 * bare block), its own radius scale and its own button sizes, which is what
 * made the two halves of the mini app feel like different apps.
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
    className={`relative z-10 mb-3 rounded-card border border-line bg-surface/85 p-3 shadow-e2 backdrop-blur-xl ${className}`}
  >
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="m-0 truncate text-sm font-bold tracking-tight text-ink sm:text-[15px]">
              {title}
            </h1>
            {badge}
          </div>
          {subtitle ? (
            <div className="mt-0.5 truncate text-[11px] text-ink-muted">{subtitle}</div>
          ) : null}
        </div>
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>

    {footer ? (
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2.5">
        {footer}
      </div>
    ) : null}
  </header>
);
