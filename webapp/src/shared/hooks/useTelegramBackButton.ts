import { useEffect, useRef } from 'react';

type BackButtonHandler = () => void;

const handlerStack: BackButtonHandler[] = [];

let isListenerAttached = false;

function ensureListenerAttached() {
  if (isListenerAttached) return;
  const backButton = window.Telegram?.WebApp?.BackButton;
  if (!backButton?.onClick) return;

  backButton.onClick(() => {
    const topHandler = handlerStack[handlerStack.length - 1];
    if (topHandler) {
      topHandler();
    }
  });
  isListenerAttached = true;
}

function syncTelegramBackButton() {
  ensureListenerAttached();
  const tg = window.Telegram?.WebApp;
  if (!tg?.BackButton) return;

  if (handlerStack.length > 0) {
    tg.BackButton.show();
  } else {
    tg.BackButton.hide();
  }
}

if (typeof window !== 'undefined') {
  ensureListenerAttached();
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
