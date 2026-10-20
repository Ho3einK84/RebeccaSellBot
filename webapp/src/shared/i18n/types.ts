import type { fa } from './locales/fa.js';

export type SupportedLocale = 'fa' | 'en';

export type DotNestedKeys<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object ? `${K}.${DotNestedKeys<T[K]>}` : `${K}`;
    }[keyof T & string]
  : never;

/** Turn the literal strings of the source dictionary into plain `string`. */
type Widen<T> = {
  [K in keyof T]: T[K] extends string ? string : Widen<T[K]>;
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * The Persian dictionary is the single source of truth for the key space.
 *
 * Deriving the schema from `fa` instead of maintaining a hand-written
 * interface keeps `t()` in sync with the actual copy: a new key in `fa` is
 * immediately valid everywhere, and a stale hand-written shape can no longer
 * hide missing keys (which used to surface raw dotted keys such as
 * `user.services.refreshSuccess` in the UI).
 */
export type TranslationSchema = Widen<typeof fa>;

/** Every valid dotted translation key, e.g. `user.services.quickActionsTitle`. */
export type NestedTranslationKey = DotNestedKeys<TranslationSchema>;
