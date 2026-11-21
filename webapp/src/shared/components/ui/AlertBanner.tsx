import React, { type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export type AlertTone = 'info' | 'warn' | 'danger' | 'ok' | 'neutral';

interface AlertBannerProps {
  tone?: AlertTone;
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  dashed?: boolean;
  className?: string;
}

const toneClasses: Record<AlertTone, string> = {
  info: 'bg-info-soft border-info/25 text-info-fg',
  warn: 'bg-warn-soft border-warn/30 text-warn-fg',
  danger: 'bg-danger-soft border-danger/25 text-danger-fg',
  ok: 'bg-ok-soft border-ok/25 text-ok-fg',
  neutral: 'bg-surface-2 border-line text-ink-soft',
};

const defaultIcons: Record<AlertTone, React.ComponentType<{ className?: string }>> = {
  info: Info,
  warn: AlertTriangle,
  danger: AlertCircle,
  ok: CheckCircle2,
  neutral: Info,
};

/** Accessible inline callout banner guaranteeing AA+ foreground contrast on soft tints. */
export const AlertBanner: React.FC<AlertBannerProps> = ({
  tone = 'info',
  icon,
  children,
  action,
  dashed = false,
  className = '',
}) => {
  const DefaultIcon = defaultIcons[tone];

  return (
    <div
      className={`p-3 rounded-tile border ${dashed ? 'border-dashed' : ''} text-xs flex items-start justify-between gap-2.5 flex-wrap leading-relaxed ${toneClasses[tone]} ${className}`}
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <span className="shrink-0 mt-0.5 [&>svg]:w-4 [&>svg]:h-4" aria-hidden="true">
          {icon ?? <DefaultIcon />}
        </span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
};
