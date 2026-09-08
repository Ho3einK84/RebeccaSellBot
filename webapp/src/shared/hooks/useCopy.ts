import { useState, useCallback } from 'react';
import { copyToClipboard } from '@/shared/lib/formatters.js';
import { useHaptic } from './useHaptic.js';

export function useCopy(timeout = 2000) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { triggerHaptic } = useHaptic();

  const copy = useCallback(
    async (text: string, id: string = 'default') => {
      triggerHaptic('light');
      const success = await copyToClipboard(text);
      if (success) {
        setCopiedId(id);
        triggerHaptic('success');
        setTimeout(() => {
          setCopiedId((curr) => (curr === id ? null : curr));
        }, timeout);
      }
      return success;
    },
    [triggerHaptic, timeout]
  );

  const isCopied = useCallback((id: string = 'default') => copiedId === id, [copiedId]);

  return { copy, isCopied, copiedId };
}
