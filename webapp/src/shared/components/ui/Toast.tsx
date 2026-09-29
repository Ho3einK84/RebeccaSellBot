import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { useTheme } from '@/shared/theme/ThemeContext.js';

export interface ToastItem {
  id: string;
  message: string;
  type?: 'success' | 'error' | 'warning';
}

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
      role="status"
      aria-live="polite"
      className={`p-3 sm:p-3.5 rounded-2xl text-xs sm:text-sm font-medium flex items-center justify-between gap-3 border backdrop-blur-md shadow-lg transition-all animate-toast-in ${variantStyles} ${className}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
          {type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
        </div>
        <span className="break-words text-xs leading-tight">{message}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-[44px] min-w-[44px] p-2 rounded-xl opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-all cursor-pointer shrink-0 flex items-center justify-center active:scale-95"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

export interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  className?: string;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onDismiss,
  className = '',
}) => {
  if (toasts.length === 0) return null;

  return createPortal(
    <aside
      aria-live="polite"
      role="region"
      aria-label="Notifications"
      className={`fixed inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-md z-[100000] pointer-events-none flex flex-col gap-2 ${className}`}
      style={{ top: 'max(1rem, env(safe-area-inset-top, 1rem))' }}
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto w-full">
          <Toast message={toast.message} type={toast.type} onDismiss={() => onDismiss(toast.id)} />
        </div>
      ))}
    </aside>,
    document.body
  );
};

export function useToastQueue(defaultTimeout = 3500) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (
      message: string,
      type: 'success' | 'error' | 'warning' = 'success',
      timeout = defaultTimeout
    ) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => {
        const exists = prev.some((t) => t.message === message && t.type === type);
        if (exists) return prev;
        return [...prev, { id, message, type }];
      });

      const timer = setTimeout(() => {
        removeToast(id);
      }, timeout);
      timersRef.current.set(id, timer);

      return id;
    },
    [defaultTimeout, removeToast]
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  return { toasts, addToast, removeToast };
}
