import { describe, expect, it } from 'vitest';
import { normalizeDataLimit } from '../../src/domain/services/TrafficLimit.js';
import {
  calculateTraffic,
  isConfigActive,
  observedConfigLifecycle,
} from '../../src/domain/services/ConfigLifecycle.js';
import { rebeccaUserDetailSchema } from '../../src/infra/RebeccaApiSchemas.js';

describe('T1: Traffic Limit Normalization & Lifecycle', () => {
  describe('normalizeDataLimit pure unit tests', () => {
    it('normalizes absent (undefined), null, 0, and non-positive to null (unlimited)', () => {
      expect(normalizeDataLimit(undefined)).toBeNull();
      expect(normalizeDataLimit(null)).toBeNull();
      expect(normalizeDataLimit(0)).toBeNull();
      expect(normalizeDataLimit(0n)).toBeNull();
      expect(normalizeDataLimit(-1)).toBeNull();
      expect(normalizeDataLimit(-100n)).toBeNull();
      expect(normalizeDataLimit('0')).toBeNull();
      expect(normalizeDataLimit('')).toBeNull();
    });

    it('normalizes positive integers to number (limited)', () => {
      expect(normalizeDataLimit(1024)).toBe(1024);
      expect(normalizeDataLimit(5368709120)).toBe(5368709120);
      expect(normalizeDataLimit(5368709120n)).toBe(5368709120);
      expect(normalizeDataLimit('5368709120')).toBe(5368709120);
    });

    it('returns undefined for invalid or NaN values (unknown)', () => {
      expect(normalizeDataLimit(NaN)).toBeUndefined();
      expect(normalizeDataLimit('abc')).toBeUndefined();
      expect(normalizeDataLimit({})).toBeUndefined();
    });
  });

  describe('T1 Matrix: limit (absent / null / 0 / positive) x usage (less / equal / greater)', () => {
    const ONE_GB = 1024 * 1024 * 1024;
    const TEN_GB = 10 * ONE_GB;
    const FIVE_GB = 5 * ONE_GB;
    const TWELVE_GB = 12 * ONE_GB;

    const futureExpire = Math.floor(Date.now() / 1000) + 86400;

    // Cases for UNLIMITED limits: absent (undefined), null, 0
    const unlimitedLimits = [
      { desc: 'absent (undefined)', limit: undefined },
      { desc: 'null', limit: null },
      { desc: '0', limit: 0 },
    ];

    for (const { desc, limit } of unlimitedLimits) {
      describe(`Unlimited limit: ${desc}`, () => {
        it('calculates traffic as unlimited with no remainingBytes quota', () => {
          const traffic = calculateTraffic({
            status: 'active',
            data_limit: limit,
            used_traffic: FIVE_GB,
            expire: futureExpire,
          });
          expect(traffic.isUnlimited).toBe(true);
          expect(traffic.dataLimit).toBeNull();
          expect(traffic.remainingBytes).toBeNull();
        });

        it('remains active when usage is less (e.g. 5 GB used)', () => {
          const active = isConfigActive({
            status: 'active',
            data_limit: limit,
            used_traffic: FIVE_GB,
            expire: futureExpire,
          });
          expect(active).toBe(true);
        });

        it('remains active when usage is 0 (fixing previous bug where 0 >= 0 made active users inactive)', () => {
          const active = isConfigActive({
            status: 'active',
            data_limit: limit,
            used_traffic: 0,
            expire: futureExpire,
          });
          expect(active).toBe(true);
        });

        it('remains active even when usage is large (unlimited quota)', () => {
          const active = isConfigActive({
            status: 'active',
            data_limit: limit,
            used_traffic: TWELVE_GB,
            expire: futureExpire,
          });
          expect(active).toBe(true);
        });
      });
    }

    describe('Limited limit: positive 10 GB', () => {
      it('calculates traffic correctly', () => {
        const traffic = calculateTraffic({
          status: 'active',
          data_limit: TEN_GB,
          used_traffic: FIVE_GB,
          expire: futureExpire,
        });
        expect(traffic.isUnlimited).toBe(false);
        expect(traffic.dataLimit).toBe(TEN_GB);
        expect(traffic.remainingBytes).toBe(FIVE_GB);
      });

      it('remains active when used < limit (5 GB < 10 GB)', () => {
        const active = isConfigActive({
          status: 'active',
          data_limit: TEN_GB,
          used_traffic: FIVE_GB,
          expire: futureExpire,
        });
        expect(active).toBe(true);
      });

      it('becomes inactive when used == limit (10 GB == 10 GB)', () => {
        const active = isConfigActive({
          status: 'active',
          data_limit: TEN_GB,
          used_traffic: TEN_GB,
          expire: futureExpire,
        });
        expect(active).toBe(false);
      });

      it('becomes inactive when used > limit (12 GB > 10 GB)', () => {
        const active = isConfigActive({
          status: 'active',
          data_limit: TEN_GB,
          used_traffic: TWELVE_GB,
          expire: futureExpire,
        });
        expect(active).toBe(false);
      });
    });
  });

  describe('RebeccaApiSchemas Zod schema parsing', () => {
    const basePayload = {
      username: 'alice',
      status: 'active',
      used_traffic: 1024,
      subscription_url: 'https://vpn.example.com/sub/alice',
      links: ['vless://alice@example.com:443'],
      expire: null,
    };

    it('parses absent data_limit (omitempty) as null (unlimited)', () => {
      const parsed = rebeccaUserDetailSchema.parse({ ...basePayload });
      expect(parsed.data_limit).toBeNull();
    });

    it('parses data_limit: null as null (unlimited)', () => {
      const parsed = rebeccaUserDetailSchema.parse({ ...basePayload, data_limit: null });
      expect(parsed.data_limit).toBeNull();
    });

    it('parses data_limit: 0 as null (unlimited)', () => {
      const parsed = rebeccaUserDetailSchema.parse({ ...basePayload, data_limit: 0 });
      expect(parsed.data_limit).toBeNull();
    });

    it('parses positive data_limit as number (limited)', () => {
      const parsed = rebeccaUserDetailSchema.parse({ ...basePayload, data_limit: 5368709120 });
      expect(parsed.data_limit).toBe(5368709120);
    });
  });

  describe('observedConfigLifecycle', () => {
    it('normalizes remote data_limit before storing in lifecycle', () => {
      const observedNull = observedConfigLifecycle({
        status: 'active',
        data_limit: null,
        used_traffic: 0,
        expire: null,
      });
      expect(observedNull.panelDataLimit).toBeNull();

      const observedZero = observedConfigLifecycle({
        status: 'active',
        data_limit: 0,
        used_traffic: 0,
        expire: null,
      });
      expect(observedZero.panelDataLimit).toBeNull();

      const observedTenGb = observedConfigLifecycle({
        status: 'active',
        data_limit: 10737418240,
        used_traffic: 0,
        expire: null,
      });
      expect(observedTenGb.panelDataLimit).toBe(10737418240);
    });
  });
});
