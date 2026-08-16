/** Purchase execution saga extracted from WalletService. */

import crypto from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../infra/db.js';
import {
  purchaseIntents,
  trialClaims,
  userConfigs,
  users,
  walletTransactions,
} from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import {
  RebeccaApiError,
  RebeccaContractError,
  RebeccaOriginDownError,
  type RebeccaUserDetail,
} from './RebeccaService.js';
import { activeConfigCountSql, observedConfigLifecycle } from './ConfigLifecycle.js';
import type { ReferralService } from './ReferralService.js';
import type { PromoService } from './PromoService.js';
import type { RebeccaPanelRegistry } from './RebeccaPanelRegistry.js';
import { purchaseOwnershipMarker, remoteFingerprint } from './RebeccaOwnership.js';
import { verifyOrEstablishConfigIncarnation } from './ConfigIncarnation.js';
import { withConfigLock } from './ConfigLock.js';
import {
  PurchaseInProgressError,
  PurchaseOutcomePendingError,
  type PurchaseSagaParams,
  type PurchaseSagaResult,
} from './WalletContracts.js';
import {
  PanelPurchaseVerificationError,
  PurchaseIntentAlreadySettledError,
  assertPanelPurchaseApplied,
  errorMessage,
  isRemoteOutcomeIndeterminate,
  isUniqueViolation,
  validatePurchaseSagaParams,
} from './WalletSupport.js';

const NON_TERMINAL_INTENT_STATUSES = ['pending', 'reconciliation_required'] as const;
const PARTIAL_RENEWAL_REVIEW_MESSAGE =
  'Traffic reset applied but renewal update outcome is unresolved; manual review required';
const FOREGROUND_LEASE_MS = 12 * 60 * 1000;

export class WalletPurchaseSaga {
  constructor(
    private readonly panels: Pick<RebeccaPanelRegistry, 'resolveTarget'>,
    private readonly referralService: ReferralService,
    private readonly promoService: PromoService,
    private readonly verifyBindingConflict = true
  ) {}

