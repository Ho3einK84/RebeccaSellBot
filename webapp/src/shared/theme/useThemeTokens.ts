export const useThemeTokens = () => {
  return {
    cardClass: 'bg-surface border-line shadow-[var(--shadow-card)]',
    subCardClass: 'bg-surface-2 border-line',
    headerClass: 'bg-surface border-b border-line',
    inputClass:
      'bg-surface-2/85 border-line-strong text-ink placeholder:text-ink-muted focus:border-brand focus:bg-surface focus:ring-3 focus:ring-brand/15 shadow-[var(--shadow-xs)]',
    textPrimary: 'text-ink',
    textSecondary: 'text-ink-soft',
    textMuted: 'text-ink-muted',
    tabInactiveClass:
      'text-ink-soft hover:text-ink hover:bg-surface-2 border-line-strong bg-surface',
    tableRowClass: 'border-b border-line hover:bg-surface-2 transition-colors',
    modalBoxClass: 'bg-surface border-line-strong text-ink shadow-[var(--shadow-popover)]',
  };
};
