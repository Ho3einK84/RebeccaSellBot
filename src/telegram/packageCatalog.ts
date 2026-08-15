import crypto from 'node:crypto';
import type { PackageOption } from '../domain/services/PricingService.js';

/** Compact fingerprint for rejecting index callbacks emitted from an older package catalog. */
export function packageCatalogToken(packages: readonly PackageOption[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(packages)).digest('hex').slice(0, 10);
}
