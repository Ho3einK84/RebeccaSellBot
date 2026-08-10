import { and, eq, or } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from '../../infra/db.js';
import { trialClaims, userConfigs, users, walletTransactions } from '../../infra/schema.js';
import { RebeccaApiError, type RebeccaService, type RebeccaUserDetail } from './RebeccaService.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';
import type { TranslationService } from './TranslationService.js';
import { logger } from '../../infra/logger.js';
import { remoteMatchesOwnershipMarker, trialOwnershipMarker } from './RebeccaOwnership.js';
import {
  normalizeRebeccaPanelAccess,
  type NormalizedRebeccaPanelAccess,
} from './RebeccaPanelAccess.js';

const MAX_TRIAL_GB = 10_000;
const MAX_TRIAL_DAYS = 3_650;
const PENDING_TRIAL_RECOVERY_DELAY_MS = 5 * 60 * 1000;

export interface TrialClaimResult {
  success: boolean;
  messageKey: string;
  subUrl?: string;
}

type TrialReservation =
  | { state: 'reserved'; balance: number; claim: PendingTrialClaim }
  | { state: 'already_used' }
  | { state: 'user_not_found' }
  | { state: 'pending'; claim: PendingTrialClaim };

interface PendingTrialClaim {
  telegramId: number;
  panelId: string;
  serviceId: number;
  configUsername: string;
  gbAmount: number;
  durationDays: number;
  status: string;
  subUrl: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type RemoteTrialState =
  { state: 'exists'; remote: RebeccaUserDetail } | { state: 'absent' } | { state: 'unknown' };

/**
 * Free trials use a small, recoverable saga rather than a read-then-create
 * sequence. A trial_claims row is reserved before calling Rebecca, so a second
 * tap cannot create an orphaned second account. The external result is then
 * bound to user_configs, has_used_trial and a zero-value audit entry in one
 * database transaction.
 */
export class TrialService {
  constructor(
    panels: RebeccaPanelRegistry | RebeccaService,
    private readonly translationService: TranslationService
  ) {
    this.panels = normalizeRebeccaPanelAccess(panels);
  }

  private readonly panels: NormalizedRebeccaPanelAccess;

  async claimTrial(
    telegramId: number,
    configName: string,
    panelId?: string,
    serviceId?: number
  ): Promise<TrialClaimResult> {
    const baseConfiguration = this.getTrialConfiguration();
    if (!baseConfiguration.enabled) {
      return {
        success: false,
        messageKey:
          baseConfiguration.reason === 'disabled' ? 'trial_disabled' : 'trial_creation_failed',
      };
    }
    let target;
    try {
      target = await this.panels.resolveTarget(panelId, serviceId);
    } catch {
      return { success: false, messageKey: 'trial_creation_failed' };
    }
    const configured = {
      ...baseConfiguration,
      panelId: target.panelId,
      serviceId: target.serviceId,
    };
    if (!isConfigName(configName)) return { success: false, messageKey: 'trial_creation_failed' };

    // At most one retry is necessary when an old pending row is confirmed
    // absent from Rebecca and is reopened for this fresh config name.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reservation = await this.reserveClaim(telegramId, configName, configured);
      switch (reservation.state) {
        case 'user_not_found':
          return { success: false, messageKey: 'user_not_found' };
        case 'already_used':
          return { success: false, messageKey: 'trial_already_used' };
        case 'reserved':
          return this.createAndFinalizeTrial(reservation);
        case 'pending': {
          const recovery = await this.recoverClaim(reservation.claim, false);
          if (recovery.result.success || !recovery.confirmedAbsent || attempt === 1) {
            return recovery.result;
          }
          // A confirmed-absent older pending claim was changed to failed; loop
          // once to reserve this request's newly generated config name.
          break;
        }
      }
    }

    return { success: false, messageKey: 'trial_creation_failed' };
  }

  /**
   * Recover all retained pending claims. A job may call this method safely;
   * unknown remote outcomes stay pending rather than being released and
   * risking a duplicate free account.
   */
  async reconcilePendingClaims(limit = 100): Promise<void> {
    const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    const claims = await getDb()
      .select({
        telegramId: trialClaims.telegramId,
        panelId: trialClaims.panelId,
        serviceId: trialClaims.serviceId,
        configUsername: trialClaims.configUsername,
        gbAmount: trialClaims.gbAmount,
        durationDays: trialClaims.durationDays,
        status: trialClaims.status,
        subUrl: trialClaims.subUrl,
        createdAt: trialClaims.createdAt,
        updatedAt: trialClaims.updatedAt,
      })
      .from(trialClaims)
      .where(
        // `compensating` is included so a process crash between claiming
        // compensation ownership and the remote DELETE remains recoverable.
        or(eq(trialClaims.status, 'pending'), eq(trialClaims.status, 'compensating'))
      )
      .limit(safeLimit);

    for (const claim of claims) {
      const result = await this.recoverClaim(claim, true);
      if (!result.result.success && !result.confirmedAbsent) {
        logger.warn(
          { telegramId: claim.telegramId, configUsername: claim.configUsername },
          'Trial claim remains pending because the remote outcome is unknown'
        );
      }
    }
  }

