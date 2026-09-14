import React, { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';

// Global stack for escape key handling across stacked modals
const escapeHandlers: (() => void)[] = [];
let openModalsCount = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && escapeHandlers.length > 0) {
      const topHandler = escapeHandlers[escapeHandlers.length - 1];
      topHandler?.();
    }
  });
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
  closeOnBackdrop?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  children,
  maxWidth = 'lg',
  closeOnBackdrop = true,
}) => {
  const { modalBoxClass, textPrimary } = useThemeTokens();

  // Telegram back button integration: closes modal when user taps Back
  useTelegramBackButton(onClose, isOpen);

  // Robust body scroll lock ref-counted across all open modals
  useEffect(() => {
    if (!isOpen) return;
    openModalsCount++;
    if (openModalsCount === 1) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      openModalsCount = Math.max(0, openModalsCount - 1);
      if (openModalsCount === 0) {
        document.body.style.overflow = '';
      }
    };
  }, [isOpen]);

  // Keyboard Escape listener using LIFO stack (only top modal closes)
  useEffect(() => {
    if (!isOpen) return;
    escapeHandlers.push(onClose);
    return () => {
      const idx = escapeHandlers.lastIndexOf(onClose);
      if (idx !== -1) escapeHandlers.splice(idx, 1);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
  }[maxWidth];

  const modal = (
    <div
      className="fixed inset-0 w-screen z-[9999] flex items-center justify-center p-3 sm:p-4"
      style={{ height: '100dvh' }}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop — covers full viewport regardless of ancestor transforms */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        className={`${maxWidthClass} w-full p-5 sm:p-6 rounded-2xl sm:rounded-3xl border ${modalBoxClass} relative animate-modal-in max-h-[90dvh] overflow-y-auto z-10`}
      >
        {(title || icon) && (
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200/60 dark:border-white/[0.08]">
            <h3
              className={`font-bold text-sm sm:text-base flex items-center gap-2.5 ${textPrimary}`}
            >
              {icon}
              <span className="tracking-tight">{title}</span>
            </h3>
            <button
              type="button"
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
              onClick={onClose}
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );

  // Portal to document.body to escape any ancestor transform/filter/perspective
  // that would break position:fixed
  return createPortal(modal, document.body);
};
