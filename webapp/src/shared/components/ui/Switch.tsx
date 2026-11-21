import React from 'react';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

/** Unified accessible toggle switch backed by the RTL-aware `.rs-switch` primitive. */
export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  id,
  className = '',
}) => {
  const { triggerHaptic } = useHaptic();

  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={(e) => {
        triggerHaptic('selection');
        onChange(e.target.checked);
      }}
      className={`rs-switch shrink-0 ${className}`}
    />
  );
};
