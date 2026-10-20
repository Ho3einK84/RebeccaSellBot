import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

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
  const variantStyles = {
    success: 'bg-ok/40 border-ok/30 text-ok shadow-ok/20 shadow-ok/50',
    error: 'bg-danger/40 border-danger/30 text-danger shadow-danger/20 shadow-danger/50',
    warning: 'bg-warn/40 border-warn/30 text-warn shadow-warn/20 shadow-warn/50',
  }[type];

  const iconBg = {
    success: 'bg-ok/20 text-ok',
    error: 'bg-danger/20 text-danger',
    warning: 'bg-warn/20 text-warn',
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
          className="min-h-[44px] min-w-[44px] p-2 rounded-xl opacity-70 hover:opacity-100 hover:bg-ink/[0.06] transition-all cursor-pointer shrink-0 flex items-center justify-center active:scale-95"
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
  const toastsRef = useRef<ToastItem[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    toastsRef.current = toastsRef.current.filter((t) => t.id !== id);
    setToasts(toastsRef.current);
  }, []);

  const addToast = useCallback(
    (
      message: string,
      type: 'success' | 'error' | 'warning' = 'success',
      timeout = defaultTimeout
    ) => {
      const existing = toastsRef.current.find((t) => t.message === message && t.type === type);
      if (existing) {
        return existing.id;
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newToast: ToastItem = { id, message, type };
      toastsRef.current = [...toastsRef.current, newToast];
      setToasts(toastsRef.current);

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
