/**
 * LuckyWheelService — manages the gamified Lucky Wheel subsystem with
 * diminishing returns luck curves, cooldown timers, lifetime spin limits,
 * transactional wallet crediting, and fraud-resistant auditing.
 */

import { desc, eq, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from '../../infra/db.js';
import { luckyWheelSpins, users, walletTransactions } from '../../infra/schema.js';
import type { TranslationService } from './TranslationService.js';
import { logger } from '../../infra/logger.js';

export interface LuckyWheelStatus {
  enabled: boolean;
  canSpin: boolean;
  reason?: 'disabled' | 'max_spins_reached' | 'cooldown_active' | 'user_not_found' | 'user_banned';
  nextSpinAt?: Date;
  secondsRemaining?: number;
  totalSpins: number;
  maxSpins: number;
  minPrize: number;
  maxPrize: number;
  currentEffectiveLuck: number;
}

export interface LuckyWheelSpinResult {
  success: boolean;
  amount: number;
  balanceAfter: number;
  spinNumber: number;
  spinsRemaining: number;
  nextSpinAt?: Date;
  effectiveLuckPercent: number;
}

/**
 * Calculates effective luck percentage after applying spin decay.
 * Clamped between 5% and 100%.
 */
export function calculateEffectiveLuck(
  baseLuck: number,
  decayPercent: number,
  spinCount: number
): number {
  const safeBase = Math.max(1, Math.min(100, baseLuck));
  const safeDecay = Math.max(0, Math.min(100, decayPercent));
  const safeCount = Math.max(0, spinCount);
  const decayed = safeBase - safeCount * safeDecay;
  return Math.max(5, Math.min(100, decayed));
}

/**
 * Calculates prize within [minAmount, maxAmount] using an inverse power distribution.
 * Higher effective luck shifts the probability density function toward maxAmount.
 */
export function calculateLuckyWheelPrize(
  minAmount: number,
  maxAmount: number,
  effectiveLuckPercent: number,
  randomValue = Math.random()
): number {
  const safeMin = Math.min(minAmount, maxAmount);
  const safeMax = Math.max(minAmount, maxAmount);
  if (safeMin === safeMax) return safeMin;

  const luck = Math.max(1, Math.min(100, effectiveLuckPercent));
  const exponent = 100 / luck;
  const clampedRandom = Math.max(0, Math.min(1, randomValue));
  const factor = Math.pow(clampedRandom, exponent);
  const rawPrize = safeMin + (safeMax - safeMin) * factor;
  const roundedPrize = Math.round(rawPrize / 1000) * 1000;
  return Math.max(safeMin, Math.min(safeMax, roundedPrize));
}

export class LuckyWheelService {
  private invalidationHook?: (telegramId: number) => void;

  constructor(private readonly translationService: TranslationService) {}

  registerInvalidationHook(hook: (telegramId: number) => void): void {
    this.invalidationHook = hook;
  }

  /**
   * Retrieves the current user's lucky wheel eligibility, timers, and luck state.
   */
  async getStatus(telegramId: number): Promise<LuckyWheelStatus> {
    const enabled = this.translationService.getSetting('lucky_wheel_enabled', 'true') === 'true';
    const minPrize = this.translationService.getSettingNum('lucky_wheel_min_amount', 1_000);
    const maxPrize = this.translationService.getSettingNum('lucky_wheel_max_amount', 50_000);
    const baseLuck = this.translationService.getSettingNum('lucky_wheel_base_luck_percent', 50);
    const decayPercent = this.translationService.getSettingNum('lucky_wheel_decay_percent', 10);
    const cooldownHours = this.translationService.getSettingNum('lucky_wheel_cooldown_hours', 24);
    const maxSpins = this.translationService.getSettingNum('lucky_wheel_max_spins', 5);

    if (!enabled) {
      return {
        enabled: false,
        canSpin: false,
        reason: 'disabled',
        totalSpins: 0,
        maxSpins,
        minPrize,
        maxPrize,
        currentEffectiveLuck: baseLuck,
      };
    }

    const db = getDb();
    const [user] = await db
      .select({ isBanned: users.isBanned })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    if (!user) {
      return {
        enabled: true,
        canSpin: false,
        reason: 'user_not_found',
        totalSpins: 0,
        maxSpins,
        minPrize,
        maxPrize,
        currentEffectiveLuck: baseLuck,
      };
    }

    if (user.isBanned) {
      return {
        enabled: true,
        canSpin: false,
        reason: 'user_banned',
        totalSpins: 0,
        maxSpins,
        minPrize,
        maxPrize,
        currentEffectiveLuck: baseLuck,
      };
    }

    const [countRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(luckyWheelSpins)
      .where(eq(luckyWheelSpins.telegramId, telegramId));
    const totalSpins = Number(countRes?.count ?? 0);

    const [lastSpin] = await db
      .select({ createdAt: luckyWheelSpins.createdAt })
      .from(luckyWheelSpins)
      .where(eq(luckyWheelSpins.telegramId, telegramId))
      .orderBy(desc(luckyWheelSpins.createdAt))
      .limit(1);

    const currentEffectiveLuck = calculateEffectiveLuck(baseLuck, decayPercent, totalSpins);

    if (totalSpins >= maxSpins) {
      return {
        enabled: true,
        canSpin: false,
        reason: 'max_spins_reached',
        totalSpins,
        maxSpins,
        minPrize,
        maxPrize,
        currentEffectiveLuck,
      };
    }

    if (lastSpin) {
      const cooldownMs = cooldownHours * 3600 * 1000;
      const nextSpinAt = new Date(lastSpin.createdAt.getTime() + cooldownMs);
      const diffMs = nextSpinAt.getTime() - Date.now();
      if (diffMs > 0) {
        return {
          enabled: true,
          canSpin: false,
          reason: 'cooldown_active',
          nextSpinAt,
          secondsRemaining: Math.ceil(diffMs / 1000),
          totalSpins,
          maxSpins,
          minPrize,
          maxPrize,
          currentEffectiveLuck,
        };
      }
    }

    return {
      enabled: true,
      canSpin: true,
      totalSpins,
      maxSpins,
      minPrize,
      maxPrize,
      currentEffectiveLuck,
    };
  }

  /**
   * Executes a spin transactionally for the specified user.
   */
  async spin(telegramId: number): Promise<LuckyWheelSpinResult> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const enabled = this.translationService.getSetting('lucky_wheel_enabled', 'true') === 'true';
      if (!enabled) {
        throw new Error('LUCKY_WHEEL_DISABLED');
      }

      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .for('update')
        .limit(1);

      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }
      if (user.isBanned) {
        throw new Error('USER_BANNED');
      }

      const minPrize = this.translationService.getSettingNum('lucky_wheel_min_amount', 1_000);
      const maxPrize = this.translationService.getSettingNum('lucky_wheel_max_amount', 50_000);
      const baseLuck = this.translationService.getSettingNum('lucky_wheel_base_luck_percent', 50);
      const decayPercent = this.translationService.getSettingNum('lucky_wheel_decay_percent', 10);
      const cooldownHours = this.translationService.getSettingNum('lucky_wheel_cooldown_hours', 24);
      const maxSpins = this.translationService.getSettingNum('lucky_wheel_max_spins', 5);

      const [countRes] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(luckyWheelSpins)
        .where(eq(luckyWheelSpins.telegramId, telegramId));
      const totalSpins = Number(countRes?.count ?? 0);

      if (totalSpins >= maxSpins) {
        throw new Error('MAX_SPINS_REACHED');
      }

      const [lastSpin] = await tx
        .select({ createdAt: luckyWheelSpins.createdAt })
        .from(luckyWheelSpins)
        .where(eq(luckyWheelSpins.telegramId, telegramId))
        .orderBy(desc(luckyWheelSpins.createdAt))
        .limit(1);

      if (lastSpin) {
        const cooldownMs = cooldownHours * 3600 * 1000;
        const nextSpinAt = new Date(lastSpin.createdAt.getTime() + cooldownMs);
        if (Date.now() < nextSpinAt.getTime()) {
          throw new Error('COOLDOWN_ACTIVE');
        }
      }

      const effectiveLuckPercent = calculateEffectiveLuck(baseLuck, decayPercent, totalSpins);
      const amount = calculateLuckyWheelPrize(minPrize, maxPrize, effectiveLuckPercent);

      const spinId = `spin_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const now = new Date();
      const spinNumber = totalSpins + 1;

      // 1. Insert spin audit record
      await tx.insert(luckyWheelSpins).values({
        id: spinId,
        telegramId,
        amount,
        effectiveLuckPercent,
        spinNumber,
        createdAt: now,
      });

      // 2. Credit wallet
      const balanceAfter = user.balance + amount;
      await tx
        .update(users)
        .set({
          balance: balanceAfter,
          updatedAt: now,
        })
        .where(eq(users.telegramId, telegramId));

      // 3. Write wallet transaction ledger
      await tx.insert(walletTransactions).values({
        id: `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        telegramId,
        amount,
        balanceAfter,
        type: 'lucky_wheel',
        referenceId: `spin_${spinId}`,
        description: `Lucky wheel spin #${spinNumber} prize (+${amount} Toman, Luck: ${effectiveLuckPercent}%)`,
        createdAt: now,
      });

      this.invalidationHook?.(telegramId);

      const nextCooldownMs = cooldownHours * 3600 * 1000;
      const nextSpinAt = new Date(now.getTime() + nextCooldownMs);

      logger.info(
        { telegramId, spinId, amount, effectiveLuckPercent, spinNumber },
        'Lucky wheel spin completed'
      );

      return {
        success: true,
        amount,
        balanceAfter,
        spinNumber,
        spinsRemaining: maxSpins - spinNumber,
        nextSpinAt,
        effectiveLuckPercent,
      };
    });
  }
}
