import { asc, eq, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { getDb } from '../../infra/db.js';
import { packageCategories } from '../../infra/schema.js';
import type { TranslationService } from './TranslationService.js';
import { parsePackageOptionsJson, type PackageOption } from './PricingService.js';
import { logger } from '../../infra/logger.js';

export type PackageCategory = typeof packageCategories.$inferSelect;

export interface CreateCategoryInput {
  id?: string;
  name: string;
  description?: string;
  icon?: string;
  displayOrder?: number;
  enabled?: boolean;
}

export interface UpdateCategoryInput {
  name?: string;
  description?: string;
  icon?: string;
  displayOrder?: number;
  enabled?: boolean;
}

export class PackageCategoryService {
  constructor(private readonly translationService: TranslationService) {}

  async listCategories(includeDisabled = false): Promise<PackageCategory[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(packageCategories)
      .orderBy(asc(packageCategories.displayOrder), asc(packageCategories.createdAt));

    return includeDisabled ? rows : rows.filter((cat) => cat.enabled);
  }

  async getCategoryById(id: string): Promise<PackageCategory | null> {
    if (!id || !id.trim()) return null;
    const db = getDb();
    const [row] = await db
      .select()
      .from(packageCategories)
      .where(eq(packageCategories.id, id.trim()))
      .limit(1);

    return row ?? null;
  }

  async createCategory(input: CreateCategoryInput): Promise<PackageCategory> {
    const db = getDb();
    const trimmedName = input.name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      throw new Error('INVALID_CATEGORY_NAME');
    }

    const id = (input.id?.trim() || generateCategoryId(trimmedName)).slice(0, 64);
    const displayOrder = input.displayOrder ?? (await this.getNextDisplayOrder());

    const [created] = await db
      .insert(packageCategories)
      .values({
        id,
        name: trimmedName,
        description: input.description?.trim() || null,
        icon: input.icon?.trim() || null,
        displayOrder: Math.max(0, displayOrder),
        enabled: input.enabled ?? true,
      })
      .returning();

    if (!created) {
      throw new Error('CATEGORY_CREATION_FAILED');
    }

    logger.info({ categoryId: created.id, name: created.name }, 'Package category created');
    return created;
  }

  async updateCategory(id: string, input: UpdateCategoryInput): Promise<PackageCategory | null> {
    const trimmedId = id.trim();
    if (!trimmedId) return null;
    const db = getDb();

    const updates: Partial<typeof packageCategories.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) {
      const trimmedName = input.name.trim();
      if (!trimmedName || trimmedName.length > 100) {
        throw new Error('INVALID_CATEGORY_NAME');
      }
      updates.name = trimmedName;
    }

    if (input.description !== undefined) {
      updates.description = input.description.trim() || null;
    }

    if (input.icon !== undefined) {
      updates.icon = input.icon.trim() || null;
    }

    if (input.displayOrder !== undefined) {
      updates.displayOrder = Math.max(0, input.displayOrder);
    }

    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }

    const [updated] = await db
      .update(packageCategories)
      .set(updates)
      .where(eq(packageCategories.id, trimmedId))
      .returning();

    if (updated) {
      logger.info({ categoryId: updated.id }, 'Package category updated');
    }

    return updated ?? null;
  }

  async deleteCategory(id: string): Promise<boolean> {
    const trimmedId = id.trim();
    if (!trimmedId) return false;
    const db = getDb();

    const [deleted] = await db
      .delete(packageCategories)
      .where(eq(packageCategories.id, trimmedId))
      .returning({ id: packageCategories.id });

    if (!deleted) return false;

    // Unlink category from all packages in packages_json without deleting packages
    try {
      const rawJson = this.translationService.getSetting('packages_json');
      const packages = parsePackageOptionsJson(rawJson);
      if (packages && packages.some((pkg) => pkg.categoryId === trimmedId)) {
        const updatedPackages: PackageOption[] = packages.map((pkg) =>
          pkg.categoryId === trimmedId ? { ...pkg, categoryId: undefined } : pkg
        );
        await this.translationService.updateSetting(
          'packages_json',
          JSON.stringify(updatedPackages)
        );
        logger.info(
          { categoryId: trimmedId },
          'Unlinked deleted category from active packages in configuration'
        );
      }
    } catch (err) {
      logger.warn({ err, categoryId: trimmedId }, 'Failed to unlink category from packages_json');
    }

    return true;
  }

  async reorderCategories(orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    const db = getDb();
    await db.transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx
          .update(packageCategories)
          .set({ displayOrder: index, updatedAt: new Date() })
          .where(eq(packageCategories.id, id.trim()));
      }
    });
  }

  private async getNextDisplayOrder(): Promise<number> {
    const db = getDb();
    const [row] = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(${packageCategories.displayOrder}), -1)` })
      .from(packageCategories);

    return (row?.maxOrder ?? -1) + 1;
  }
}

function generateCategoryId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\w\u0600-\u06FF]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

  const suffix = crypto.randomBytes(3).toString('hex');
  return slug ? `cat_${slug}_${suffix}` : `cat_${Date.now()}_${suffix}`;
}