  async execute(params: PurchaseSagaParams): Promise<PurchaseSagaResult> {
    validatePurchaseSagaParams(params);

    const db = getDb();
    const target = await this.panels.resolveTarget(params.panelId, params.serviceId);
    const { panelId, serviceId, service: rebeccaService } = target;

    // This check makes a repeat tap fail quickly. The partial unique index is
    // still authoritative because this read deliberately does not try to race
    // a concurrent request.
    const [existingPending] = await db
      .select({ id: purchaseIntents.id })
      .from(purchaseIntents)
      .where(
        and(
          eq(purchaseIntents.telegramId, params.telegramId),
          inArray(purchaseIntents.status, NON_TERMINAL_INTENT_STATUSES)
        )
      )
      .limit(1);
    if (existingPending) throw new PurchaseInProgressError(existingPending.id);

    const intentId = `pi_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    // Promo pricing is derived only inside the same transaction that reserves
    // the intent. UI quotes are display-only and can never set these values.
    const final = { amount: params.amount, gbAmount: params.gbAmount };

    try {
      await db.transaction(async (tx) => {
        // Insert a provisional intent first. Promo reservation can safely add
        // its own rows here, derive final.amount/final.gbAmount, then update this
        // intent before the guarded wallet reservation below.
        await tx.insert(purchaseIntents).values({
          id: intentId,
          telegramId: params.telegramId,
          panelId,
          serviceId,
          checkoutId: params.checkoutId ?? null,
          amount: params.amount,
          type: params.type,
          status: 'pending',
          configUsername: params.configUsername,
          gbAmount: params.gbAmount,
          durationDays: params.durationDays,
          operationStartedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + FOREGROUND_LEASE_MS),
        });

        if (params.promoCode) {
          const promo = await this.promoService.reserveForPurchase(tx, {
            telegramId: params.telegramId,
            intentId,
            rawCode: params.promoCode,
            baseAmount: params.amount,
            baseGbAmount: params.gbAmount,
          });
          final.amount = promo.finalAmount;
          final.gbAmount = promo.finalGbAmount;
        }

        if (params.maxAmount !== undefined && final.amount > params.maxAmount) {
          throw new Error('PURCHASE_QUOTE_CHANGED');
        }

        const bonusSnapshot = (await this.referralService?.calculateBonusSnapshot?.(
          tx,
          params.telegramId,
          final.amount
        )) ?? {
          cashbackPercent: null,
          cashbackAmount: null,
          referrerTelegramId: null,
          referralBonusAmount: null,
        };

        await tx
          .update(purchaseIntents)
          .set({
            amount: final.amount,
            gbAmount: final.gbAmount,
            cashbackPercent: bonusSnapshot.cashbackPercent,
            cashbackAmount: bonusSnapshot.cashbackAmount,
            referrerTelegramId: bonusSnapshot.referrerTelegramId,
            referralBonusAmount: bonusSnapshot.referralBonusAmount,
            updatedAt: new Date(),
          })
          .where(eq(purchaseIntents.id, intentId));

        const reserved = await tx
          .update(users)
          .set({
            reservedBalance: sql`${users.reservedBalance} + ${final.amount}`,
            updatedAt: new Date(),
          })
          .where(
            sql`${users.telegramId} = ${params.telegramId}
              AND ${users.balance} - ${users.reservedBalance} >= ${final.amount}`
          )
          .returning({ telegramId: users.telegramId });
        if (reserved.length === 0) throw new Error('INSUFFICIENT_BALANCE');
      });
    } catch (err) {
      // The partial unique index is the final race-safe double-submit guard.
      if (isUniqueViolation(err)) throw new PurchaseInProgressError();
      throw err;
    }

    const getIntentStatus = async (): Promise<string | undefined> => {
      const [intent] = await db
        .select({ status: purchaseIntents.status })
        .from(purchaseIntents)
        .where(eq(purchaseIntents.id, intentId))
        .limit(1);
      return intent?.status;
    };

    const releaseReservation = async (errorMessage: string): Promise<boolean> => {
      return db.transaction(async (tx) => {
        const changed = await tx
          .update(purchaseIntents)
          .set({
            status: 'failed',
            errorMessage,
            leaseExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(sql`${purchaseIntents.id} = ${intentId} AND ${purchaseIntents.status} = 'pending'`)
          .returning({ id: purchaseIntents.id });
        if (changed.length === 0) return false;

        await this.promoService.releaseReservedPurchasePromoInTransaction(tx, intentId);

        const released = await tx
          .update(users)
          .set({
            reservedBalance: sql`${users.reservedBalance} - ${final.amount}`,
            updatedAt: new Date(),
          })
          .where(
            sql`${users.telegramId} = ${params.telegramId}
              AND ${users.reservedBalance} >= ${final.amount}`
          )
          .returning({ telegramId: users.telegramId });
        if (released.length === 0) throw new Error('RESERVATION_INVARIANT_VIOLATION');
        return true;
      });
    };

    const keepPendingForReconciliation = async (errorMessage: string): Promise<void> => {
      await db
        .update(purchaseIntents)
        .set({
          status: 'pending',
          errorMessage,
          // Foreground execution has ended. Recovery may now claim this row.
          leaseExpiresAt: new Date(),
          updatedAt: new Date(),
        })
        .where(sql`${purchaseIntents.id} = ${intentId} AND ${purchaseIntents.status} = 'pending'`);
    };

    const completeBonuses = async (): Promise<void> => {
      try {
        // Bonus failures must never make a completed paid purchase look failed
        // to the caller; ReferralService itself makes retries idempotent.
        await this.referralService.processCompletedPurchase(
          params.telegramId,
          final.amount,
          intentId
        );
        await db
          .update(purchaseIntents)
          .set({ bonusesProcessedAt: new Date(), updatedAt: new Date() })
          .where(
            sql`${purchaseIntents.id} = ${intentId} AND ${purchaseIntents.status} = 'completed'`
          );
      } catch (err) {
        // `bonusesProcessedAt` remains NULL, which lets the reconciliation
        // worker retry the deterministic ledger credits after a transient DB
        // failure without ever duplicating a reward.
        logger.error({ err, intentId }, 'Completed purchase bonus processing deferred');
      }
    };

    const dataLimitBytes = final.gbAmount * 1024 * 1024 * 1024;
    const expireTimestamp = Math.floor(Date.now() / 1000) + params.durationDays * 86400;

    const executeMutationAndCommit = async (): Promise<PurchaseSagaResult> => {
      let subUrl: string | undefined;
      let confirmedRemote: RebeccaUserDetail | undefined;
      let renewalBefore:
        | {
            dataLimit: number | null;
            expire: number | null;
            status: 'active' | 'disabled' | 'on_hold';
          }
        | undefined;
      let remoteMutationAttempted = false;
      let renewalTrafficReset = false;
      const invokeRemoteMutation = async <T>(mutation: () => Promise<T>): Promise<T> => {
        await db
          .update(purchaseIntents)
          .set({
            leaseExpiresAt: new Date(Date.now() + FOREGROUND_LEASE_MS),
            updatedAt: new Date(),
          })
          .where(
            sql`${purchaseIntents.id} = ${intentId} AND ${purchaseIntents.status} = 'pending'`
          );
        try {
          const result = await mutation();
          remoteMutationAttempted = true;
          return result;
        } catch (err) {
          if (
            (err instanceof RebeccaApiError && err.endpoint !== '/api/admin/token') ||
            err instanceof RebeccaContractError ||
            (err instanceof RebeccaOriginDownError &&
              err.requestDispatched &&
              err.endpoint !== '/api/admin/token')
          ) {
            remoteMutationAttempted = true;
          }
          throw err;
        }
      };

      // Step 2: prepare a renewal target, then call Rebecca through the domain
      // service. Persisting the target before PUT makes a confirmed ambiguous
      // mutation response reconcilable.
      try {
        if (params.type === 'new_config') {
          const res = await invokeRemoteMutation(() =>
            rebeccaService.createUser({
              username: params.configUsername,
              service_id: serviceId,
              data_limit: dataLimitBytes,
              expire: expireTimestamp,
              status: 'active',
              note: purchaseOwnershipMarker(intentId),
            })
          );
          if (res.note !== purchaseOwnershipMarker(intentId)) {
            throw new PanelPurchaseVerificationError();
          }
          assertPanelPurchaseApplied(res, dataLimitBytes, expireTimestamp);
          confirmedRemote = res;
          subUrl = res.subscription_url || Object.values(res.subscription_urls ?? {})[0];
        } else {
          const existing = await rebeccaService.getUser(params.configUsername);
          const [localConfig] = await db
            .select()
            .from(userConfigs)
            .where(
              and(
                eq(userConfigs.telegramId, params.telegramId),
                eq(userConfigs.panelId, panelId),
                eq(userConfigs.configUsername, params.configUsername)
              )
            )
            .limit(1);
          if (!localConfig) throw new Error('CONFIG_NOT_OWNED');
          await verifyOrEstablishConfigIncarnation(localConfig, existing);
          if (
            existing.status !== 'active' &&
            existing.status !== 'disabled' &&
            existing.status !== 'on_hold'
          ) {
            throw new Error(`Cannot renew configuration in ${existing.status} state`);
          }

          renewalBefore = {
            dataLimit: existing.data_limit,
            expire: existing.expire,
            status: existing.status,
          };
          // Reset both traffic quota and duration explicitly from now, regardless
          // of previous quota (finite or unlimited) or previous expiration time.
          const expectedExpire = Math.floor(Date.now() / 1000) + params.durationDays * 86400;
          const expectedDataLimit = dataLimitBytes;

          const prepared = await db
            .update(purchaseIntents)
            .set({
              previousDataLimit: renewalBefore.dataLimit,
              previousExpire: renewalBefore.expire,
              previousStatus: renewalBefore.status,
              expectedDataLimit,
              expectedExpire,
              expectedStatus: 'active',
              updatedAt: new Date(),
            })
            .where(
              sql`${purchaseIntents.id} = ${intentId} AND ${purchaseIntents.status} = 'pending'`
            )
            .returning({ id: purchaseIntents.id });
          if (prepared.length === 0) {
            throw new PurchaseIntentAlreadySettledError(await getIntentStatus());
          }

          await invokeRemoteMutation(() => rebeccaService.resetUserTraffic(params.configUsername));
          renewalTrafficReset = true;
          const res = await invokeRemoteMutation(() =>
            rebeccaService.updateUser(params.configUsername, {
              expire: expectedExpire,
              status: 'active',
              data_limit: expectedDataLimit,
            })
          );
          assertPanelPurchaseApplied(res, expectedDataLimit, expectedExpire);
          confirmedRemote = res;
          subUrl = res.subscription_url || Object.values(res.subscription_urls ?? {})[0];
        }
      } catch (err: unknown) {
        if (err instanceof PurchaseIntentAlreadySettledError) {
          if (err.status === 'completed') {
            await completeBonuses();
            return { success: true, configUsername: params.configUsername, subUrl };
          }
          throw new Error('Transaction is no longer active.', { cause: err });
        }

        logger.error(
          {
            err,
            intentId,
            telegramId: params.telegramId,
            purchaseType: params.type,
            panelId,
            serviceId,
            checkoutId: params.checkoutId,
            configUsername: params.configUsername,
          },
          'Rebecca API call failed in purchase saga'
        );
        const errMsg = errorMessage(err);
        if (renewalTrafficReset) {
          await keepPendingForReconciliation(PARTIAL_RENEWAL_REVIEW_MESSAGE);
          throw new PurchaseOutcomePendingError(intentId, { cause: err });
        }
        if (remoteMutationAttempted && isRemoteOutcomeIndeterminate(err)) {
          await keepPendingForReconciliation('Remote outcome unknown; awaiting reconciliation');
          throw new PurchaseOutcomePendingError(intentId, { cause: err });
        }

        await releaseReservation(errMsg);
        if (err instanceof RebeccaOriginDownError) throw err;
        throw new Error(`VPN Panel operation failed: ${errMsg}`, { cause: err });
      }

      if (!confirmedRemote) throw new Error('PANEL_PURCHASE_RESULT_MISSING');
      const observedAt = new Date();

      // Step 3: atomically claim the pending intent, debit the reservation, write
      // one audit row, and bind a new config. Claiming the intent first prevents a
      // late saga response from compensating a result the reconciler already won.
      try {
        const committed = await db.transaction(async (tx) => {
          const transitioned = await tx
            .update(purchaseIntents)
            .set({
              status: 'completed',
              errorMessage: null,
              leaseExpiresAt: null,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              sql`${purchaseIntents.id} = ${intentId} AND ${purchaseIntents.status} = 'pending'`
            )
            .returning({ id: purchaseIntents.id });
          if (transitioned.length === 0) return false;

          const updatedUsers = await tx
            .update(users)
            .set({
              balance: sql`${users.balance} - ${final.amount}`,
              reservedBalance: sql`${users.reservedBalance} - ${final.amount}`,
              totalSpend: sql`${users.totalSpend} + ${final.amount}`,
              updatedAt: new Date(),
            })
            .where(
              sql`${users.telegramId} = ${params.telegramId}
              AND ${users.reservedBalance} >= ${final.amount}
              AND ${users.balance} >= ${final.amount}`
            )
            .returning();
          if (updatedUsers.length === 0) throw new Error('RESERVATION_INVARIANT_VIOLATION');

          const newBalance = updatedUsers[0]!.balance;
          const txId = `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          await tx.insert(walletTransactions).values({
            id: txId,
            telegramId: params.telegramId,
            amount: -final.amount,
            balanceAfter: newBalance,
            type: 'purchase',
            referenceId: intentId,
            description: `Purchase ${params.type}: ${params.configUsername} (${final.gbAmount}GB / ${params.durationDays}d)${params.promoCode ? `; promo ${params.promoCode}` : ''}`,
          });

          if (params.type === 'new_config') {
            const ucId = `uc_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
            const bindingInsert = tx
              .insert(userConfigs)
              .values({
                id: ucId,
                telegramId: params.telegramId,
                panelId,
                serviceId,
                configUsername: params.configUsername,
                subUrl,
                isClaimed: true,
                claimedAt: new Date(),
                remoteCreatedAt: remoteFingerprint(confirmedRemote),
                ...observedConfigLifecycle(confirmedRemote, observedAt),
              })
              .onConflictDoNothing();
            if (!this.verifyBindingConflict) {
              await bindingInsert;
            } else {
              const [bound] = await bindingInsert.returning({ id: userConfigs.id });
              if (bound) {
                // The binding was created by this transaction.
              } else {
                const [existingBinding] = await tx
                  .select({ telegramId: userConfigs.telegramId })
                  .from(userConfigs)
                  .where(
                    and(
                      eq(userConfigs.panelId, panelId),
                      eq(userConfigs.configUsername, params.configUsername)
                    )
                  )
                  .limit(1);
                if (!existingBinding || existingBinding.telegramId !== params.telegramId) {
                  throw new Error('CONFIG_BINDING_CONFLICT');
                }
                await tx
                  .update(userConfigs)
                  .set({
                    ...(subUrl ? { subUrl } : {}),
                    serviceId,
                    ...observedConfigLifecycle(confirmedRemote, observedAt),
                  })
                  .where(
                    and(
                      eq(userConfigs.panelId, panelId),
                      eq(userConfigs.configUsername, params.configUsername),
                      eq(userConfigs.telegramId, params.telegramId)
                    )
                  );
              }
            }
          } else {
            // A paid renewal converts a trial config permanently. The cleanup
            // worker must never delete that username after its later paid expiry.
            await tx
              .update(trialClaims)
              .set({ status: 'converted', updatedAt: new Date() })
              .where(
                and(
                  eq(trialClaims.panelId, panelId),
                  eq(trialClaims.configUsername, params.configUsername),
                  eq(trialClaims.status, 'completed')
                )
              );
            const [updated] = await tx
              .update(userConfigs)
              .set({
                ...(subUrl ? { subUrl } : {}),
                serviceId,
                ...observedConfigLifecycle(confirmedRemote, observedAt),
              })
              .where(
                and(
                  eq(userConfigs.panelId, panelId),
                  eq(userConfigs.configUsername, params.configUsername),
                  eq(userConfigs.telegramId, params.telegramId)
                )
              )
              .returning({ id: userConfigs.id });
            if (!updated) {
              throw new Error('CONFIG_OWNERSHIP_LOST');
            }
          }

          await tx
            .update(users)
            .set({
              activeSubscriptionCount: activeConfigCountSql(params.telegramId),
              updatedAt: observedAt,
            })
            .where(eq(users.telegramId, params.telegramId));

          await this.promoService.finalizeReservedPurchasePromo(tx, intentId);
          return true;
        });

        if (!committed) {
          throw new PurchaseIntentAlreadySettledError(await getIntentStatus());
        }
      } catch (err: unknown) {
        if (err instanceof PurchaseIntentAlreadySettledError) {
          if (err.status === 'completed') {
            await completeBonuses();
            return { success: true, configUsername: params.configUsername, subUrl };
          }
          throw new Error('Transaction is no longer active.', { cause: err });
        }

        logger.error(
          { err, intentId },
          'DB transaction failed after Rebecca API success; attempting confirmed compensation'
        );

        let compensationConfirmed = false;
        try {
          if (params.type === 'new_config') {
            await rebeccaService.deleteUser(params.configUsername);
            compensationConfirmed = true;
          } else {
            // Consumed traffic cannot be restored after resetUserTraffic; do not claim full compensation
            compensationConfirmed = false;
          }
        } catch (compensationError) {
          logger.error(
            { err: compensationError, intentId },
            'Compensation outcome is unknown; reconciliation must settle the intent'
          );
        }

        if (compensationConfirmed) {
          try {
            await releaseReservation(
              `Local commit failed after confirmed compensation: ${errorMessage(err)}`
            );
          } catch (releaseError) {
            logger.error(
              { err: releaseError, intentId },
              'Compensation succeeded but reservation release failed; deferring to reconciliation'
            );
            await keepPendingForReconciliation(
              'Compensation confirmed; reservation release is pending'
            );
            throw new PurchaseOutcomePendingError(intentId, { cause: releaseError });
          }
          throw new Error('Transaction failed; wallet was not charged.', { cause: err });
        }

        await keepPendingForReconciliation(
          params.type === 'renew_config'
            ? 'Remote renewal applied (traffic reset) but local commit failed; reconciliation required'
            : 'Local commit failed after remote success; awaiting reconciliation'
        );
        throw new PurchaseOutcomePendingError(intentId, { cause: err });
      }

      await completeBonuses();
      return { success: true, configUsername: params.configUsername, subUrl };
    };

    if (params.type === 'renew_config') {
      return withConfigLock(panelId, params.configUsername, executeMutationAndCommit);
    }
    return executeMutationAndCommit();
  }
}
