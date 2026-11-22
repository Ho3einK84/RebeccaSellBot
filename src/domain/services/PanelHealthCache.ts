export interface CachedPanelHealth {
  configured: number;
  healthy: number;
  allHealthy: boolean;
  latencyMs: number;
  checkedAt: number;
}

export const PANEL_HEALTH_CACHE_TTL_MS = 60_000;

type PanelHealthRegistry = {
  healthSummary?: () => Promise<{ configured: number; healthy: number }>;
};

const healthCacheByRegistry = new WeakMap<object, CachedPanelHealth>();

/** Invalidate cached panel health (call after panel mutations or manual connection tests). */
export function invalidatePanelHealthCache(registry?: object): void {
  if (registry) {
    healthCacheByRegistry.delete(registry);
  }
}

/**
 * Measure and cache aggregate Rebecca panel health with a hard timeout so
 * slow/unreachable upstream panels never stall Telegram or WebApp dashboards.
 */
export async function getCachedPanelHealth(
  registry: PanelHealthRegistry | null | undefined,
  options: { timeoutMs?: number; useCache?: boolean } = {}
): Promise<CachedPanelHealth | null> {
  if (!registry || typeof registry.healthSummary !== 'function') return null;

  const { timeoutMs = 2_500, useCache = true } = options;

  if (useCache) {
    const cached = healthCacheByRegistry.get(registry);
    if (cached && Date.now() - cached.checkedAt < PANEL_HEALTH_CACHE_TTL_MS) {
      return cached;
    }
  }

  const startedAt = performance.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      registry.healthSummary(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('HEALTH_CHECK_TIMEOUT')), timeoutMs);
      }),
    ]);
    const entry: CachedPanelHealth = {
      configured: result.configured,
      healthy: result.healthy,
      allHealthy: result.configured > 0 && result.healthy === result.configured,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkedAt: Date.now(),
    };
    healthCacheByRegistry.set(registry, entry);
    return entry;
  } catch {
    return {
      configured: 0,
      healthy: 0,
      allHealthy: false,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkedAt: Date.now(),
    };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
