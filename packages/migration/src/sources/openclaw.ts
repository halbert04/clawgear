import { randomUUID } from 'node:crypto';
import type { MigrationContext, OpenclawData } from '../types.js';

export function parseOpenclawData(raw: unknown): OpenclawData {
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
    const newId = randomUUID();
    ctx.idMaps.skills.set(skill.id, newId);
    const agentId = ctx.idMaps.agents.get(skill.agentId) ?? skill.agentId;
    result.skills.push({
      id: newId,
      companyId: ctx.companyId,
      proposedByAgentId: agentId,
      name: skill.name,
      version: skill.version ?? 1,
      content: skill.content,
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
    result.triggers.push({
      id: randomUUID(),
      companyId: ctx.companyId,
      name: trigger.name,
      patternType: trigger.patternType ?? 'event',
      patternConfig: trigger.patternConfig ?? {},
      actionType: trigger.actionType ?? 'webhook',
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
      id: randomUUID(),
      companyId: ctx.companyId,
      name: workflow.name,
      definition: workflow.definition ?? {},
      isActive: true,
    });
    ctx.counts.workflows = (ctx.counts.workflows ?? 0) + 1;
  }

  return result;
}
