import React, { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  /** Optional rich header content rendered in the sticky header bar alongside the close button. */
  customHeader?: ReactNode;
  /** Optional sticky footer bar pinned to the bottom of the modal sheet. */
  footer?: ReactNode;
  children: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
  closeOnBackdrop?: boolean;
  hideCloseButton?: boolean;
}

const maxWidthClasses = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '4xl': 'sm:max-w-4xl',
} as const;

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  customHeader,
  footer,
  children,
  maxWidth = 'md',
  closeOnBackdrop = true,
  hideCloseButton = false,
}) => {
  const { modalBoxClass } = useThemeTokens();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnBackdrop) {
        onClose();
      }
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeOnBackdrop, onClose]);

  if (!isOpen) return null;

  const hasHeader = Boolean(title || customHeader);

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center sm:p-4"
    >
      {/* Frosted glass backdrop */}
      <div
        className="fixed inset-0 bg-black/65 dark:bg-black/75 rs-backdrop-blur backdrop-blur-md anim-fade"
        onClick={() => {
          if (closeOnBackdrop) onClose();
        }}
        aria-hidden="true"
      />

      {/* Elevated modal / bottom-sheet surface */}
      <div
        className={`relative z-10 w-full ${maxWidthClasses[maxWidth]} max-h-[90dvh] sm:max-h-[88dvh] flex flex-col overflow-hidden border-t sm:border rounded-t-sheet sm:rounded-card anim-sheet sm:anim-modal safe-bottom shadow-[0_-16px_48px_rgba(0,0,0,0.48)] sm:shadow-[var(--shadow-popover)] ${modalBoxClass}`}
      >
        {/* Mobile sheet grab handle */}
        <div className="flex sm:hidden justify-center pt-2.5 pb-1 shrink-0" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-line-strong/80" />
        </div>

        {/* Sticky Modal Header */}
        {hasHeader && (
          <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-line bg-surface shrink-0 text-start">
            {customHeader ? (
              <div className="min-w-0 flex-1">{customHeader}</div>
            ) : (
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {icon ? <span className="shrink-0 flex items-center">{icon}</span> : null}
                <div className="min-w-0 flex-1">
                  {title ? (
                    <h3 className="font-semibold text-sm sm:text-base text-ink leading-[1.4] m-0 truncate">
                      {title}
                    </h3>
                  ) : null}
                  {subtitle ? (
                    <div className="mt-0.5 text-xs text-ink-muted truncate">{subtitle}</div>
                  ) : null}
                </div>
              </div>
            )}

            {!hideCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.close')}
                className="w-8 h-8 rounded-ctl inline-flex items-center justify-center border border-line bg-surface-2 text-ink-soft hover:text-ink hover:border-line-strong rs-focus press cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        )}

        {/* Scrollable Modal Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 text-start">
          {children}
        </div>

        {/* Sticky Modal Footer */}
        {footer ? (
          <div className="px-4 sm:px-5 py-3 border-t border-line bg-surface-2/50 shrink-0">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
};
