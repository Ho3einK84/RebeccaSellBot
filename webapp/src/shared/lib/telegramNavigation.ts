/**
 * Safely opens a Telegram deep link and minimizes or closes the WebApp so the user
 * transitions immediately into the Telegram chat with the target command/action active.
 */
export function openTelegramLinkAndMinimize(url: string, delayMs: number = 150): void {
  if (typeof window === 'undefined') return;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(url);
    setTimeout(() => {
      if (typeof tg.minimize === 'function') {
        tg.minimize();
      } else if (typeof tg.close === 'function') {
        tg.close();
      }
    }, delayMs);
  } else if (typeof window.open === 'function') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Minimizes the WebApp if supported by the Telegram client (API 8.0+),
 * falling back to closing it.
 */
export function minimizeOrCloseWebApp(): void {
  if (typeof window === 'undefined') return;
  const tg = window.Telegram?.WebApp;
  if (typeof tg?.minimize === 'function') {
    tg.minimize();
  } else if (typeof tg?.close === 'function') {
    tg.close();
  } else if (typeof window.close === 'function') {
    window.close();
  }
}
