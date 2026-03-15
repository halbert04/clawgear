import { eq, sql } from 'drizzle-orm';
import { parseOpenclawData, transformOpenclaw } from './sources/openclaw.js';
import { parseOpenfangData, transformOpenfang } from './sources/openfang.js';
import { parsePaperclipData, transformPaperclip } from './sources/paperclip.js';
import type {
  MigrationContext,
  MigrationOptions,
  MigrationReport,
  MigrationSource,
  PersistOptions,
  PersistResult,
} from './types.js';

function createContext(
  source: MigrationSource,
  companyId: string,
  dryRun: boolean,
): MigrationContext {
  return {
    companyId,
    source,
    dryRun,
    idMaps: {
      companies: new Map(),
      agents: new Map(),
      goals: new Map(),
      projects: new Map(),
      issues: new Map(),
      skills: new Map(),
    },
    errors: [],
    warnings: [],
    counts: {},
  };
}

function buildReport(ctx: MigrationContext): MigrationReport {
  const hasErrors = ctx.errors.length > 0;
  const hasCounts = Object.values(ctx.counts).some((v) => v > 0);

  return {
    source: ctx.source,
    companyId: ctx.companyId,
    dryRun: ctx.dryRun,
    status: hasErrors ? (hasCounts ? 'partial' : 'failed') : 'success',
    counts: ctx.counts,
    errors: ctx.errors,
    warnings: ctx.warnings,
    idMappings: {
      companies: Object.fromEntries(ctx.idMaps.companies),
      agents: Object.fromEntries(ctx.idMaps.agents),
      goals: Object.fromEntries(ctx.idMaps.goals),
      projects: Object.fromEntries(ctx.idMaps.projects),
      issues: Object.fromEntries(ctx.idMaps.issues),
      skills: Object.fromEntries(ctx.idMaps.skills),
    },
  };
}

export interface TransformResult {
  [key: string]: Record<string, unknown>[];
}

/**
 * Run a migration from an external source.
 * In dry-run mode, transforms data and reports what would be imported without writing to DB.
 */
export function migrate(options: MigrationOptions): {
  report: MigrationReport;
  transformed: TransformResult;
} {
  const ctx = createContext(options.source, options.companyId, options.dryRun);

  let transformed: TransformResult;

  switch (options.source) {
    case 'paperclip': {
      const data = parsePaperclipData(options.data);
      transformed = transformPaperclip(data, ctx);
      break;
    }
    case 'openfang': {
      const data = parseOpenfangData(options.data);
      transformed = transformOpenfang(data, ctx);
      break;
    }
    case 'openclaw': {
      const data = parseOpenclawData(options.data);
      transformed = transformOpenclaw(data, ctx);
      break;
    }
    default:
      ctx.errors.push({
        entityType: 'migration',
        entityId: '',
        message: `Unknown migration source: ${options.source}`,
        severity: 'error',
      });
      transformed = {};
  }

  const report = buildReport(ctx);
  return { report, transformed };
}

/**
 * Persist transformed migration data to the database.
 * Each entity is inserted individually with per-entity error handling --
 * partial success is intentional (skip bad entities, keep good ones).
 */
