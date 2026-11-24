import crypto from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgTransaction } from 'drizzle-orm/node-postgres';
import { getDb } from '../../infra/db.js';
import type * as schema from '../../infra/schema.js';
import { auditLogs, userGroups, users } from '../../infra/schema.js';
import { logger } from '../../infra/logger.js';
import { dbIntegerToSafeNumber } from './DbNumber.js';

export type UserGroupRow = typeof userGroups.$inferSelect;
export type DbTransaction = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export const MAX_USER_GROUP_NAME_LENGTH = 80;
export const MAX_USER_GROUP_BADGE_LENGTH = 40;
export const MAX_USER_GROUP_DISCOUNT_PERCENT = 90;
export const MAX_SAFE_MONEY = Number.MAX_SAFE_INTEGER;

export interface EffectiveUserGroupPolicy {
  groupId: string | null;
  groupName: string | null;
  badge: string | null;
  isDefaultGroup: boolean;
  isAssigned: boolean;
  isExpired: boolean;
  expiresAt: Date | null;
  discountPercent: number;
  customPricePerGb: number | null;
  customPricePerDay: number | null;
  allowCatalogDiscounts: boolean;
  allowPromoCodes: boolean;
  allowCashback: boolean;
  allowLuckyWheel: boolean;
  allowCustomServiceName: boolean;
  creditLimit: number;
}

export interface UserGroupWithStats extends UserGroupRow {
  memberCount: number;
}

export interface CreateUserGroupInput {
  id?: string;
  name: string;
  badge?: string | null;
  isDefault?: boolean;
  discountPercent?: number;
  customPricePerGb?: number | null;
  customPricePerDay?: number | null;
  allowCatalogDiscounts?: boolean;
  allowPromoCodes?: boolean;
  allowCashback?: boolean;
  allowLuckyWheel?: boolean;
  allowCustomServiceName?: boolean;
  creditLimit?: number;
}

export interface UpdateUserGroupInput {
  name?: string;
  badge?: string | null;
  isDefault?: boolean;
  discountPercent?: number;
  customPricePerGb?: number | null;
  customPricePerDay?: number | null;
  allowCatalogDiscounts?: boolean;
  allowPromoCodes?: boolean;
  allowCashback?: boolean;
  allowLuckyWheel?: boolean;
  allowCustomServiceName?: boolean;
  creditLimit?: number;
}

export interface DeleteUserGroupResult {
  deleted: boolean;
  transferredCount: number;
  targetGroupId: string | null;
}

export const NEUTRAL_USER_GROUP_POLICY: Readonly<EffectiveUserGroupPolicy> = Object.freeze({
  groupId: null,
  groupName: null,
  badge: null,
  isDefaultGroup: false,
  isAssigned: false,
  isExpired: false,
  expiresAt: null,
  discountPercent: 0,
  customPricePerGb: null,
  customPricePerDay: null,
  allowCatalogDiscounts: true,
  allowPromoCodes: true,
  allowCashback: true,
  allowLuckyWheel: true,
  allowCustomServiceName: false,
  creditLimit: 0,
});

export function isGroupMembershipExpired(
  expiresAt: Date | null | undefined,
  now = new Date()
): boolean {
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() <= now.getTime();
}

export function resolveEffectivePolicyFromRows(
  userRow: { groupId?: string | null; groupExpiresAt?: Date | null } | null | undefined,
  assignedGroup: UserGroupRow | null | undefined,
  defaultGroup: UserGroupRow | null | undefined,
  now = new Date()
): EffectiveUserGroupPolicy {
  const expiresAt = userRow?.groupExpiresAt ?? null;
  const expired = Boolean(userRow?.groupId) && isGroupMembershipExpired(expiresAt, now);

  if (userRow?.groupId && assignedGroup && !expired) {
    return policyFromGroupRow(assignedGroup, {
      isAssigned: true,
      isExpired: false,
      expiresAt,
    });
  }

  if (defaultGroup) {
    return policyFromGroupRow(defaultGroup, {
      isAssigned: false,
      isExpired: expired,
      expiresAt: expired ? expiresAt : null,
    });
  }

  return {
    ...NEUTRAL_USER_GROUP_POLICY,
    isExpired: expired,
    expiresAt: expired ? expiresAt : null,
  };
}

