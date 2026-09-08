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
      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
      : 'bg-emerald-50 border-emerald-200 text-emerald-800',
    error: isDark
      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
      : 'bg-rose-50 border-rose-200 text-rose-800',
    warning: isDark
      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
      : 'bg-amber-50 border-amber-200 text-amber-800',
  }[type];

  return (
    <div
      className={`p-3.5 rounded-xl text-xs sm:text-sm font-medium flex items-center justify-between gap-2 border transition-all animate-in fade-in slide-in-from-top-2 duration-150 ${variantStyles} ${className}`}
    >
      <div className="flex items-center gap-2">
        {type === 'success' ? (
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
        ) : (
          <AlertTriangle
            className={`w-4 h-4 shrink-0 ${type === 'error' ? 'text-rose-500' : 'text-amber-500'}`}
          />
        )}
        <span>{message}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="p-1 rounded-md opacity-70 hover:opacity-100 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
