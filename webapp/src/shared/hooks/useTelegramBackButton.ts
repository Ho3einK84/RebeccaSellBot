import { useEffect, useRef } from 'react';

type BackButtonHandler = () => void;

const handlerStack: BackButtonHandler[] = [];

function syncTelegramBackButton() {
  const tg = window.Telegram?.WebApp;
  if (!tg?.BackButton) return;

  if (handlerStack.length > 0) {
    tg.BackButton.show();
  } else {
    tg.BackButton.hide();
  }
}

if (typeof window !== 'undefined') {
  window.Telegram?.WebApp?.BackButton?.onClick(() => {
    const topHandler = handlerStack[handlerStack.length - 1];
    if (topHandler) {
      topHandler();
    }
  });
}

export function useTelegramBackButton(handler: BackButtonHandler, active: boolean = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;

    const wrappedHandler: BackButtonHandler = () => {
      handlerRef.current();
    };

    handlerStack.push(wrappedHandler);
    syncTelegramBackButton();

    return () => {
      const idx = handlerStack.indexOf(wrappedHandler);
      if (idx !== -1) {
        handlerStack.splice(idx, 1);
      }
      syncTelegramBackButton();
    };
  }, [active]);
}
