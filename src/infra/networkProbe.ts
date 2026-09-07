import { logger } from './logger.js';

let cachedPublicIp: { ip: string; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export function clearCachedPublicIpForTesting(): void {
  cachedPublicIp = null;
}

const PUBLIC_IP_SERVICES = [
  'https://api.ipify.org',
  'https://icanhazip.com',
  'https://ifconfig.me/ip',
] as const;

/**
 * Discovers the server's public IP address with caching and fallback providers.
 */
export async function fetchServerPublicIp(): Promise<string | null> {
  const envIp = process.env.SERVER_PUBLIC_IP?.trim() || process.env.HOST_IP?.trim();
  if (envIp) {
    return envIp;
  }

  const now = Date.now();
  if (cachedPublicIp && cachedPublicIp.expiresAt > now) {
    return cachedPublicIp.ip;
  }

  for (const serviceUrl of PUBLIC_IP_SERVICES) {
    try {
      const res = await fetch(serviceUrl, {
        signal: AbortSignal.timeout(2500),
        headers: { Accept: 'text/plain', 'User-Agent': 'RebeccaSellBot-HealthProbe/1.0' },
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        // Validate basic IPv4 format
        if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(text)) {
          cachedPublicIp = { ip: text, expiresAt: now + CACHE_TTL_MS };
          return text;
        }
      }
    } catch (err) {
      logger.debug({ err, serviceUrl }, 'Failed to fetch public IP from provider');
    }
  }

  return cachedPublicIp?.ip ?? null;
}

export interface DomainHealthProbeResult {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

/**
 * Probes the webapp health endpoint over HTTPS to verify reverse proxy and trigger Caddy On-Demand TLS.
 */
export async function probeDomainHealth(
  targetUrl: string,
  timeoutMs = 8000
): Promise<DomainHealthProbeResult> {
  const healthUrl = targetUrl.replace(/\/+$/, '') + '/api/health';
  try {
    const res = await fetch(healthUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', 'User-Agent': 'RebeccaSellBot-Probe/1.0' },
    });

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    const json = (await res.json()) as { status?: string; component?: string };
    if (json.status === 'ok' && json.component === 'webapp') {
      return { ok: true, status: res.status, data: json };
    }

    return {
      ok: false,
      status: res.status,
      error: 'Invalid health check payload returned',
      data: json,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown network probe error';
    logger.debug({ err, healthUrl }, 'Domain health probe failed');
    return {
      ok: false,
      error: errorMessage,
    };
  }
}
