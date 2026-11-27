/// <reference types="vite/client" />

import type { AppVersionInfo } from './shared/types/api.js';

declare global {
  const __APP_VERSION_INFO__: AppVersionInfo | undefined;
}

export {};
