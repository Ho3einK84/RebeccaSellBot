import React, { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  icon?: ReactNode;
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
  icon,
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        className="fixed inset-0 bg-black/60 anim-fade"
        onClick={() => {
          if (closeOnBackdrop) onClose();
        }}
        aria-hidden="true"
      />

      <div
        className={`relative z-10 w-full ${maxWidthClasses[maxWidth]} max-h-[92dvh] flex flex-col border rounded-t-sheet sm:rounded-card anim-sheet sm:anim-modal safe-bottom ${modalBoxClass}`}
      >
        <div className="flex sm:hidden justify-center pt-2.5 pb-1 shrink-0" aria-hidden="true">
          <div className="w-9 h-1 rounded-full bg-surface-3" />
        </div>

        {(title || !hideCloseButton) && (
          <div
            className={`flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 shrink-0 ${
              title ? 'border-b border-line' : ''
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {icon ? <span className="shrink-0">{icon}</span> : null}
              {title ? (
                <h3 className="font-semibold text-sm sm:text-base text-ink leading-[1.4] m-0 truncate">
                  {title}
                </h3>
              ) : null}
            </div>

            {!hideCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.close')}
                className="w-8 h-8 rounded-ctl inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-2 rs-focus press cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">{children}</div>
      </div>
    </div>
  );
};