function policyFromGroupRow(
  group: UserGroupRow,
  meta: { isAssigned: boolean; isExpired: boolean; expiresAt: Date | null }
): EffectiveUserGroupPolicy {
  return {
    groupId: group.id,
    groupName: group.name,
    badge: group.badge ?? null,
    isDefaultGroup: group.isDefault,
    isAssigned: meta.isAssigned,
    isExpired: meta.isExpired,
    expiresAt: meta.expiresAt,
    discountPercent: clampDiscountPercent(group.discountPercent),
    customPricePerGb:
      group.customPricePerGb !== null && group.customPricePerGb !== undefined
        ? dbIntegerToSafeNumber(group.customPricePerGb, 'user_group_custom_price_per_gb')
        : null,
    customPricePerDay:
      group.customPricePerDay !== null && group.customPricePerDay !== undefined
        ? dbIntegerToSafeNumber(group.customPricePerDay, 'user_group_custom_price_per_day')
        : null,
    allowCatalogDiscounts: Boolean(group.allowCatalogDiscounts),
    allowPromoCodes: Boolean(group.allowPromoCodes),
    allowCashback: Boolean(group.allowCashback),
    allowLuckyWheel: Boolean(group.allowLuckyWheel),
    allowCustomServiceName: Boolean(group.allowCustomServiceName),
    creditLimit: Math.max(
      0,
      dbIntegerToSafeNumber(group.creditLimit ?? 0, 'user_group_credit_limit')
    ),
  };
}

export function formatUserGroupDisplayLabel(
  policy: Pick<EffectiveUserGroupPolicy, 'groupName' | 'badge'> | null | undefined
): string | null {
  if (!policy) return null;
  const badge = policy.badge?.trim();
  const name = policy.groupName?.trim();
  if (badge && name) {
    return badge.includes(name) ? badge : `${badge} ${name}`;
  }
  return badge || name || null;
}

/**
 * Safe helper that degrades gracefully to {@link NEUTRAL_USER_GROUP_POLICY} when
 * `userGroupService` is omitted or uninitialized (e.g., isolated unit tests).
 */
export async function safeGetEffectiveUserPolicy(
  userGroupService: Pick<UserGroupService, 'getEffectiveUserPolicy'> | undefined,
  telegramId: number | undefined,
  now = new Date()
): Promise<EffectiveUserGroupPolicy> {
  if (!userGroupService || !telegramId || !Number.isSafeInteger(telegramId) || telegramId <= 0) {
    return { ...NEUTRAL_USER_GROUP_POLICY };
  }
  try {
    return await userGroupService.getEffectiveUserPolicy(telegramId, now);
  } catch (err) {
    logger.debug({ err, telegramId }, 'User group policy lookup failed; falling back to defaults');
    return { ...NEUTRAL_USER_GROUP_POLICY };
  }
}

export class UserGroupService {
  private readonly invalidationHooks: Array<(telegramId?: number) => void> = [];

  registerInvalidationHook(hook: (telegramId?: number) => void): void {
    this.invalidationHooks.push(hook);
  }

  private notifyInvalidation(telegramId?: number): void {
    for (const hook of this.invalidationHooks) {
      try {
        hook(telegramId);
      } catch {
        // Cache invalidation hook errors must never fail a committed domain mutation.
      }
    }
  }

  async listGroups(): Promise<UserGroupRow[]> {
    return getDb()
      .select()
      .from(userGroups)
      .orderBy(desc(userGroups.isDefault), asc(userGroups.name), asc(userGroups.createdAt));
  }

