import type { Database } from '@clawgear/db';
import { approvals, evolvedSkills, lessonsLearned } from '@clawgear/db/pg';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import { and, eq, sql } from 'drizzle-orm';

export interface SkillProposal {
  name: string;
  description: string;
  content: string;
  triggerConditions: string;
  exampleInvocations: string[];
}

export interface SkillEvolverConfig {
  db: Database;
  eventBus: EventBus;
  minSuccessfulRuns?: number;
}

export class SkillEvolver {
  private db: Database;
  private eventBus: EventBus;
  private minSuccessfulRuns: number;

  constructor(config: SkillEvolverConfig) {
    this.db = config.db;
    this.eventBus = config.eventBus;
    this.minSuccessfulRuns = config.minSuccessfulRuns ?? 5;
  }

  /**
   * Check if an agent has enough successful runs of a task type
   * to warrant proposing a skill.
   */
  async canProposeSkill(companyId: string, agentId: string, taskType: string): Promise<boolean> {
    const successfulLessons = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(lessonsLearned)
      .where(
        and(
          eq(lessonsLearned.companyId, companyId),
          eq(lessonsLearned.agentId, agentId),
          eq(lessonsLearned.taskType, taskType),
          eq(lessonsLearned.outcome, 'success'),
        ),
      );

    const count = successfulLessons[0]?.count ?? 0;
    return count >= this.minSuccessfulRuns;
  }

  /**
   * Propose a new skill based on observed patterns.
   * Creates an evolved_skill record with status='proposed' and an approval request.
   */
  async proposeSkill(
    companyId: string,
    agentId: string,
    proposal: SkillProposal,
  ): Promise<{ skillId: string; approvalId: string }> {
    // Check for duplicate skills (same name, active or approved)
    const [existing] = await this.db
      .select()
      .from(evolvedSkills)
      .where(
        and(
          eq(evolvedSkills.companyId, companyId),
          eq(evolvedSkills.name, proposal.name),
          sql`${evolvedSkills.status} IN ('approved', 'active')`,
        ),
      );

    // Determine version
    let version = 1;
    let parentSkillId: string | null = null;
    if (existing) {
      version = existing.version + 1;
      parentSkillId = existing.id;
    }

    // Insert skill with proposed status
    const [skill] = await this.db
      .insert(evolvedSkills)
      .values({
        companyId,
        proposedByAgentId: agentId,
        name: proposal.name,
        description: proposal.description,
        version,
        content: proposal.content,
        triggerConditions: proposal.triggerConditions,
        exampleInvocations: proposal.exampleInvocations,
        status: 'proposed',
        parentSkillId,
      })
      .returning();

    // Create approval request
    const [approval] = await this.db
      .insert(approvals)
      .values({
        companyId,
        type: 'skill_proposal',
        requestedByAgentId: agentId,
        payload: {
          skillId: skill!.id,
          skillName: proposal.name,
          description: proposal.description,
          version,
          triggerConditions: proposal.triggerConditions,
          exampleCount: proposal.exampleInvocations.length,
        },
      })
      .returning();

    // Emit event
    this.emit('evolution.skill_proposed', companyId, {
      skillId: skill!.id,
      agentId,
      skillName: proposal.name,
      version,
    });

    return { skillId: skill!.id, approvalId: approval!.id };
  }

  /**
   * Approve a proposed skill, transitioning it to 'approved' status.
   * If there's a previous active version, deprecate it.
   */
  async approveSkill(skillId: string, approvedBy: string): Promise<void> {
    const [skill] = await this.db.select().from(evolvedSkills).where(eq(evolvedSkills.id, skillId));

    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    if (skill.status !== 'proposed') {
      throw new Error(`Skill ${skillId} is not in proposed status`);
    }

    // Deprecate previous active version if exists
    if (skill.parentSkillId) {
      await this.db
        .update(evolvedSkills)
        .set({ status: 'deprecated', updatedAt: new Date() })
        .where(and(eq(evolvedSkills.id, skill.parentSkillId), eq(evolvedSkills.status, 'active')));
    }

    // Also deprecate any other active skills with the same name
    await this.db
      .update(evolvedSkills)
      .set({ status: 'deprecated', updatedAt: new Date() })
      .where(
        and(
          eq(evolvedSkills.companyId, skill.companyId),
          eq(evolvedSkills.name, skill.name),
          eq(evolvedSkills.status, 'active'),
        ),
      );

    // Activate the new skill
    await this.db
      .update(evolvedSkills)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(evolvedSkills.id, skillId));

    this.emit('evolution.skill_approved', skill.companyId, {
      skillId,
      skillName: skill.name,
      approvedBy,
    });
  }

  /**
   * Deprecate a skill.
   */
  async deprecateSkill(skillId: string): Promise<void> {
    const [skill] = await this.db.select().from(evolvedSkills).where(eq(evolvedSkills.id, skillId));

    if (!skill) throw new Error(`Skill not found: ${skillId}`);

    await this.db
      .update(evolvedSkills)
      .set({ status: 'deprecated', updatedAt: new Date() })
      .where(eq(evolvedSkills.id, skillId));

    this.emit('evolution.skill_deprecated', skill.companyId, {
      skillId,
      skillName: skill.name,
    });
  }

  /**
   * Record usage of a skill, incrementing its usage count.
   */
  async recordUsage(skillId: string): Promise<void> {
    await this.db
      .update(evolvedSkills)
      .set({
        usageCount: sql`${evolvedSkills.usageCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(evolvedSkills.id, skillId));
  }

  private emit(type: string, companyId: string, payload: Record<string, unknown>): void {
    const event: SystemEvent = {
      type,
      companyId,
      timestamp: new Date(),
      payload,
    };
    this.eventBus.emit(event);
  }
}
