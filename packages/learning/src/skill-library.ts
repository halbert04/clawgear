import type { Database } from '@clawgear/db';
import { evolvedSkills } from '@clawgear/db/pg';
import { and, desc, eq, sql } from 'drizzle-orm';

export interface SkillLibraryConfig {
  db: Database;
}

export class SkillLibrary {
  private db: Database;

  constructor(config: SkillLibraryConfig) {
    this.db = config.db;
  }

  /**
   * Get all active skills for a company.
   */
  async getActiveSkills(companyId: string) {
    return this.db
      .select()
      .from(evolvedSkills)
      .where(and(eq(evolvedSkills.companyId, companyId), eq(evolvedSkills.status, 'active')))
      .orderBy(desc(evolvedSkills.usageCount));
  }

  /**
   * Get all skills for a company (any status).
   */
  async getAllSkills(companyId: string, status?: string) {
    const conditions = [eq(evolvedSkills.companyId, companyId)];
    if (status) {
      conditions.push(eq(evolvedSkills.status, status));
    }
    return this.db
      .select()
      .from(evolvedSkills)
      .where(and(...conditions))
      .orderBy(desc(evolvedSkills.createdAt));
  }

  /**
   * Get a single skill by ID.
   */
  async getSkill(skillId: string) {
    const [skill] = await this.db.select().from(evolvedSkills).where(eq(evolvedSkills.id, skillId));
    return skill ?? null;
  }

  /**
   * Get the active version of a named skill.
   */
  async getActiveVersion(companyId: string, name: string) {
    const [skill] = await this.db
      .select()
      .from(evolvedSkills)
      .where(
        and(
          eq(evolvedSkills.companyId, companyId),
          eq(evolvedSkills.name, name),
          eq(evolvedSkills.status, 'active'),
        ),
      );
    return skill ?? null;
  }

  /**
   * Search skills by description using text matching.
   */
  async searchSkills(companyId: string, query: string, limit = 10) {
    return this.db
      .select()
      .from(evolvedSkills)
      .where(
        and(
          eq(evolvedSkills.companyId, companyId),
          eq(evolvedSkills.status, 'active'),
          sql`(
            ${evolvedSkills.name} ILIKE ${`%${query}%`}
            OR ${evolvedSkills.description} ILIKE ${`%${query}%`}
            OR ${evolvedSkills.triggerConditions} ILIKE ${`%${query}%`}
          )`,
        ),
      )
      .orderBy(desc(evolvedSkills.usageCount))
      .limit(limit);
  }

  /**
   * Get skill version history for a named skill.
   */
  async getVersionHistory(companyId: string, name: string) {
    return this.db
      .select()
      .from(evolvedSkills)
      .where(and(eq(evolvedSkills.companyId, companyId), eq(evolvedSkills.name, name)))
      .orderBy(desc(evolvedSkills.version));
  }
}
