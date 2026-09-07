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

  // Remove protocol if present
  let sanitized = trimmed.replace(/^[a-zA-Z]+:\/\//, '');

  // Remove path, query string, or hash
  sanitized = sanitized.split('/')[0].split('?')[0].split('#')[0];

  // Remove port if provided (e.g. app.example.com:443)
  sanitized = sanitized.split(':')[0].trim().toLowerCase();

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
  timeoutMs = 8000
): Promise<{ ok: boolean; status?: number; error?: string }> {
  return probeDomainHealth(url, timeoutMs);
}