  private getTrialConfiguration():
    | { enabled: false; reason: 'disabled' | 'invalid' }
    | { enabled: true; gbAmount: number; durationDays: number } {
    if (!this.translationService.getSettingBool('trial_enabled', true)) {
      return { enabled: false, reason: 'disabled' };
    }

    const gbAmount = positiveInteger(
      this.translationService.getSettingNum('trial_gb', 1),
      MAX_TRIAL_GB
    );
    const durationDays = positiveInteger(
      this.translationService.getSettingNum('trial_days', 3),
      MAX_TRIAL_DAYS
    );
    if (!gbAmount || !durationDays) {
      logger.error({ gbAmount, durationDays }, 'Invalid trial configuration');
      return { enabled: false, reason: 'invalid' };
    }
    return { enabled: true, gbAmount, durationDays };
  }

  private async reserveClaim(
    telegramId: number,
    configUsername: string,
    config: Extract<ReturnType<TrialService['getTrialConfiguration']>, { enabled: true }> & {
      panelId: string;
      serviceId: number;
    }
  ): Promise<TrialReservation> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [user] = await tx
        .select({ balance: users.balance, hasUsedTrial: users.hasUsedTrial })
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);
      if (!user) return { state: 'user_not_found' };
      if (user.hasUsedTrial) return { state: 'already_used' };

      const [inserted] = await tx
        .insert(trialClaims)
        .values({
          telegramId,
          panelId: config.panelId,
          serviceId: config.serviceId,
          configUsername,
          gbAmount: config.gbAmount,
          durationDays: config.durationDays,
          status: 'pending',
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        return {
          state: 'reserved',
          balance: user.balance,
          claim: toPendingClaim(inserted),
        };
      }

      // A known failed create can be retried. The status predicate makes this
      // re-open operation race-safe: exactly one contender can turn it pending.
      const [reopened] = await tx
        .update(trialClaims)
        .set({
          configUsername,
          panelId: config.panelId,
          serviceId: config.serviceId,
          gbAmount: config.gbAmount,
          durationDays: config.durationDays,
          status: 'pending',
          subUrl: null,
          updatedAt: new Date(),
        })
        .where(and(eq(trialClaims.telegramId, telegramId), eq(trialClaims.status, 'failed')))
        .returning();
      if (reopened) {
        return {
          state: 'reserved',
          balance: user.balance,
          claim: toPendingClaim(reopened),
        };
      }

      const [existing] = await tx
        .select()
        .from(trialClaims)
        .where(eq(trialClaims.telegramId, telegramId))
        .limit(1);
      if (!existing || existing.status === 'completed' || existing.status === 'converted') {
        return { state: 'already_used' };
      }
      return { state: 'pending', claim: toPendingClaim(existing) };
    });
  }

  private async createAndFinalizeTrial(
    reservation: Extract<TrialReservation, { state: 'reserved' }>
  ): Promise<TrialClaimResult> {
    const { claim } = reservation;
    const dataLimitBytes = claim.gbAmount * 1024 * 1024 * 1024;
    const expireTimestamp = Math.floor(Date.now() / 1000) + claim.durationDays * 86_400;

    try {
      const remote = await this.panels.getService(claim.panelId).createUser({
        username: claim.configUsername,
        service_id: claim.serviceId,
        data_limit: dataLimitBytes,
        expire: expireTimestamp,
        status: 'active',
        note: trialOwnershipMarker(claim.telegramId, claim.configUsername),
      });
      if (!this.remoteBelongsToClaim(claim, remote)) {
        await this.markClaimForReview(claim);
        return { success: false, messageKey: 'trial_creation_failed' };
      }
      return await this.finalizeCreatedTrial(claim, remote);
    } catch (err) {
      logger.error(
        { err, telegramId: claim.telegramId, configUsername: claim.configUsername },
        'Rebecca trial create did not return a confirmed result'
      );

      // A timeout / interrupted response may still have created the account.
      // Probe before releasing the reservation; only a confirmed 404 is safe
      // to retry.
      if (isConfirmedCreateFailure(err)) {
        const remoteState = await this.inspectRemoteTrial(claim);
        if (remoteState.state === 'exists') {
          if (!this.remoteBelongsToClaim(claim, remoteState.remote)) {
            await this.markClaimForReview(claim);
            return { success: false, messageKey: 'trial_creation_failed' };
          }
          return this.finalizeCreatedTrial(claim, remoteState.remote);
        }
        if (remoteState.state === 'absent') {
          await this.markClaimFailed(claim);
        }
      }
      return { success: false, messageKey: 'trial_creation_failed' };
    }
  }

  private async recoverClaim(
    claim: PendingTrialClaim,
    allowConfirmedAbsenceRelease: boolean
  ): Promise<{ result: TrialClaimResult; confirmedAbsent: boolean }> {
    if (claim.status === 'review_required') {
      return {
        result: { success: false, messageKey: 'trial_creation_failed' },
        confirmedAbsent: false,
      };
    }

    if (claim.status === 'compensating') {
      if (!allowConfirmedAbsenceRelease || !isOldEnoughToReconcile(claim)) {
        return {
          result: { success: false, messageKey: 'trial_creation_failed' },
          confirmedAbsent: false,
        };
      }
      return this.recoverCompensatingClaim(claim);
    }

    const remoteState = await this.inspectRemoteTrial(claim);
    if (remoteState.state === 'exists') {
      if (!this.remoteBelongsToClaim(claim, remoteState.remote)) {
        await this.markClaimForReview(claim);
        return {
          result: { success: false, messageKey: 'trial_creation_failed' },
          confirmedAbsent: false,
        };
      }
      return {
        result: await this.finalizeCreatedTrial(claim, remoteState.remote, false),
        confirmedAbsent: false,
      };
    }
    if (
      remoteState.state === 'absent' &&
      allowConfirmedAbsenceRelease &&
      isOldEnoughToReconcile(claim)
    ) {
      await this.markClaimFailed(claim);
      return {
        result: { success: false, messageKey: 'trial_creation_failed' },
        confirmedAbsent: true,
      };
    }
    return {
      result: { success: false, messageKey: 'trial_creation_failed' },
      confirmedAbsent: false,
    };
  }

  private async recoverCompensatingClaim(
    claim: PendingTrialClaim
  ): Promise<{ result: TrialClaimResult; confirmedAbsent: boolean }> {
    const remoteState = await this.inspectRemoteTrial(claim);
    if (remoteState.state === 'absent') {
      await this.completeCompensationAsFailed(claim);
      return {
        result: { success: false, messageKey: 'trial_creation_failed' },
        confirmedAbsent: true,
      };
    }
    if (remoteState.state === 'unknown') {
      return {
        result: { success: false, messageKey: 'trial_creation_failed' },
        confirmedAbsent: false,
      };
    }

    if (!this.remoteBelongsToClaim(claim, remoteState.remote)) {
      await this.markClaimForReview(claim);
      return {
        result: { success: false, messageKey: 'trial_creation_failed' },
        confirmedAbsent: false,
      };
    }

    try {
      await this.panels.getService(claim.panelId).deleteUser(claim.configUsername);
      await this.completeCompensationAsFailed(claim);
      return {
        result: { success: false, messageKey: 'trial_creation_failed' },
        confirmedAbsent: true,
      };
    } catch (err) {
      if (err instanceof RebeccaApiError && err.status === 404) {
        await this.completeCompensationAsFailed(claim);
        return {
          result: { success: false, messageKey: 'trial_creation_failed' },
          confirmedAbsent: true,
        };
      }
      logger.warn(
        { err, telegramId: claim.telegramId, configUsername: claim.configUsername },
        'Stale trial compensation remains unresolved'
      );
      return {
        result: { success: false, messageKey: 'trial_creation_failed' },
        confirmedAbsent: false,
      };
    }
  }

  private async inspectRemoteTrial(claim: PendingTrialClaim): Promise<RemoteTrialState> {
    try {
      return {
        state: 'exists',
        remote: await this.panels.getService(claim.panelId).getUser(claim.configUsername),
      };
    } catch (err) {
      if (err instanceof RebeccaApiError && err.status === 404) return { state: 'absent' };
      logger.warn(
        { err, panelId: claim.panelId, configUsername: claim.configUsername },
        'Unable to determine pending trial remote state'
      );
      return { state: 'unknown' };
    }
  }

  private async finalizeCreatedTrial(
    claim: PendingTrialClaim,
    remote: RebeccaUserDetail,
    compensateOnFailure = true
  ): Promise<TrialClaimResult> {
    const subUrl = subscriptionUrl(remote);
    try {
      const finalization = await getDb().transaction(async (tx) => {
        const [currentClaim] = await tx
          .select({
            configUsername: trialClaims.configUsername,
            status: trialClaims.status,
            subUrl: trialClaims.subUrl,
          })
          .from(trialClaims)
          .where(eq(trialClaims.telegramId, claim.telegramId))
          .limit(1);
        // A concurrent recovery may already have bound this exact remote
        // account. That is a successful idempotent finalization, never a
        // reason to compensate by deleting the account.
        if (
          currentClaim?.status === 'completed' &&
          currentClaim.configUsername === claim.configUsername
        ) {
          return { alreadyCompleted: true, subUrl: currentClaim.subUrl ?? subUrl };
        }
        if (
          !currentClaim ||
          currentClaim.configUsername !== claim.configUsername ||
          currentClaim.status !== 'pending'
        ) {
          throw new Error('TRIAL_CLAIM_NOT_PENDING');
        }

        const [updatedUser] = await tx
          .update(users)
          .set({ hasUsedTrial: true, updatedAt: new Date() })
          .where(and(eq(users.telegramId, claim.telegramId), eq(users.hasUsedTrial, false)))
          .returning({ balance: users.balance });
        if (!updatedUser) throw new Error('TRIAL_USER_ALREADY_USED');

        const [boundConfig] = await tx
          .insert(userConfigs)
          .values({
            id: `uc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            telegramId: claim.telegramId,
            panelId: claim.panelId,
            serviceId: claim.serviceId,
            configUsername: claim.configUsername,
            subUrl,
            isClaimed: true,
            claimedAt: new Date(),
          })
          .onConflictDoNothing()
          .returning({ telegramId: userConfigs.telegramId });
        if (!boundConfig) {
          const [existingConfig] = await tx
            .select({ telegramId: userConfigs.telegramId })
            .from(userConfigs)
            .where(
              and(
                eq(userConfigs.panelId, claim.panelId),
                eq(userConfigs.configUsername, claim.configUsername)
              )
            )
            .limit(1);
          if (!existingConfig || existingConfig.telegramId !== claim.telegramId) {
            throw new Error('TRIAL_CONFIG_ALREADY_BOUND');
          }
        }

        const [audit] = await tx
          .insert(walletTransactions)
          .values({
            id: `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            telegramId: claim.telegramId,
            amount: 0,
            balanceAfter: updatedUser.balance,
            type: 'trial',
            referenceId: `trial_${claim.telegramId}`,
            description: `Claimed free trial config: ${claim.configUsername} (${claim.gbAmount}GB / ${claim.durationDays}d)`,
          })
          .onConflictDoNothing()
          .returning({ id: walletTransactions.id });
        if (!audit) throw new Error('TRIAL_AUDIT_ALREADY_EXISTS');

        const [completed] = await tx
          .update(trialClaims)
          .set({ status: 'completed', subUrl, updatedAt: new Date() })
          .where(
            and(eq(trialClaims.telegramId, claim.telegramId), eq(trialClaims.status, 'pending'))
          )
          .returning({ telegramId: trialClaims.telegramId });
        if (!completed) throw new Error('TRIAL_CLAIM_FINALIZE_CONFLICT');
        return { alreadyCompleted: false, subUrl };
      });

      logger.info(
        { telegramId: claim.telegramId, configUsername: claim.configUsername },
        'Free trial claimed and bound successfully'
      );
      return { success: true, messageKey: 'trial_success', subUrl: finalization.subUrl };
    } catch (err) {
      logger.error(
        { err, telegramId: claim.telegramId, configUsername: claim.configUsername },
        'Failed to commit trial binding and audit'
      );
      if (compensateOnFailure) {
        const idempotentResult = await this.compensateFailedTrial(claim, subUrl);
        if (idempotentResult) return idempotentResult;
      }
      return { success: false, messageKey: 'trial_creation_failed' };
    }
  }

  /**
   * Claim exclusive compensation ownership before deleting a remote account.
   * If another finalizer has already completed the claim, this method returns
   * that success and deliberately performs no destructive panel operation.
   */
  private async compensateFailedTrial(
    claim: PendingTrialClaim,
    fallbackSubUrl: string | undefined
  ): Promise<TrialClaimResult | undefined> {
    const db = getDb();
    const [compensating] = await db
      .update(trialClaims)
      .set({ status: 'compensating', updatedAt: new Date() })
      .where(
        and(
          eq(trialClaims.telegramId, claim.telegramId),
          eq(trialClaims.configUsername, claim.configUsername),
          eq(trialClaims.status, 'pending')
        )
      )
      .returning({ telegramId: trialClaims.telegramId });

    if (!compensating) {
      const [currentClaim] = await db
        .select({
          configUsername: trialClaims.configUsername,
          status: trialClaims.status,
          subUrl: trialClaims.subUrl,
        })
        .from(trialClaims)
        .where(eq(trialClaims.telegramId, claim.telegramId))
        .limit(1);
      if (
        currentClaim?.status === 'completed' &&
        currentClaim.configUsername === claim.configUsername
      ) {
        return {
          success: true,
          messageKey: 'trial_success',
          subUrl: currentClaim.subUrl ?? fallbackSubUrl,
        };
      }
      return undefined;
    }

    try {
      await this.panels.getService(claim.panelId).deleteUser(claim.configUsername);
      await this.completeCompensationAsFailed(claim);
    } catch (err) {
      // A failed delete restores pending state. Recovery will bind it if the
      // account exists, instead of clearing the gate and allowing an orphan.
      await db
        .update(trialClaims)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(
          and(
            eq(trialClaims.telegramId, claim.telegramId),
            eq(trialClaims.configUsername, claim.configUsername),
            eq(trialClaims.status, 'compensating')
          )
        );
      logger.error(
        { err, telegramId: claim.telegramId, configUsername: claim.configUsername },
        'Trial compensation outcome is unknown; retaining pending claim'
      );
    }
    return undefined;
  }

  private async completeCompensationAsFailed(claim: PendingTrialClaim): Promise<void> {
    await getDb()
      .update(trialClaims)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(
        and(
          eq(trialClaims.telegramId, claim.telegramId),
          eq(trialClaims.configUsername, claim.configUsername),
          eq(trialClaims.status, 'compensating')
        )
      );
  }

  private remoteBelongsToClaim(claim: PendingTrialClaim, remote: RebeccaUserDetail): boolean {
    return remoteMatchesOwnershipMarker(
      remote,
      trialOwnershipMarker(claim.telegramId, claim.configUsername)
    );
  }

  private async markClaimForReview(claim: PendingTrialClaim): Promise<void> {
    await getDb()
      .update(trialClaims)
      .set({ status: 'review_required', updatedAt: new Date() })
      .where(
        and(
          eq(trialClaims.telegramId, claim.telegramId),
          eq(trialClaims.configUsername, claim.configUsername),
          or(eq(trialClaims.status, 'pending'), eq(trialClaims.status, 'compensating'))
        )
      );
    logger.error(
      { telegramId: claim.telegramId, configUsername: claim.configUsername },
      'Trial claim requires manual review because Rebecca ownership marker mismatched'
    );
  }

  private async markClaimFailed(claim: PendingTrialClaim): Promise<void> {
    await getDb()
      .update(trialClaims)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(
        and(
          eq(trialClaims.telegramId, claim.telegramId),
          eq(trialClaims.panelId, claim.panelId),
          eq(trialClaims.configUsername, claim.configUsername),
          eq(trialClaims.status, 'pending')
        )
      );
  }
}

