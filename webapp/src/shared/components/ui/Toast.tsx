import React, { useState, useCallback, useRef } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning';
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
  const toneConfig = {
    success: {
      accent: 'border-s-ok',
      badge: 'bg-ok-soft text-ok-fg',
      Icon: CheckCircle2,
    },
    error: {
      accent: 'border-s-danger',
      badge: 'bg-danger-soft text-danger-fg',
      Icon: AlertCircle,
    },
    warning: {
      accent: 'border-s-warn',
      badge: 'bg-warn-soft text-warn-fg',
      Icon: AlertTriangle,
    },
  }[type];

  const Icon = toneConfig.Icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex items-center gap-2.5 w-full rounded-tile border border-line-strong border-s-4 bg-surface text-ink px-3 py-2.5 text-xs font-medium shadow-[var(--shadow-popover)] anim-rise ${toneConfig.accent} ${className}`}
    >
      <span
        className={`w-6 h-6 rounded-ctl inline-flex items-center justify-center shrink-0 ${toneConfig.badge}`}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <span className="flex-1 min-w-0 leading-relaxed">{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="w-7 h-7 rounded-ctl inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-2 rs-focus cursor-pointer shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ) : null}
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

  return (
    <div
      className={`fixed top-3.5 inset-x-3.5 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-sm z-50 flex flex-col gap-2 pointer-events-none ${className}`}
    >
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onDismiss={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  );
};

export function enqueueToast(
  current: ToastItem[],
  message: string,
  type: 'success' | 'error' | 'warning' = 'success',
  customId?: string,
  maxVisible = 3
): { toasts: ToastItem[]; id: string; added: boolean } {
  const existing = current.find((t) => t.message === message && t.type === type);
  if (existing) {
    return { toasts: current, id: existing.id, added: false };
  }

  const id = customId ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const next = [...current, { id, message, type }];
  const trimmed = next.length > maxVisible ? next.slice(next.length - maxVisible) : next;
  return { toasts: trimmed, id, added: true };
}

export function dequeueToast(current: ToastItem[], id: string): ToastItem[] {
  return current.filter((t) => t.id !== id);
}

export function useToastQueue(defaultTimeout = 3500) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastsRef = useRef<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    const next = dequeueToast(toastsRef.current, id);
    toastsRef.current = next;
    setToasts(next);
  }, []);

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
      const result = enqueueToast(toastsRef.current, message, type);
      if (!result.added) {
        return result.id;
      }

      toastsRef.current = result.toasts;
      setToasts(result.toasts);

      const timer = setTimeout(() => {
        timersRef.current.delete(result.id);
        const next = dequeueToast(toastsRef.current, result.id);
        toastsRef.current = next;
        setToasts(next);
      }, defaultTimeout);
      timersRef.current.set(result.id, timer);

      return result.id;
    },
    [defaultTimeout]
  );

  const clearAll = useCallback(() => {
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
    toastsRef.current = [];
    setToasts([]);
  }, []);

  return { toasts, showToast, dismissToast, clearAll };
}
