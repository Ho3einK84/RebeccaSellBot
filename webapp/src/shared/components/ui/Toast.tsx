import React from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { useTheme } from '@/shared/theme/ThemeContext.js';

export interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'warning';
  onDismiss?: () => void;
  className?: string;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'success',
  onDismiss,
  className = '',
}) => {
  const { isDark } = useTheme();

  const variantStyles = {
    success: isDark
      ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 shadow-emerald-950/20'
      : 'bg-emerald-50/90 border-emerald-200 text-emerald-900 shadow-emerald-100/50',
    error: isDark
      ? 'bg-rose-950/40 border-rose-500/30 text-rose-300 shadow-rose-950/20'
      : 'bg-rose-50/90 border-rose-200 text-rose-900 shadow-rose-100/50',
    warning: isDark
      ? 'bg-amber-950/40 border-amber-500/30 text-amber-300 shadow-amber-950/20'
      : 'bg-amber-50/90 border-amber-200 text-amber-900 shadow-amber-100/50',
  }[type];

  const iconBg = {
    success: isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700',
    error: isDark ? 'bg-rose-500/20 text-rose-400' : 'bg-rose-100 text-rose-700',
    warning: isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700',
  }[type];

  return (
    <div
      className={`p-3 sm:p-3.5 rounded-2xl text-xs sm:text-sm font-medium flex items-center justify-between gap-3 border backdrop-blur-md shadow-lg transition-all animate-in fade-in slide-in-from-top-2 duration-200 ${variantStyles} ${className}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
          {type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
        </div>
        <span className="truncate">{message}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="p-1.5 rounded-xl opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
