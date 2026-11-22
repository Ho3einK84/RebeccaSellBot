/**
 * ExchangeRateClient — Fetches live USDT/Toman market rate with TTL caching,
 * sanity bounds, and multi-source fallback for NOWPayments USD conversion.
 */
import { logger } from './logger.js';

export interface LiveUsdRateResult {
  rateToman: number;
  provider: string;
  fetchedAt: Date;
}

const MIN_SANE_RATE_TOMAN = 10_000;
const MAX_SANE_RATE_TOMAN = 5_000_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_TIMEOUT_MS = 6_000;

function isSaneTomanRate(rate: number): boolean {
  return Number.isSafeInteger(rate) && rate >= MIN_SANE_RATE_TOMAN && rate <= MAX_SANE_RATE_TOMAN;
}

export class ExchangeRateClient {
  private cached: { value: LiveUsdRateResult; expiresAtMs: number } | null = null;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;

  constructor(options: { cacheTtlMs?: number; timeoutMs?: number } = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  clearCache(): void {
    this.cached = null;
  }

  /**
   * Fetch live USDT/Toman rate from Iranian market tickers with 5-minute TTL caching.
   * Returns `null` if all upstream feeds are unreachable or return out-of-range prices,
   * allowing the caller to fall back cleanly to the admin-configured manual rate.
   */
  async fetchUsdTomanRate(
    options: { forceRefresh?: boolean } = {}
  ): Promise<LiveUsdRateResult | null> {
    const now = Date.now();
    if (!options.forceRefresh && this.cached && now < this.cached.expiresAtMs) {
      return this.cached.value;
    }

    const providers: Array<{ name: string; run: () => Promise<number | null> }> = [
      { name: 'nobitex', run: () => this.fetchNobitexUsdtToman() },
      { name: 'wallex', run: () => this.fetchWallexUsdtToman() },
    ];

    for (const provider of providers) {
      try {
        const rate = await provider.run();
        if (rate !== null && isSaneTomanRate(rate)) {
          const result: LiveUsdRateResult = {
            rateToman: rate,
            provider: provider.name,
            fetchedAt: new Date(),
          };
          this.cached = { value: result, expiresAtMs: now + this.cacheTtlMs };
          return result;
        }
      } catch (err) {
        logger.debug(
          { provider: provider.name, err: err instanceof Error ? err.message : String(err) },
          'Exchange rate provider fetch failed; trying next source'
        );
      }
    }

    // Serve stale last-known-good cache up to 1 hour if live fetch temporarily failed
    if (this.cached && now - this.cached.value.fetchedAt.getTime() <= 60 * 60 * 1000) {
      return this.cached.value;
    }

    return null;
  }

  private async fetchNobitexUsdtToman(): Promise<number | null> {
    const res = await this.fetchJson('https://apiv2.nobitex.ir/v3/orderbook/USDTIRT');
    if (!res || typeof res !== 'object') return null;
    const record = res as Record<string, unknown>;
    const rawRial = Number(record.lastTradePrice);
    if (!Number.isFinite(rawRial) || rawRial <= 0) return null;
    return Math.round(rawRial / 10);
  }

  private async fetchWallexUsdtToman(): Promise<number | null> {
    const res = await this.fetchJson('https://api.wallex.ir/v1/markets');
    if (!res || typeof res !== 'object') return null;
    const result = (
      res as { result?: { symbols?: Record<string, { stats?: { lastPrice?: unknown } }> } }
    ).result;
    const rawToman = Number(result?.symbols?.USDTIRT?.stats?.lastPrice);
    if (!Number.isFinite(rawToman) || rawToman <= 0) return null;
    return Math.round(rawToman);
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
