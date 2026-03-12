import { randomUUID } from 'node:crypto';
import type { MigrationContext, OpenfangData } from '../types.js';

const VALID_ROLES = [
  'ceo',
  'cto',
  'engineer',
  'analyst',
  'researcher',
  'writer',
  'designer',
  'marketer',
  'support',
];
const VALID_FACT_TYPES = ['decision', 'entity', 'relationship', 'observation'];
const VALID_OUTCOMES = ['success', 'partial_success', 'failure'];

function mapRole(role: string): string {
  const normalized = role.toLowerCase().trim();
  if (VALID_ROLES.includes(normalized)) return normalized;
  return 'engineer';
}

function mapFactType(factType: string): string {
  const normalized = factType.toLowerCase().trim();
  if (VALID_FACT_TYPES.includes(normalized)) return normalized;
  return 'observation';
}

function mapOutcome(outcome: string): string {
  const normalized = outcome.toLowerCase().trim();
  if (VALID_OUTCOMES.includes(normalized)) return normalized;
  const outcomeMap: Record<string, string> = {
    pass: 'success',
    ok: 'success',
    partial: 'partial_success',
    mixed: 'partial_success',
    fail: 'failure',
    error: 'failure',
  };
  return outcomeMap[normalized] ?? 'partial_success';
}

export function parseOpenfangData(raw: unknown): OpenfangData {
  const data = raw as Record<string, unknown>;
  return {
    agents: Array.isArray(data.agents) ? data.agents : [],
    skills: Array.isArray(data.skills) ? data.skills : [],
    facts: Array.isArray(data.facts) ? data.facts : [],
    lessons: Array.isArray(data.lessons) ? data.lessons : [],
  };
}

export function transformOpenfang(data: OpenfangData, ctx: MigrationContext) {
  const result: {
    agents: Record<string, unknown>[];
    skills: Record<string, unknown>[];
    facts: Record<string, unknown>[];
    lessons: Record<string, unknown>[];
  } = { agents: [], skills: [], facts: [], lessons: [] };

  // Transform agents
  for (const agent of data.agents) {
    if (!agent.name) {
      ctx.errors.push({
        entityType: 'agent',
        entityId: agent.id ?? 'unknown',
        message: 'Missing agent name',
        severity: 'error',
      });
      continue;
    }
    const newId = randomUUID();
    ctx.idMaps.agents.set(agent.id, newId);
    result.agents.push({
      id: newId,
      companyId: ctx.companyId,
      name: agent.name,
      role: mapRole(agent.role ?? 'engineer'),
      title: null,
      status: 'idle',
      adapterType: 'claude_code',
      adapterConfig: agent.config ?? {},
      modelTier: 'smart',
      systemPrompt: null,
      budgetMonthlyCents: 0n,
      spentMonthlyCents: 0n,
    });
    ctx.counts.agents = (ctx.counts.agents ?? 0) + 1;
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
    const agentId = ctx.idMaps.agents.get(skill.agentId);
    if (!agentId) {
      ctx.warnings.push({
        entityType: 'skill',
        entityId: skill.id,
        message: `Agent ${skill.agentId} not found for skill, using first available`,
        severity: 'warning',
      });
    }
    result.skills.push({
      id: newId,
      companyId: ctx.companyId,
      proposedByAgentId: agentId ?? Array.from(ctx.idMaps.agents.values())[0] ?? null,
      name: skill.name,
      version: skill.version ?? 1,
      content: skill.content,
      status: 'active',
      usageCount: 0,
    });
    ctx.counts.skills = (ctx.counts.skills ?? 0) + 1;
  }

  // Transform facts
  for (const fact of data.facts) {
    if (!fact.subject || !fact.predicate || !fact.object) {
      ctx.warnings.push({
        entityType: 'fact',
        entityId: fact.id ?? 'unknown',
        message: 'Incomplete fact (missing SPO), skipping',
        severity: 'warning',
      });
      continue;
    }
    const agentId = ctx.idMaps.agents.get(fact.agentId);
    result.facts.push({
      id: randomUUID(),
      companyId: ctx.companyId,
      agentId: agentId ?? Array.from(ctx.idMaps.agents.values())[0] ?? null,
      factType: mapFactType(fact.factType ?? 'observation'),
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      confidence: Math.max(0, Math.min(1, fact.confidence ?? 0.5)),
    });
    ctx.counts.facts = (ctx.counts.facts ?? 0) + 1;
  }

  // Transform lessons
  for (const lesson of data.lessons) {
    if (!lesson.lesson) {
      ctx.warnings.push({
        entityType: 'lesson',
        entityId: lesson.id ?? 'unknown',
        message: 'Empty lesson, skipping',
        severity: 'warning',
      });
      continue;
    }
    const agentId = ctx.idMaps.agents.get(lesson.agentId);
    result.lessons.push({
      id: randomUUID(),
      companyId: ctx.companyId,
      agentId: agentId ?? Array.from(ctx.idMaps.agents.values())[0] ?? null,
      taskType: lesson.taskType ?? 'general',
      approach: lesson.approach ?? '',
      lesson: lesson.lesson,
      outcome: mapOutcome(lesson.outcome ?? 'partial_success'),
      confidence: Math.max(0, Math.min(1, lesson.confidence ?? 0.5)),
    });
    ctx.counts.lessons = (ctx.counts.lessons ?? 0) + 1;
  }

  return result;
}