export async function persist(
  db: import('@clawgear/db').Database,
  transformed: TransformResult,
  companyId: string,
  options?: PersistOptions,
): Promise<PersistResult> {
  const { pg } = await import('@clawgear/db');
  const onProgress = options?.onProgress;

  const result: PersistResult = {
    inserted: {},
    skipped: {},
    errors: [],
    verified: {},
  };

  // Pre-flight: verify company exists
  const [company] = await db
    .select({ id: pg.companies.id })
    .from(pg.companies)
    .where(eq(pg.companies.id, companyId));
  if (!company) {
    result.errors.push({
      entityType: 'company',
      entityId: companyId,
      message: `Company ${companyId} not found`,
      severity: 'error',
    });
    return result;
  }

  // Load agent IDs for FK validation
  const agentRows = await db
    .select({ id: pg.agents.id })
    .from(pg.agents)
    .where(eq(pg.agents.companyId, companyId));
  const agentIds = new Set(agentRows.map((r) => r.id));

  // Insert triggers
  const triggerItems = (transformed.triggers ?? []) as Record<string, unknown>[];
  for (let i = 0; i < triggerItems.length; i++) {
    const trigger = triggerItems[i]!;
    try {
      const rows = await db
        .insert(pg.triggers)
        .values({
          id: trigger.id as string,
          companyId: trigger.companyId as string,
          name: trigger.name as string,
          patternType: trigger.patternType as string,
          patternConfig: trigger.patternConfig as Record<string, unknown>,
          actionType: trigger.actionType as string,
          actionConfig: trigger.actionConfig as Record<string, unknown>,
          isActive: (trigger.isActive as boolean) ?? true,
        })
        .onConflictDoNothing()
        .returning({ id: pg.triggers.id });
      if (rows.length > 0) {
        result.inserted.triggers = (result.inserted.triggers ?? 0) + 1;
      } else {
        result.skipped.triggers = (result.skipped.triggers ?? 0) + 1;
      }
    } catch (err) {
      result.skipped.triggers = (result.skipped.triggers ?? 0) + 1;
      result.errors.push({
        entityType: 'trigger',
        entityId: (trigger.id as string) ?? 'unknown',
        message: String(err),
        severity: 'error',
      });
    }
    onProgress?.('write', 'triggers', i + 1, triggerItems.length);
  }

  // Insert workflows
  const workflowItems = (transformed.workflows ?? []) as Record<string, unknown>[];
  for (let i = 0; i < workflowItems.length; i++) {
    const workflow = workflowItems[i]!;
    try {
      const rows = await db
        .insert(pg.workflows)
        .values({
          id: workflow.id as string,
          companyId: workflow.companyId as string,
          name: workflow.name as string,
          definition: workflow.definition as Record<string, unknown>,
          isActive: (workflow.isActive as boolean) ?? true,
        })
        .onConflictDoNothing()
        .returning({ id: pg.workflows.id });
      if (rows.length > 0) {
        result.inserted.workflows = (result.inserted.workflows ?? 0) + 1;
      } else {
        result.skipped.workflows = (result.skipped.workflows ?? 0) + 1;
      }
    } catch (err) {
      result.skipped.workflows = (result.skipped.workflows ?? 0) + 1;
      result.errors.push({
        entityType: 'workflow',
        entityId: (workflow.id as string) ?? 'unknown',
        message: String(err),
        severity: 'error',
      });
    }
    onProgress?.('write', 'workflows', i + 1, workflowItems.length);
  }

  // Insert skills (evolved_skills)
  const skillItems = (transformed.skills ?? []) as Record<string, unknown>[];
  for (let i = 0; i < skillItems.length; i++) {
    const skill = skillItems[i]!;
    const proposedByAgentId = skill.proposedByAgentId as string;
    if (!agentIds.has(proposedByAgentId)) {
      result.skipped.skills = (result.skipped.skills ?? 0) + 1;
      result.errors.push({
        entityType: 'skill',
        entityId: (skill.id as string) ?? 'unknown',
        message: `Agent ${proposedByAgentId} not found in company, skipping skill`,
        severity: 'warning',
      });
      onProgress?.('write', 'skills', i + 1, skillItems.length);
      continue;
    }
    try {
      const rows = await db
        .insert(pg.evolvedSkills)
        .values({
          id: skill.id as string,
          companyId: skill.companyId as string,
          proposedByAgentId,
          name: skill.name as string,
          description: skill.description as string,
          version: skill.version as number,
          content: skill.content as string,
          triggerConditions: skill.triggerConditions as string,
          exampleInvocations: skill.exampleInvocations as unknown[],
          status: skill.status as string,
          usageCount: skill.usageCount as number,
        })
        .onConflictDoNothing()
        .returning({ id: pg.evolvedSkills.id });
      if (rows.length > 0) {
        result.inserted.skills = (result.inserted.skills ?? 0) + 1;
      } else {
        result.skipped.skills = (result.skipped.skills ?? 0) + 1;
      }
    } catch (err) {
      result.skipped.skills = (result.skipped.skills ?? 0) + 1;
      result.errors.push({
        entityType: 'skill',
        entityId: (skill.id as string) ?? 'unknown',
        message: String(err),
        severity: 'error',
      });
    }
    onProgress?.('write', 'skills', i + 1, skillItems.length);
  }

  // Upsert runtime states
  const stateItems = (transformed.runtimeStates ?? []) as Record<string, unknown>[];
  for (let i = 0; i < stateItems.length; i++) {
    const state = stateItems[i]!;
    const agentId = state.agentId as string;
    if (!agentIds.has(agentId)) {
      result.skipped.runtimeStates = (result.skipped.runtimeStates ?? 0) + 1;
      result.errors.push({
        entityType: 'runtimeState',
        entityId: agentId,
        message: `Agent ${agentId} not found in company, skipping runtime state`,
        severity: 'warning',
      });
      onProgress?.('write', 'runtimeStates', i + 1, stateItems.length);
      continue;
    }
    try {
      await db
        .insert(pg.agentRuntimeState)
        .values({
          agentId,
          companyId: state.companyId as string,
          sessionId: state.sessionId as string,
          stateJson: state.stateJson as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: pg.agentRuntimeState.agentId,
          set: {
            sessionId: sql`excluded.session_id`,
            stateJson: sql`excluded.state_json`,
            updatedAt: sql`now()`,
          },
        });
      result.inserted.runtimeStates = (result.inserted.runtimeStates ?? 0) + 1;
    } catch (err) {
      result.skipped.runtimeStates = (result.skipped.runtimeStates ?? 0) + 1;
      result.errors.push({
        entityType: 'runtimeState',
        entityId: agentId,
        message: String(err),
        severity: 'error',
      });
    }
    onProgress?.('write', 'runtimeStates', i + 1, stateItems.length);
  }

  // Verification pass
  if (options?.verify) {
    const [triggerCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pg.triggers)
      .where(eq(pg.triggers.companyId, companyId));
    result.verified.triggers = triggerCount?.count ?? 0;

    const [workflowCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pg.workflows)
      .where(eq(pg.workflows.companyId, companyId));
    result.verified.workflows = workflowCount?.count ?? 0;

    const [skillCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pg.evolvedSkills)
      .where(eq(pg.evolvedSkills.companyId, companyId));
    result.verified.skills = skillCount?.count ?? 0;

    const [stateCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pg.agentRuntimeState)
      .where(eq(pg.agentRuntimeState.companyId, companyId));
    result.verified.runtimeStates = stateCount?.count ?? 0;
  }

  return result;
}
