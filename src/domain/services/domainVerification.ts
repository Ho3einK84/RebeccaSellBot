import dns from 'node:dns/promises';
import { fetchServerPublicIp, probeDomainHealth } from '../../infra/networkProbe.js';
import { logger } from '../../infra/logger.js';

export interface NormalizedDomainResult {
  valid: boolean;
  hostname: string;
  url: string;
  error?: string;
}

export interface DomainDnsCheckResult {
  resolved: boolean;
  ips: string[];
  matchesServer: boolean;
  serverIp?: string | null;
}

/**
 * Normalizes user input into a canonical HTTPS URL and hostname.
 * Handles inputs like:
 * - "app.example.com"
 * - "https://app.example.com"
 * - "http://app.example.com/"
 * - "sub.domain.co.uk:443/path"
 */
export function normalizeDomainInput(raw: string): NormalizedDomainResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, hostname: '', url: '', error: 'Domain input cannot be empty' };
  }

  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//u);
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return { valid: false, hostname: '', url: '', error: 'Unsupported URL scheme' };
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(schemeMatch ? trimmed : `https://${trimmed}`);
  } catch {
    return { valid: false, hostname: '', url: '', error: 'Invalid domain name format' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, hostname: '', url: '', error: 'Invalid domain name format' };
  }

  const sanitized = parsed.hostname.toLowerCase().replace(/\.$/, '');

  if (!sanitized) {
    return { valid: false, hostname: '', url: '', error: 'Invalid hostname format' };
  }

  if (sanitized === 'localhost') {
    return { valid: true, hostname: 'localhost', url: 'https://localhost' };
  }

  // RFC 1123 hostname validation:
  // - Labels separated by dots
  // - Each label 1-63 chars: starts and ends with alphanumeric, can contain hyphens
  // - Must contain at least one dot (domain + TLD)
  // - Overall length <= 253
  if (sanitized.length > 253) {
    return { valid: false, hostname: '', url: '', error: 'Domain name is too long' };
  }

  const hostnameRegex =
    /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

  if (!hostnameRegex.test(sanitized)) {
    return { valid: false, hostname: '', url: '', error: 'Invalid domain name format' };
  }

  return {
    valid: true,
    hostname: sanitized,
    url: `https://${sanitized}`,
  };
}

/**
 * Retrieves the public IP of the host server.
 */
export async function getServerPublicIp(): Promise<string | null> {
  return fetchServerPublicIp();
}

/**
 * Checks DNS resolution for a given domain and verifies whether its A record points to the server.
 */
export async function checkDomainDns(
  hostname: string,
  serverIp?: string | null
): Promise<DomainDnsCheckResult> {
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return {
      resolved: true,
      ips: ['127.0.0.1'],
      matchesServer: true,
      serverIp: serverIp ?? '127.0.0.1',
    };
  }

  try {
    const ips = await dns.resolve4(hostname);
    const matchesServer = Boolean(serverIp && ips.includes(serverIp));
    return {
      resolved: ips.length > 0,
      ips,
      matchesServer,
      serverIp,
    };
  } catch (err) {
    logger.debug({ err, hostname }, 'DNS resolve4 lookup failed');
    return {
      resolved: false,
      ips: [],
      matchesServer: false,
      serverIp,
    };
  }
}

/**
 * Probes the domain over HTTPS to verify reverse proxy routing and trigger automated TLS certificate issuance.
 */
export async function verifyDomainSslAndReachability(
  url: string,
  timeoutMs = 10000
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const budgetMs = Number.isFinite(timeoutMs) ? Math.max(500, timeoutMs) : 10000;
  const deadline = Date.now() + budgetMs;

  const firstProbeTimeout = Math.min(5000, budgetMs);
  const firstProbe = await probeDomainHealth(url, firstProbeTimeout);
  if (firstProbe.ok) return firstProbe;

  const remainingBeforeRetry = deadline - Date.now();
  if (remainingBeforeRetry <= 300) {
    return firstProbe;
  }

  // Wait briefly for ACME TLS certificate issuance to complete, within timeout budget
  const retryDelay = Math.min(1500, Math.floor(remainingBeforeRetry / 2));
  await new Promise((resolve) => setTimeout(resolve, retryDelay));

  const remainingForSecondProbe = deadline - Date.now();
  if (remainingForSecondProbe <= 100) {
    return firstProbe;
  }

  return probeDomainHealth(url, remainingForSecondProbe);
}
