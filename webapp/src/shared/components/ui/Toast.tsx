import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, AlertTriangle, X } from 'lucide-react';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

export type ToastType = 'success' | 'error' | 'warning';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

export interface ToastProps {
  message: string;
  type?: ToastType;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'success',
  onDismiss,
  dismissLabel = 'Dismiss',
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
      className={`pointer-events-auto flex items-center gap-2.5 w-full rounded-tile border border-line-strong border-s-4 bg-surface/94 rs-backdrop-blur text-ink px-3 py-2.5 text-xs font-medium shadow-[var(--shadow-popover)] anim-toast ${toneConfig.accent} ${className}`}
    >
      <span
        className={`w-6 h-6 rounded-ctl inline-flex items-center justify-center shrink-0 anim-pop ${toneConfig.badge}`}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <span className="flex-1 min-w-0 leading-relaxed text-start">{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="w-7 h-7 rounded-ctl inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-2 rs-focus cursor-pointer shrink-0"
          aria-label={dismissLabel}
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
  dismissLabel?: string;
  className?: string;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onDismiss,
  dismissLabel,
  className = '',
}) => {
  if (toasts.length === 0) return null;

  const content = (
    <div
      className={`fixed inset-x-3.5 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-sm z-[1100] flex flex-col gap-2 pointer-events-none ${className}`}
      style={{ top: 'calc(0.875rem + var(--rs-safe-top, 0px))' }}
    >
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          dismissLabel={dismissLabel}
          onDismiss={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(content, document.body);
  }

  return content;
};

export function enqueueToast(
  current: ToastItem[],
  message: string,
  type: ToastType = 'success',
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

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

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
    (message: string, type: ToastType = 'success') => {
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

interface ToastContextValue {
  notify: (message: string, type?: ToastType) => string;
  dismissToast: (id: string) => void;
  clearAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Single unified toast provider shared by Admin Console, User Portal, and Auth flows.
 * Always renders above Modal sheets (`z-[1100]`) and respects safe-area insets.
 */
export const ToastProvider: React.FC<{ children: ReactNode; dismissLabel?: string }> = ({
  children,
  dismissLabel,
}) => {
  const { toasts, showToast, dismissToast, clearAll } = useToastQueue(3600);
  const { triggerHaptic } = useHaptic();

  const notify = useCallback(
    (message: string, type: ToastType = 'success') => {
      triggerHaptic(type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'error');
      return showToast(message, type);
    },
    [showToast, triggerHaptic]
  );

  return (
    <ToastContext.Provider value={{ notify, dismissToast, clearAll }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} dismissLabel={dismissLabel} />
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
