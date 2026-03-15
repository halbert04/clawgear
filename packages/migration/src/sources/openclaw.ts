import { createHash, randomUUID } from 'node:crypto';
import type { MigrationContext, OpenclawData } from '../types.js';

/**
 * Derive a deterministic UUID from a namespace + source ID.
 * Same inputs always produce the same output, making migrations idempotent --
 * re-running the same export produces the same target UUIDs so
 * onConflictDoNothing correctly skips already-inserted rows.
 */
export function deriveUUID(companyId: string, sourceId: string): string {
  const hash = createHash('sha256').update(`${companyId}:${sourceId}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}

const VALID_PATTERN_TYPES = new Set([
  'event_match',
  'budget_threshold',
  'schedule_missed',
  'quality_failure',
  'agent_idle',
]);

const VALID_ACTION_TYPES = new Set(['wake_agent', 'create_issue', 'run_workflow']);

export function mapPatternType(value: string, ctx: MigrationContext, entityId: string): string {
  if (VALID_PATTERN_TYPES.has(value)) return value;
  if (value === 'event') return 'event_match';
  if (value === 'cron') {
    ctx.warnings.push({
      entityType: 'trigger',
      entityId,
      message:
        "OpenClaw 'cron' mapped to 'event_match' -- review this trigger's schedule config manually",
      severity: 'warning',
    });
    return 'event_match';
  }
  ctx.warnings.push({
    entityType: 'trigger',
    entityId,
    message: `Unknown patternType '${value}', defaulting to 'event_match'`,
    severity: 'warning',
  });
  return 'event_match';
}

export function mapActionType(value: string, ctx: MigrationContext, entityId: string): string {
  if (VALID_ACTION_TYPES.has(value)) return value;
  const mapping: Record<string, string> = {
    webhook: 'run_workflow',
    notify: 'wake_agent',
  };
  if (mapping[value]) return mapping[value];
  ctx.warnings.push({
    entityType: 'trigger',
    entityId,
    message: `Unknown actionType '${value}', defaulting to 'run_workflow'`,
    severity: 'warning',
  });
  return 'run_workflow';
}

export function parseOpenclawData(raw: unknown): OpenclawData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid OpenClaw export: expected a JSON object');
  }
  const data = raw as Record<string, unknown>;
  return {
    config: Array.isArray(data.config) ? data.config : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    skills: Array.isArray(data.skills) ? data.skills : [],
    triggers: Array.isArray(data.triggers) ? data.triggers : [],
    workflows: Array.isArray(data.workflows) ? data.workflows : [],
  };
}

export function transformOpenclaw(data: OpenclawData, ctx: MigrationContext) {
  const result: {
    skills: Record<string, unknown>[];
    triggers: Record<string, unknown>[];
    workflows: Record<string, unknown>[];
    runtimeStates: Record<string, unknown>[];
  } = { skills: [], triggers: [], workflows: [], runtimeStates: [] };

  // Transform sessions into runtime state
  for (const session of data.sessions) {
    if (!session.agentId) {
      ctx.warnings.push({
        entityType: 'session',
        entityId: session.id ?? 'unknown',
        message: 'Missing agentId for session, skipping',
        severity: 'warning',
      });
      continue;
    }
    const agentId = ctx.idMaps.agents.get(session.agentId) ?? session.agentId;
    result.runtimeStates.push({
      agentId,
      companyId: ctx.companyId,
      sessionId: session.id ?? randomUUID(),
      stateJson: session.state ?? {},
    });
    ctx.counts.sessions = (ctx.counts.sessions ?? 0) + 1;
  }

  // Transform skills
  for (const skill of data.skills) {
    if (!skill.name || !skill.content) {
      ctx.warnings.push({
        entityType: 'skill',
        entityId: skill.id ?? 'unknown',
        message: 'Missing skill name or content, skipping',
        severity: 'warning',
      });
      continue;
    }
    const newId = deriveUUID(ctx.companyId, `skill:${skill.id}`);
    ctx.idMaps.skills.set(skill.id, newId);
    const agentId = ctx.idMaps.agents.get(skill.agentId) ?? skill.agentId;
    result.skills.push({
      id: newId,
      companyId: ctx.companyId,
      proposedByAgentId: agentId,
      name: skill.name,
      description: skill.content.substring(0, 200),
      version: skill.version ?? 1,
      content: skill.content,
      triggerConditions: 'manual',
      exampleInvocations: [],
      status: 'active',
      usageCount: 0,
    });
    ctx.counts.skills = (ctx.counts.skills ?? 0) + 1;
  }

  // Transform triggers
  for (const trigger of data.triggers) {
    if (!trigger.name) {
      ctx.warnings.push({
        entityType: 'trigger',
        entityId: trigger.id ?? 'unknown',
        message: 'Missing trigger name, skipping',
        severity: 'warning',
      });
      continue;
    }
    const triggerId = trigger.id ?? 'unknown';
    result.triggers.push({
      id: deriveUUID(ctx.companyId, `trigger:${triggerId}`),
      companyId: ctx.companyId,
      name: trigger.name,
      patternType: mapPatternType(trigger.patternType ?? 'event', ctx, triggerId),
      patternConfig: trigger.patternConfig ?? {},
      actionType: mapActionType(trigger.actionType ?? 'webhook', ctx, triggerId),
      actionConfig: trigger.actionConfig ?? {},
      isActive: true,
    });
    ctx.counts.triggers = (ctx.counts.triggers ?? 0) + 1;
  }

  // Transform workflows
  for (const workflow of data.workflows) {
    if (!workflow.name) {
      ctx.warnings.push({
        entityType: 'workflow',
        entityId: workflow.id ?? 'unknown',
        message: 'Missing workflow name, skipping',
        severity: 'warning',
      });
      continue;
    }
    result.workflows.push({
      id: deriveUUID(ctx.companyId, `workflow:${workflow.id ?? 'unknown'}`),
      companyId: ctx.companyId,
      name: workflow.name,
      definition: workflow.definition ?? {},
      isActive: true,
    });
    ctx.counts.workflows = (ctx.counts.workflows ?? 0) + 1;
  }

  // Merge config entries into runtime states
  if (data.config.length > 0) {
    const configByAgent = new Map<string, Record<string, unknown>>();
    for (const cfg of data.config) {
      if (!cfg.agentId || !cfg.key) continue;
      const agentId = ctx.idMaps.agents.get(cfg.agentId) ?? cfg.agentId;
      const existing = configByAgent.get(agentId) ?? {};
      existing[cfg.key] = cfg.value;
      configByAgent.set(agentId, existing);
      ctx.counts.config = (ctx.counts.config ?? 0) + 1;
    }

    for (const [agentId, config] of configByAgent) {
      const existingState = result.runtimeStates.find((rs) => rs.agentId === agentId);
      if (existingState) {
        existingState.stateJson = {
          ...(existingState.stateJson as Record<string, unknown>),
          config,
        };
      } else {
        result.runtimeStates.push({
          agentId,
          companyId: ctx.companyId,
          sessionId: randomUUID(),
          stateJson: { config },
        });
      }
    }
  }

  return result;
}