  async listGroupsWithMemberCounts(now = new Date()): Promise<UserGroupWithStats[]> {
    const db = getDb();
    const groups = await this.listGroups();
    if (groups.length === 0) return [];

    const defaultGroup = groups.find((g) => g.isDefault) ?? null;

    const counts = await Promise.all(
      groups.map(async (group) => {
        const condition =
          defaultGroup && group.id === defaultGroup.id
            ? or(eq(users.groupId, group.id), isNull(users.groupId), lte(users.groupExpiresAt, now))
            : and(
                eq(users.groupId, group.id),
                or(isNull(users.groupExpiresAt), gt(users.groupExpiresAt, now))
              );
        const [row] = await db
          .select({ value: sql<number>`COUNT(*)` })
          .from(users)
          .where(condition);
        return dbIntegerToSafeNumber(row?.value ?? 0, 'user_group_member_count');
      })
    );

    return groups.map((group, idx) => ({
      ...group,
      memberCount: counts[idx] ?? 0,
    }));
  }

  async getGroupById(id: string): Promise<UserGroupRow | null> {
    const cleanId = id?.trim();
    if (!cleanId) return null;
    const [row] = await getDb()
      .select()
      .from(userGroups)
      .where(eq(userGroups.id, cleanId))
      .limit(1);
    return row ?? null;
  }

  async getDefaultGroup(): Promise<UserGroupRow | null> {
    const [row] = await getDb()
      .select()
      .from(userGroups)
      .where(eq(userGroups.isDefault, true))
      .limit(1);
    return row ?? null;
  }

  async createGroup(input: CreateUserGroupInput, actorAdminId?: number): Promise<UserGroupRow> {
    const name = validateGroupName(input.name);
    const badge = validateGroupBadge(input.badge);
    const discountPercent = validateDiscountPercent(input.discountPercent ?? 0);
    const customPricePerGb = validateOptionalNonNegativePrice(input.customPricePerGb);
    const customPricePerDay = validateOptionalNonNegativePrice(input.customPricePerDay);
    const creditLimit = validateCreditLimit(input.creditLimit ?? 0);
    const isDefault = Boolean(input.isDefault);
    const id = validateOrGenerateGroupId(input.id, name);
    const now = new Date();

    const db = getDb();
    const created = await db.transaction(async (tx) => {
      if (isDefault) {
        await tx
          .update(userGroups)
          .set({ isDefault: false, updatedAt: now })
          .where(eq(userGroups.isDefault, true));
      }

      const [row] = await tx
        .insert(userGroups)
        .values({
          id,
          name,
          badge,
          isDefault,
          discountPercent,
          customPricePerGb,
          customPricePerDay,
          allowCatalogDiscounts: input.allowCatalogDiscounts ?? true,
          allowPromoCodes: input.allowPromoCodes ?? true,
          allowCashback: input.allowCashback ?? true,
          allowLuckyWheel: input.allowLuckyWheel ?? true,
          allowCustomServiceName: input.allowCustomServiceName ?? false,
          creditLimit,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!row) throw new Error('USER_GROUP_CREATE_FAILED');

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: actorAdminId ?? null,
        action: 'user_group_created',
        entityType: 'user_group',
        entityId: row.id,
        metadata: JSON.stringify({
          name: row.name,
          badge: row.badge,
          isDefault: row.isDefault,
          discountPercent: row.discountPercent,
          creditLimit: row.creditLimit,
        }),
      });

      return row;
    });

