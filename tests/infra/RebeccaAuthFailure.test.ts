import { describe, expect, it } from 'vitest';
import {
  isRemoteOutcomeIndeterminate,
  PanelPurchaseVerificationError,
} from '../../src/domain/services/WalletSupport.js';
import {
  RebeccaApiError,
  RebeccaContractError,
  RebeccaOriginDownError,
} from '../../src/domain/services/RebeccaService.js';

describe('P1 — Distinguish authentication failure from uncertain remote mutation', () => {
  it('classifies /api/admin/token errors as non-indeterminate (did not attempt mutation)', () => {
    const auth500 = new RebeccaApiError(500, '/api/admin/token', 'Internal Server Error');
    const auth401 = new RebeccaApiError(401, '/api/admin/token', 'Unauthorized');
    const auth409 = new RebeccaApiError(409, '/api/admin/token', 'Conflict');
    const authOriginDown = new RebeccaOriginDownError('/api/admin/token', 521, 1, false);

    expect(isRemoteOutcomeIndeterminate(auth500)).toBe(false);
    expect(isRemoteOutcomeIndeterminate(auth401)).toBe(false);
    expect(isRemoteOutcomeIndeterminate(auth409)).toBe(false);
    expect(isRemoteOutcomeIndeterminate(authOriginDown)).toBe(false);
  });

  it('classifies mutation endpoint 5xx and dispatched origin down errors as indeterminate', () => {
    const userCreate500 = new RebeccaApiError(500, '/api/user', 'Internal Server Error');
    const userCreateOriginDown = new RebeccaOriginDownError('/api/user', null, 5, true);
    const contractError = new RebeccaContractError('/api/user', 1, []);
    const verificationError = new PanelPurchaseVerificationError('verification failed');

    expect(isRemoteOutcomeIndeterminate(userCreate500)).toBe(true);
    expect(isRemoteOutcomeIndeterminate(userCreateOriginDown)).toBe(true);
    expect(isRemoteOutcomeIndeterminate(contractError)).toBe(true);
    expect(isRemoteOutcomeIndeterminate(verificationError)).toBe(true);
  });
});