function positiveInteger(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) return 0;
  return value;
}

function isConfigName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 32 && /^[a-zA-Z0-9._@-]+$/.test(trimmed);
}

function subscriptionUrl(user: RebeccaUserDetail): string | undefined {
  if (user.subscription_url) return user.subscription_url;
  return Object.values(user.subscription_urls ?? {})[0];
}

function toPendingClaim(claim: {
  telegramId: number;
  panelId: string;
  serviceId: number;
  configUsername: string;
  gbAmount: number;
  durationDays: number;
  status: string;
  subUrl: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}): PendingTrialClaim {
  return {
    telegramId: claim.telegramId,
    panelId: claim.panelId,
    serviceId: claim.serviceId,
    configUsername: claim.configUsername,
    gbAmount: claim.gbAmount,
    durationDays: claim.durationDays,
    status: claim.status,
    subUrl: claim.subUrl,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  };
}

function isConfirmedCreateFailure(err: unknown): boolean {
  return (
    err instanceof RebeccaApiError && err.status >= 400 && err.status < 500 && err.status !== 409
  );
}

function isOldEnoughToReconcile(claim: PendingTrialClaim): boolean {
  const referenceTime = claim.updatedAt ?? claim.createdAt;
  if (!referenceTime) return false;
  return Date.now() - referenceTime.getTime() >= PENDING_TRIAL_RECOVERY_DELAY_MS;
}