    if (created.isDefault) {
      this.notifyInvalidation();
    }
    return created;
  }

  async updateGroup(
    id: string,
    input: UpdateUserGroupInput,
    actorAdminId?: number
  ): Promise<UserGroupRow | null> {
    const cleanId = id?.trim();
    if (!cleanId) return null;

    const patch: Partial<typeof userGroups.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) patch.name = validateGroupName(input.name);
    if (input.badge !== undefined) patch.badge = validateGroupBadge(input.badge);
    if (input.discountPercent !== undefined) {
      patch.discountPercent = validateDiscountPercent(input.discountPercent);
    }
    if (input.customPricePerGb !== undefined) {
      patch.customPricePerGb = validateOptionalNonNegativePrice(input.customPricePerGb);
    }
    if (input.customPricePerDay !== undefined) {
      patch.customPricePerDay = validateOptionalNonNegativePrice(input.customPricePerDay);
    }
    if (input.allowCatalogDiscounts !== undefined) {
      patch.allowCatalogDiscounts = Boolean(input.allowCatalogDiscounts);
    }
    if (input.allowPromoCodes !== undefined) {
      patch.allowPromoCodes = Boolean(input.allowPromoCodes);
    }
    if (input.allowCashback !== undefined) {
      patch.allowCashback = Boolean(input.allowCashback);
    }
    if (input.allowLuckyWheel !== undefined) {
      patch.allowLuckyWheel = Boolean(input.allowLuckyWheel);
    }
    if (input.allowCustomServiceName !== undefined) {
      patch.allowCustomServiceName = Boolean(input.allowCustomServiceName);
    }
    if (input.creditLimit !== undefined) {
      patch.creditLimit = validateCreditLimit(input.creditLimit);
    }
    if (input.isDefault !== undefined) {
      patch.isDefault = Boolean(input.isDefault);
    }

    const db = getDb();
    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(userGroups)
        .where(eq(userGroups.id, cleanId))
        .for('update')
        .limit(1);
      if (!existing) return null;

      if (patch.isDefault === true && !existing.isDefault) {
        await tx
          .update(userGroups)
          .set({ isDefault: false, updatedAt: patch.updatedAt })
          .where(and(eq(userGroups.isDefault, true), ne(userGroups.id, cleanId)));
      }

      const [row] = await tx
        .update(userGroups)
        .set(patch)
        .where(eq(userGroups.id, cleanId))
        .returning();
      if (!row) return null;

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: actorAdminId ?? null,
        action: 'user_group_updated',
        entityType: 'user_group',
        entityId: row.id,
        metadata: JSON.stringify(input),
      });

      return row;
    });

    if (updated) {
      this.notifyInvalidation();
    }
    return updated;
  }

  async setDefaultGroup(id: string, actorAdminId?: number): Promise<UserGroupRow | null> {
    return this.updateGroup(id, { isDefault: true }, actorAdminId);
  }

  /**
   * Delete a group safely while transferring existing members either to an
   * explicitly chosen target group, the current default group (if different),
   * or `null` (falling back cleanly to default/neutral policy).
   */
  async deleteGroup(
    id: string,
    options?: { transferToGroupId?: string | null; actorAdminId?: number }
  ): Promise<DeleteUserGroupResult> {
    const cleanId = id?.trim();
    if (!cleanId) return { deleted: false, transferredCount: 0, targetGroupId: null };

    const now = new Date();
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(userGroups)
        .where(eq(userGroups.id, cleanId))
        .for('update')
        .limit(1);
      if (!existing) {
        return { deleted: false, transferredCount: 0, targetGroupId: null };
      }

      let targetGroupId: string | null = null;
      if (options?.transferToGroupId !== undefined) {
        const rawTarget = options.transferToGroupId;
        if (rawTarget !== null) {
          const cleanTarget = rawTarget.trim();
          if (cleanTarget === cleanId) {
            throw new Error('INVALID_TRANSFER_TARGET');
          }
          if (cleanTarget.length > 0) {
            const [target] = await tx
              .select({ id: userGroups.id })
              .from(userGroups)
              .where(eq(userGroups.id, cleanTarget))
              .limit(1);
            if (!target) {
              throw new Error('TRANSFER_TARGET_NOT_FOUND');
            }
            targetGroupId = target.id;
          }
        }
      } else {
        const [defaultRow] = await tx
          .select({ id: userGroups.id })
          .from(userGroups)
          .where(and(eq(userGroups.isDefault, true), ne(userGroups.id, cleanId)))
          .limit(1);
        targetGroupId = defaultRow?.id ?? null;
      }

      const transferred = await tx
        .update(users)
        .set({
          groupId: targetGroupId,
          groupExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(users.groupId, cleanId))
        .returning({ telegramId: users.telegramId });

      await tx.delete(userGroups).where(eq(userGroups.id, cleanId));

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: options?.actorAdminId ?? null,
        action: 'user_group_deleted',
        entityType: 'user_group',
        entityId: cleanId,
        metadata: JSON.stringify({
          deletedGroupName: existing.name,
          targetGroupId,
          transferredCount: transferred.length,
        }),
      });

      return {
        deleted: true,
        transferredCount: transferred.length,
        targetGroupId,
      };
    });

    if (result.deleted) {
      this.notifyInvalidation();
    }
    return result;
  }

  async assignUserGroup(params: {
    telegramId: number;
    groupId: string | null;
    expiresAt?: Date | null;
    actorAdminId?: number;
  }): Promise<EffectiveUserGroupPolicy> {
    if (!Number.isSafeInteger(params.telegramId) || params.telegramId <= 0) {
      throw new Error('INVALID_TELEGRAM_ID');
    }
    const cleanGroupId = params.groupId ? params.groupId.trim() : null;
    const expiresAt =
      cleanGroupId === null ? null : params.expiresAt instanceof Date ? params.expiresAt : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new Error('INVALID_GROUP_EXPIRY');
    }

    const now = new Date();
    const db = getDb();
    await db.transaction(async (tx) => {
      const [user] = await tx
        .select({
          telegramId: users.telegramId,
          groupId: users.groupId,
          groupExpiresAt: users.groupExpiresAt,
        })
        .from(users)
        .where(eq(users.telegramId, params.telegramId))
        .for('update')
        .limit(1);
      if (!user) throw new Error('USER_NOT_FOUND');

      if (cleanGroupId !== null) {
        const [group] = await tx
          .select({ id: userGroups.id })
          .from(userGroups)
          .where(eq(userGroups.id, cleanGroupId))
          .limit(1);
        if (!group) throw new Error('GROUP_NOT_FOUND');
      }

      await tx
        .update(users)
        .set({
          groupId: cleanGroupId,
          groupExpiresAt: expiresAt,
          updatedAt: now,
        })
        .where(eq(users.telegramId, params.telegramId));

      await tx.insert(auditLogs).values({
        id: `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        actorTelegramId: params.actorAdminId ?? null,
        action: cleanGroupId ? 'user_group_assigned' : 'user_group_cleared',
        entityType: 'user',
        entityId: String(params.telegramId),
        targetTelegramId: params.telegramId,
        metadata: JSON.stringify({
          previousGroupId: user.groupId,
          previousExpiresAt: user.groupExpiresAt?.toISOString() ?? null,
          groupId: cleanGroupId,
          expiresAt: expiresAt?.toISOString() ?? null,
        }),
      });
    });

    this.notifyInvalidation(params.telegramId);
    return this.getEffectiveUserPolicy(params.telegramId, now);
  }

  async getEffectiveUserPolicy(
    telegramId: number,
    now = new Date()
  ): Promise<EffectiveUserGroupPolicy> {
    return this.getEffectiveUserPolicyInTx(getDb(), telegramId, undefined, now);
  }

  async getEffectiveUserPolicyInTx(
    dbOrTx: Pick<DbTransaction, 'select'> | ReturnType<typeof getDb>,
    telegramId: number,
    lockedUser?: { groupId?: string | null; groupExpiresAt?: Date | null },
    now = new Date()
  ): Promise<EffectiveUserGroupPolicy> {
    let userRow = lockedUser;
    if (!userRow) {
      const [found] = await dbOrTx
        .select({ groupId: users.groupId, groupExpiresAt: users.groupExpiresAt })
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);
      userRow = found ?? { groupId: null, groupExpiresAt: null };
    }

    const assignedGroupId = userRow.groupId ?? null;
    const isExpired =
      Boolean(assignedGroupId) && isGroupMembershipExpired(userRow.groupExpiresAt, now);

    // Fetch assigned group (if active) and default group in a single query.
    const whereClause =
      assignedGroupId && !isExpired
        ? or(eq(userGroups.id, assignedGroupId), eq(userGroups.isDefault, true))
        : eq(userGroups.isDefault, true);

    const candidateGroups = await dbOrTx.select().from(userGroups).where(whereClause);

    const assignedGroup =
      assignedGroupId && !isExpired
        ? (candidateGroups.find((g) => g.id === assignedGroupId) ?? null)
        : null;
    const defaultGroup = candidateGroups.find((g) => g.isDefault) ?? null;

    return resolveEffectivePolicyFromRows(userRow, assignedGroup, defaultGroup, now);
  }

  /**
   * Batch-resolve effective policies for a list of user rows (used in admin tables).
   */
  async resolvePoliciesForUsers(
    userRows: ReadonlyArray<{
      telegramId: number;
      groupId?: string | null;
      groupExpiresAt?: Date | null;
    }>,
    now = new Date()
  ): Promise<Map<number, EffectiveUserGroupPolicy>> {
    const map = new Map<number, EffectiveUserGroupPolicy>();
    if (userRows.length === 0) return map;

    const groupIds = Array.from(
      new Set(
        userRows
          .map((u) => u.groupId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    const rows =
      groupIds.length > 0
        ? await getDb()
            .select()
            .from(userGroups)
            .where(or(inArray(userGroups.id, groupIds), eq(userGroups.isDefault, true)))
        : await getDb().select().from(userGroups).where(eq(userGroups.isDefault, true));

    const byId = new Map<string, UserGroupRow>();
    let defaultGroup: UserGroupRow | null = null;
    for (const row of rows) {
      byId.set(row.id, row);
      if (row.isDefault) defaultGroup = row;
    }

    for (const u of userRows) {
      const assigned = u.groupId ? (byId.get(u.groupId) ?? null) : null;
      map.set(u.telegramId, resolveEffectivePolicyFromRows(u, assigned, defaultGroup, now));
    }
    return map;
  }
}

function clampDiscountPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_USER_GROUP_DISCOUNT_PERCENT, Math.trunc(value)));
}

function validateGroupName(raw: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length < 1 || trimmed.length > MAX_USER_GROUP_NAME_LENGTH) {
    throw new Error('INVALID_GROUP_NAME');
  }
  return trimmed;
}

function validateGroupBadge(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_USER_GROUP_BADGE_LENGTH) {
    throw new Error('INVALID_GROUP_BADGE');
  }
  return trimmed;
}

function validateDiscountPercent(raw: number): number {
  if (
    typeof raw !== 'number' ||
    !Number.isSafeInteger(raw) ||
    raw < 0 ||
    raw > MAX_USER_GROUP_DISCOUNT_PERCENT
  ) {
    throw new Error('INVALID_DISCOUNT_PERCENT');
  }
  return raw;
}

function validateOptionalNonNegativePrice(raw: number | null | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0 || raw > MAX_SAFE_MONEY) {
    throw new Error('INVALID_CUSTOM_PRICE');
  }
  return raw;
}

function validateCreditLimit(raw: number): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0 || raw > MAX_SAFE_MONEY) {
    throw new Error('INVALID_CREDIT_LIMIT');
  }
  return raw;
}

function validateOrGenerateGroupId(rawId: string | undefined, name: string): string {
  if (rawId !== undefined) {
    const clean = rawId.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,47}$/u.test(clean)) {
      throw new Error('INVALID_GROUP_ID');
    }
    return clean;
  }
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '')
      .slice(0, 18) || 'group';
  return `grp_${slug}_${crypto.randomBytes(3).toString('hex')}`;
}
