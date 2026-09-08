import React, { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';

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

  // Keyboard Escape listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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

  return (
    <div className="modal modal-open z-50 items-center justify-center p-3 sm:p-4">
      <div
        className={`modal-box ${maxWidthClass} w-full p-5 sm:p-6 rounded-2xl sm:rounded-3xl border ${modalBoxClass} relative animate-in fade-in zoom-in-95 duration-200 max-h-[90dvh]`}
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
      {closeOnBackdrop && (
        <div
          className="modal-backdrop bg-black/65 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}
    </div>
  );
};
