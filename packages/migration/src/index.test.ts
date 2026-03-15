import { describe, expect, it } from 'bun:test';
import type { TransformResult } from './engine.js';
import { migrate, persist } from './engine.js';
import {
  deriveUUID,
  mapActionType,
  mapPatternType,
  parseOpenclawData,
  transformOpenclaw,
} from './sources/openclaw.js';
import { parseOpenfangData, transformOpenfang } from './sources/openfang.js';
import { parsePaperclipData, transformPaperclip } from './sources/paperclip.js';
import type { MigrationContext } from './types.js';

function createTestContext(source: 'paperclip' | 'openfang' | 'openclaw'): MigrationContext {
  return {
    companyId: 'test-company-id',
    source,
    dryRun: true,
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

// ---------------------------------------------------------------------------
// Paperclip source tests
// ---------------------------------------------------------------------------
describe('Paperclip', () => {
  it('should parse paperclip data from raw object', () => {
    const raw = {
      companies: [{ id: 'c1', name: 'Acme' }],
      agents: [{ id: 'a1', companyId: 'c1', name: 'Bot', role: 'engineer' }],
      goals: [],
      projects: [],
      issues: [{ id: 'i1', companyId: 'c1', title: 'Fix bug' }],
    };
    const data = parsePaperclipData(raw);
    expect(data.companies).toHaveLength(1);
    expect(data.agents).toHaveLength(1);
    expect(data.issues).toHaveLength(1);
  });

  it('should handle missing arrays gracefully', () => {
    const data = parsePaperclipData({});
    expect(data.companies).toHaveLength(0);
    expect(data.agents).toHaveLength(0);
    expect(data.issues).toHaveLength(0);
  });

  it('should transform companies with ID mapping', () => {
    const ctx = createTestContext('paperclip');
    const data = parsePaperclipData({
      companies: [{ id: 'old-c1', name: 'Acme Corp', issuePrefix: 'ACM' }],
      agents: [],
      goals: [],
      projects: [],
      issues: [],
    });
    const result = transformPaperclip(data, ctx);
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0]!.name).toBe('Acme Corp');
    expect(result.companies[0]!.issuePrefix).toBe('ACM');
    expect(ctx.idMaps.companies.has('old-c1')).toBe(true);
    expect(ctx.counts.companies).toBe(1);
  });

  it('should map agent roles to valid ClawGear roles', () => {
    const ctx = createTestContext('paperclip');
    const data = parsePaperclipData({
      companies: [],
      agents: [
        { id: 'a1', companyId: 'c1', name: 'Dev', role: 'developer' },
        { id: 'a2', companyId: 'c1', name: 'QA', role: 'tester' },
        { id: 'a3', companyId: 'c1', name: 'PM', role: 'pm' },
        { id: 'a4', companyId: 'c1', name: 'Lead', role: 'cto' },
      ],
      goals: [],
      projects: [],
      issues: [],
    });
    const result = transformPaperclip(data, ctx);
    expect(result.agents[0]!.role).toBe('engineer');
    expect(result.agents[1]!.role).toBe('analyst');
    expect(result.agents[2]!.role).toBe('analyst');
    expect(result.agents[3]!.role).toBe('cto');
  });

  it('should map issue statuses to valid ClawGear statuses', () => {
    const ctx = createTestContext('paperclip');
    const data = parsePaperclipData({
      companies: [],
      agents: [],
      goals: [],
      projects: [],
      issues: [
        { id: 'i1', companyId: 'c1', title: 'A', status: 'open' },
        { id: 'i2', companyId: 'c1', title: 'B', status: 'closed' },
        { id: 'i3', companyId: 'c1', title: 'C', status: 'review' },
        { id: 'i4', companyId: 'c1', title: 'D', status: 'wontfix' },
      ],
    });
    const result = transformPaperclip(data, ctx);
    expect(result.issues[0]!.status).toBe('todo');
    expect(result.issues[1]!.status).toBe('done');
    expect(result.issues[2]!.status).toBe('in_review');
    expect(result.issues[3]!.status).toBe('cancelled');
  });

  it('should map priorities', () => {
    const ctx = createTestContext('paperclip');
    const data = parsePaperclipData({
      companies: [],
      agents: [],
      goals: [],
      projects: [],
      issues: [
        { id: 'i1', companyId: 'c1', title: 'A', priority: 'p0' },
        { id: 'i2', companyId: 'c1', title: 'B', priority: 'normal' },
        { id: 'i3', companyId: 'c1', title: 'C', priority: 'blocker' },
      ],
    });
    const result = transformPaperclip(data, ctx);
    expect(result.issues[0]!.priority).toBe('critical');
    expect(result.issues[1]!.priority).toBe('medium');
    expect(result.issues[2]!.priority).toBe('critical');
  });

  it('should assign sequential issue numbers', () => {
    const ctx = createTestContext('paperclip');
    const data = parsePaperclipData({
      companies: [],
      agents: [],
      goals: [],
      projects: [],
      issues: [
        { id: 'i1', companyId: 'c1', title: 'First' },
        { id: 'i2', companyId: 'c1', title: 'Second' },
        { id: 'i3', companyId: 'c1', title: 'Third' },
      ],
    });
    const result = transformPaperclip(data, ctx);
    expect(result.issues[0]!.issueNumber).toBe(1);
    expect(result.issues[1]!.issueNumber).toBe(2);
    expect(result.issues[2]!.issueNumber).toBe(3);
  });

  it('should error on missing company name', () => {
    const ctx = createTestContext('paperclip');
    const data = parsePaperclipData({
      companies: [{ id: 'c1' }],
      agents: [],
      goals: [],
      projects: [],
      issues: [],
    });
    transformPaperclip(data, ctx);
    expect(ctx.errors).toHaveLength(1);
    expect(ctx.errors[0]!.entityType).toBe('company');
  });

  it('should error on missing agent name', () => {
    const ctx = createTestContext('paperclip');
    const data = parsePaperclipData({
      companies: [],
      agents: [{ id: 'a1', companyId: 'c1', role: 'engineer' }],
      goals: [],
      projects: [],
      issues: [],
    });
    transformPaperclip(data, ctx);
    expect(ctx.errors).toHaveLength(1);
    expect(ctx.errors[0]!.entityType).toBe('agent');
  });

  it('should resolve cross-entity references via ID maps', () => {
    const ctx = createTestContext('paperclip');
    const data = parsePaperclipData({
      companies: [{ id: 'c1', name: 'Acme' }],
      agents: [{ id: 'a1', companyId: 'c1', name: 'Bot', role: 'engineer' }],
      goals: [{ id: 'g1', companyId: 'c1', title: 'Ship v1' }],
      projects: [{ id: 'p1', companyId: 'c1', goalId: 'g1', name: 'Alpha' }],
      issues: [
        {
          id: 'i1',
          companyId: 'c1',
          projectId: 'p1',
          goalId: 'g1',
          title: 'Task',
          assigneeId: 'a1',
        },
      ],
    });
    const result = transformPaperclip(data, ctx);

    const issue = result.issues[0]!;
    expect(issue.projectId).toBe(ctx.idMaps.projects.get('p1'));
    expect(issue.goalId).toBe(ctx.idMaps.goals.get('g1'));
    expect(issue.assigneeAgentId).toBe(ctx.idMaps.agents.get('a1'));
  });
});

// ---------------------------------------------------------------------------
// Openfang source tests
// ---------------------------------------------------------------------------
describe('Openfang', () => {
  it('should parse openfang data from raw object', () => {
    const raw = {
      agents: [{ id: 'a1', name: 'Bot', role: 'engineer' }],
      skills: [{ id: 's1', agentId: 'a1', name: 'skill1', content: 'code' }],
      facts: [],
      lessons: [],
    };
    const data = parseOpenfangData(raw);
    expect(data.agents).toHaveLength(1);
    expect(data.skills).toHaveLength(1);
  });

  it('should transform agents with role mapping', () => {
    const ctx = createTestContext('openfang');
    const data = parseOpenfangData({
      agents: [{ id: 'a1', name: 'Worker', role: 'dev' }],
      skills: [],
      facts: [],
      lessons: [],
    });
    const result = transformOpenfang(data, ctx);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.role).toBe('engineer');
    expect(result.agents[0]!.companyId).toBe('test-company-id');
  });

  it('should transform skills with agent reference', () => {
    const ctx = createTestContext('openfang');
    const data = parseOpenfangData({
      agents: [{ id: 'a1', name: 'Bot', role: 'engineer' }],
      skills: [{ id: 's1', agentId: 'a1', name: 'debug', content: 'debug skill content' }],
      facts: [],
      lessons: [],
    });
    const result = transformOpenfang(data, ctx);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.name).toBe('debug');
    expect(result.skills[0]!.proposedByAgentId).toBe(ctx.idMaps.agents.get('a1'));
  });

  it('should transform facts with confidence clamping', () => {
    const ctx = createTestContext('openfang');
    const data = parseOpenfangData({
      agents: [{ id: 'a1', name: 'Bot', role: 'engineer' }],
      skills: [],
      facts: [
        {
          id: 'f1',
          agentId: 'a1',
          factType: 'decision',
          subject: 'S',
          predicate: 'P',
          object: 'O',
          confidence: 1.5,
        },
        {
          id: 'f2',
          agentId: 'a1',
          factType: 'entity',
          subject: 'S',
          predicate: 'P',
          object: 'O',
          confidence: -0.5,
        },
      ],
      lessons: [],
    });
    const result = transformOpenfang(data, ctx);
    expect(result.facts).toHaveLength(2);
    expect(result.facts[0]!.confidence).toBe(1);
    expect(result.facts[1]!.confidence).toBe(0);
  });

  it('should transform lessons with outcome mapping', () => {
    const ctx = createTestContext('openfang');
    const data = parseOpenfangData({
      agents: [{ id: 'a1', name: 'Bot', role: 'engineer' }],
      skills: [],
      facts: [],
      lessons: [
        {
          id: 'l1',
          agentId: 'a1',
          taskType: 'coding',
          approach: 'TDD',
          lesson: 'Write tests first',
          outcome: 'pass',
        },
        {
          id: 'l2',
          agentId: 'a1',
          taskType: 'review',
          approach: 'manual',
          lesson: 'Check edge cases',
          outcome: 'fail',
        },
      ],
    });
    const result = transformOpenfang(data, ctx);
    expect(result.lessons).toHaveLength(2);
    expect(result.lessons[0]!.outcome).toBe('success');
    expect(result.lessons[1]!.outcome).toBe('failure');
  });

  it('should skip incomplete facts with warnings', () => {
    const ctx = createTestContext('openfang');
    const data = parseOpenfangData({
      agents: [],
      skills: [],
      facts: [{ id: 'f1', agentId: 'a1', factType: 'decision', subject: 'S' }],
      lessons: [],
    });
    transformOpenfang(data, ctx);
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.message).toContain('Incomplete fact');
  });
});

// ---------------------------------------------------------------------------
// Openclaw source tests
// ---------------------------------------------------------------------------
describe('Openclaw', () => {
  it('should parse openclaw data from raw object', () => {
    const raw = {
      config: [{ id: 'cfg1', agentId: 'a1', key: 'theme', value: 'dark' }],
      sessions: [{ id: 's1', agentId: 'a1', state: { active: true } }],
      skills: [],
      triggers: [
        {
          id: 't1',
          name: 'on-push',
          patternType: 'event',
          patternConfig: {},
          actionType: 'webhook',
          actionConfig: {},
        },
      ],
      workflows: [{ id: 'w1', name: 'deploy', definition: {} }],
    };
    const data = parseOpenclawData(raw);
    expect(data.config).toHaveLength(1);
    expect(data.sessions).toHaveLength(1);
    expect(data.triggers).toHaveLength(1);
    expect(data.workflows).toHaveLength(1);
  });

  it('should transform sessions to runtime states', () => {
    const ctx = createTestContext('openclaw');
    const data = parseOpenclawData({
      config: [],
      sessions: [{ id: 's1', agentId: 'agent-1', state: { mode: 'active' } }],
      skills: [],
      triggers: [],
      workflows: [],
    });
    const result = transformOpenclaw(data, ctx);
    expect(result.runtimeStates).toHaveLength(1);
    expect(result.runtimeStates[0]!.companyId).toBe('test-company-id');
    expect(ctx.counts.sessions).toBe(1);
  });

  it('should transform triggers', () => {
    const ctx = createTestContext('openclaw');
    const data = parseOpenclawData({
      config: [],
      sessions: [],
      skills: [],
      triggers: [
        {
          id: 't1',
          name: 'deploy-trigger',
          patternType: 'cron',
          patternConfig: { cron: '0 * * * *' },
          actionType: 'webhook',
          actionConfig: { url: 'https://example.com' },
        },
      ],
      workflows: [],
    });
    const result = transformOpenclaw(data, ctx);
    expect(result.triggers).toHaveLength(1);
    expect(result.triggers[0]!.name).toBe('deploy-trigger');
    expect(result.triggers[0]!.isActive).toBe(true);
  });

  it('should transform workflows', () => {
    const ctx = createTestContext('openclaw');
    const data = parseOpenclawData({
      config: [],
      sessions: [],
      skills: [],
      triggers: [],
      workflows: [{ id: 'w1', name: 'CI Pipeline', definition: { steps: [] } }],
    });
    const result = transformOpenclaw(data, ctx);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0]!.name).toBe('CI Pipeline');
    expect(ctx.counts.workflows).toBe(1);
  });

  it('should skip sessions without agentId', () => {
    const ctx = createTestContext('openclaw');
    const data = parseOpenclawData({
      config: [],
      sessions: [{ id: 's1', state: {} }],
      skills: [],
      triggers: [],
      workflows: [],
    });
    transformOpenclaw(data, ctx);
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.message).toContain('agentId');
  });
});

// ---------------------------------------------------------------------------
// Migration engine tests
// ---------------------------------------------------------------------------
describe('MigrationEngine', () => {
  it('should run paperclip migration with dry-run', () => {
    const { report } = migrate({
      source: 'paperclip',
      companyId: 'company-1',
      data: {
        companies: [{ id: 'c1', name: 'Acme' }],
        agents: [{ id: 'a1', companyId: 'c1', name: 'Bot', role: 'engineer' }],
        goals: [],
        projects: [],
        issues: [{ id: 'i1', companyId: 'c1', title: 'Fix bug' }],
      },
      dryRun: true,
    });

    expect(report.status).toBe('success');
    expect(report.dryRun).toBe(true);
    expect(report.counts.companies).toBe(1);
    expect(report.counts.agents).toBe(1);
    expect(report.counts.issues).toBe(1);
    expect(Object.keys(report.idMappings.companies!)).toHaveLength(1);
    expect(Object.keys(report.idMappings.agents!)).toHaveLength(1);
    expect(Object.keys(report.idMappings.issues!)).toHaveLength(1);
  });

  it('should run openfang migration', () => {
    const { report } = migrate({
      source: 'openfang',
      companyId: 'company-1',
      data: {
        agents: [{ id: 'a1', name: 'Worker', role: 'engineer' }],
        skills: [{ id: 's1', agentId: 'a1', name: 'debug', content: 'code' }],
        facts: [
          {
            id: 'f1',
            agentId: 'a1',
            factType: 'decision',
            subject: 'S',
            predicate: 'P',
            object: 'O',
          },
        ],
        lessons: [
          { id: 'l1', agentId: 'a1', taskType: 'coding', lesson: 'test first', outcome: 'success' },
        ],
      },
      dryRun: true,
    });

    expect(report.status).toBe('success');
    expect(report.counts.agents).toBe(1);
    expect(report.counts.skills).toBe(1);
    expect(report.counts.facts).toBe(1);
    expect(report.counts.lessons).toBe(1);
  });

  it('should run openclaw migration', () => {
    const { report } = migrate({
      source: 'openclaw',
      companyId: 'company-1',
      data: {
        config: [],
        sessions: [{ id: 's1', agentId: 'a1', state: {} }],
        skills: [{ id: 'sk1', agentId: 'a1', name: 'skill1', content: 'code' }],
        triggers: [
          {
            id: 't1',
            name: 'trigger1',
            patternType: 'event',
            patternConfig: {},
            actionType: 'webhook',
            actionConfig: {},
          },
        ],
        workflows: [{ id: 'w1', name: 'workflow1', definition: {} }],
      },
      dryRun: true,
    });

    expect(report.status).toBe('success');
    expect(report.counts.sessions).toBe(1);
    expect(report.counts.skills).toBe(1);
    expect(report.counts.triggers).toBe(1);
    expect(report.counts.workflows).toBe(1);
  });

  it('should report partial status on errors with some successes', () => {
    const { report } = migrate({
      source: 'paperclip',
      companyId: 'company-1',
      data: {
        companies: [{ id: 'c1' }, { id: 'c2', name: 'Good Company' }],
        agents: [],
        goals: [],
        projects: [],
        issues: [],
      },
      dryRun: true,
    });

    expect(report.status).toBe('partial');
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.counts.companies).toBe(1);
  });

  it('should report failed status when all entities error', () => {
    const { report } = migrate({
      source: 'paperclip',
      companyId: 'company-1',
      data: {
        companies: [{ id: 'c1' }],
        agents: [],
        goals: [],
        projects: [],
        issues: [],
      },
      dryRun: true,
    });

    expect(report.status).toBe('failed');
    expect(report.errors).toHaveLength(1);
  });

  it('should handle empty data gracefully', () => {
    const { report } = migrate({
      source: 'paperclip',
      companyId: 'company-1',
      data: {},
      dryRun: true,
    });

    expect(report.status).toBe('success');
    expect(report.errors).toHaveLength(0);
  });

  it('should return transformed data for inspection', () => {
    const { transformed } = migrate({
      source: 'paperclip',
      companyId: 'company-1',
      data: {
        companies: [{ id: 'c1', name: 'Test' }],
        agents: [],
        goals: [],
        projects: [],
        issues: [],
      },
      dryRun: true,
    });

    expect(transformed.companies).toHaveLength(1);
    expect(transformed.companies![0]!.name).toBe('Test');
  });
});

// ---------------------------------------------------------------------------
// Openclaw enum mapping tests
// ---------------------------------------------------------------------------
describe('Openclaw enum mapping', () => {
  it("should map 'event' patternType to 'event_match'", () => {
    const ctx = createTestContext('openclaw');
    expect(mapPatternType('event', ctx, 't1')).toBe('event_match');
  });

  it("should map 'cron' patternType to 'event_match' with warning", () => {
    const ctx = createTestContext('openclaw');
    expect(mapPatternType('cron', ctx, 't1')).toBe('event_match');
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.message).toContain('cron');
  });

  it("should map 'webhook' actionType to 'run_workflow'", () => {
    const ctx = createTestContext('openclaw');
    expect(mapActionType('webhook', ctx, 't1')).toBe('run_workflow');
  });

  it("should map 'notify' actionType to 'wake_agent'", () => {
    const ctx = createTestContext('openclaw');
    expect(mapActionType('notify', ctx, 't1')).toBe('wake_agent');
  });

  it('should pass through valid patternType values unchanged', () => {
    const ctx = createTestContext('openclaw');
    expect(mapPatternType('event_match', ctx, 't1')).toBe('event_match');
    expect(mapPatternType('budget_threshold', ctx, 't1')).toBe('budget_threshold');
    expect(mapPatternType('schedule_missed', ctx, 't1')).toBe('schedule_missed');
    expect(mapPatternType('quality_failure', ctx, 't1')).toBe('quality_failure');
    expect(mapPatternType('agent_idle', ctx, 't1')).toBe('agent_idle');
    expect(ctx.warnings).toHaveLength(0);
  });

  it('should pass through valid actionType values unchanged', () => {
    const ctx = createTestContext('openclaw');
    expect(mapActionType('wake_agent', ctx, 't1')).toBe('wake_agent');
    expect(mapActionType('create_issue', ctx, 't1')).toBe('create_issue');
    expect(mapActionType('run_workflow', ctx, 't1')).toBe('run_workflow');
    expect(ctx.warnings).toHaveLength(0);
  });

  it('should warn and default on unknown patternType', () => {
    const ctx = createTestContext('openclaw');
    expect(mapPatternType('garbage', ctx, 't1')).toBe('event_match');
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.message).toContain('Unknown patternType');
  });

  it('should warn and default on unknown actionType', () => {
    const ctx = createTestContext('openclaw');
    expect(mapActionType('garbage', ctx, 't1')).toBe('run_workflow');
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]!.message).toContain('Unknown actionType');
  });

  it('should apply enum mapping in full transform', () => {
    const ctx = createTestContext('openclaw');
    const data = parseOpenclawData({
      config: [],
      sessions: [],
      skills: [],
      triggers: [
        {
          id: 't1',
          name: 'trigger1',
          patternType: 'event',
          patternConfig: {},
          actionType: 'webhook',
          actionConfig: {},
        },
        {
          id: 't2',
          name: 'trigger2',
          patternType: 'cron',
          patternConfig: {},
          actionType: 'notify',
          actionConfig: {},
        },
      ],
      workflows: [],
    });
    const result = transformOpenclaw(data, ctx);
    expect(result.triggers[0]!.patternType).toBe('event_match');
    expect(result.triggers[0]!.actionType).toBe('run_workflow');
    expect(result.triggers[1]!.patternType).toBe('event_match');
    expect(result.triggers[1]!.actionType).toBe('wake_agent');
  });

  it('should add required fields to skills', () => {
    const ctx = createTestContext('openclaw');
    const data = parseOpenclawData({
      config: [],
      sessions: [],
      skills: [{ id: 's1', agentId: 'a1', name: 'skill1', content: 'Some skill content here' }],
      triggers: [],
      workflows: [],
    });
    const result = transformOpenclaw(data, ctx);
    expect(result.skills[0]!.description).toBe('Some skill content here');
    expect(result.skills[0]!.triggerConditions).toBe('manual');
    expect(result.skills[0]!.exampleInvocations).toEqual([]);
  });

  it('should truncate long content to 200 chars for description', () => {
    const ctx = createTestContext('openclaw');
    const longContent = 'x'.repeat(500);
    const data = parseOpenclawData({
      config: [],
      sessions: [],
      skills: [{ id: 's1', agentId: 'a1', name: 'skill1', content: longContent }],
      triggers: [],
      workflows: [],
    });
    const result = transformOpenclaw(data, ctx);
    expect((result.skills[0]!.description as string).length).toBe(200);
  });

  it('should merge config entries into existing runtime state', () => {
    const ctx = createTestContext('openclaw');
    const data = parseOpenclawData({
      config: [
        { id: 'cfg1', agentId: 'a1', key: 'theme', value: 'dark' },
        { id: 'cfg2', agentId: 'a1', key: 'lang', value: 'en' },
      ],
      sessions: [{ id: 's1', agentId: 'a1', state: { active: true } }],
      skills: [],
      triggers: [],
      workflows: [],
    });
    const result = transformOpenclaw(data, ctx);
    expect(result.runtimeStates).toHaveLength(1);
    const state = result.runtimeStates[0]!.stateJson as Record<string, unknown>;
    expect(state.active).toBe(true);
    expect((state.config as Record<string, unknown>).theme).toBe('dark');
    expect((state.config as Record<string, unknown>).lang).toBe('en');
  });

  it('should create new runtime state for config-only agents', () => {
    const ctx = createTestContext('openclaw');
    const data = parseOpenclawData({
      config: [{ id: 'cfg1', agentId: 'a2', key: 'theme', value: 'light' }],
      sessions: [{ id: 's1', agentId: 'a1', state: { active: true } }],
      skills: [],
      triggers: [],
      workflows: [],
    });
    const result = transformOpenclaw(data, ctx);
    expect(result.runtimeStates).toHaveLength(2);
    const configOnlyState = result.runtimeStates.find((rs) => rs.agentId === 'a2');
    expect(configOnlyState).toBeDefined();
    const stateJson = configOnlyState!.stateJson as Record<string, unknown>;
    expect((stateJson.config as Record<string, unknown>).theme).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// Deterministic UUID and idempotency tests
// ---------------------------------------------------------------------------
describe('Openclaw deterministic UUIDs', () => {
  it('should produce the same UUIDs for the same input across multiple runs', () => {
    const input = {
      config: [],
      sessions: [{ id: 's1', agentId: 'a1', state: {} }],
      skills: [{ id: 'sk1', agentId: 'a1', name: 'skill1', content: 'code' }],
      triggers: [
        {
          id: 't1',
          name: 'trigger1',
          patternType: 'event_match',
          patternConfig: {},
          actionType: 'run_workflow',
          actionConfig: {},
        },
      ],
      workflows: [{ id: 'w1', name: 'workflow1', definition: {} }],
    };

    const ctx1 = createTestContext('openclaw');
    const result1 = transformOpenclaw(parseOpenclawData(input), ctx1);

    const ctx2 = createTestContext('openclaw');
    const result2 = transformOpenclaw(parseOpenclawData(input), ctx2);

    expect(result1.triggers[0]!.id).toBe(result2.triggers[0]!.id);
    expect(result1.workflows[0]!.id).toBe(result2.workflows[0]!.id);
    expect(result1.skills[0]!.id).toBe(result2.skills[0]!.id);
  });

  it('should produce different UUIDs for different companies', () => {
    const input = parseOpenclawData({
      config: [],
      sessions: [],
      skills: [],
      triggers: [
        {
          id: 't1',
          name: 'trigger1',
          patternType: 'event_match',
          patternConfig: {},
          actionType: 'run_workflow',
          actionConfig: {},
        },
      ],
      workflows: [],
    });

    const ctx1 = createTestContext('openclaw');
    ctx1.companyId = 'company-a';
    const result1 = transformOpenclaw(input, ctx1);

    const ctx2 = createTestContext('openclaw');
    ctx2.companyId = 'company-b';
    const result2 = transformOpenclaw(input, ctx2);

    expect(result1.triggers[0]!.id).not.toBe(result2.triggers[0]!.id);
  });

  it('deriveUUID should produce valid UUID format', () => {
    const id = deriveUUID('company-1', 'trigger:t1');
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(uuidRe.test(id)).toBe(true);
  });

  it('should reject non-object input in parseOpenclawData', () => {
    expect(() => parseOpenclawData(null)).toThrow('expected a JSON object');
    expect(() => parseOpenclawData('string')).toThrow('expected a JSON object');
    expect(() => parseOpenclawData([1, 2, 3])).toThrow('expected a JSON object');
  });
});

// ---------------------------------------------------------------------------
// Persist function tests
// ---------------------------------------------------------------------------
describe('persist', () => {
  function createMockDb(options: { companyExists?: boolean; agentIds?: string[] }) {
    const { companyExists = true, agentIds = [] } = options;
    const insertedEntities: { table: string; values: Record<string, unknown> }[] = [];

    // Track select call order: 1st = company check, 2nd = agent load, rest = verify counts
    let selectCallCount = 0;

    const db = {
      select: () => {
        const callIndex = ++selectCallCount;
        return {
          from: () => ({
            where: () => {
              if (callIndex === 1) {
                // Company exists check
                return companyExists ? [{ id: 'comp-1' }] : [];
              }
              if (callIndex === 2) {
                // Agent IDs load
                return agentIds.map((id) => ({ id }));
              }
              // Verification counts
              return [{ count: 5 }];
            },
          }),
        };
      },
      insert: () => ({
        values: (vals: Record<string, unknown>) => {
          insertedEntities.push({ table: 'entity', values: vals });
          return {
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve([{ id: vals.id ?? 'generated' }]),
            }),
            onConflictDoUpdate: () => Promise.resolve(),
          };
        },
      }),
      _insertedEntities: insertedEntities,
    };

    return db;
  }

  it('should return error if company not found', async () => {
    const db = createMockDb({ companyExists: false });
    const result = await persist(
      db as never,
      { triggers: [], workflows: [], skills: [], runtimeStates: [] },
      'missing-company',
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('not found');
    expect(result.inserted).toEqual({});
  });

  it('should insert triggers and workflows', async () => {
    const db = createMockDb({ companyExists: true, agentIds: [] });
    const transformed: TransformResult = {
      triggers: [
        {
          id: 't1',
          companyId: 'c1',
          name: 'trig',
          patternType: 'event_match',
          patternConfig: {},
          actionType: 'run_workflow',
          actionConfig: {},
          isActive: true,
        },
      ],
      workflows: [{ id: 'w1', companyId: 'c1', name: 'wf', definition: {}, isActive: true }],
      skills: [],
      runtimeStates: [],
    };
    const result = await persist(db as never, transformed, 'c1');
    expect(result.inserted.triggers).toBe(1);
    expect(result.inserted.workflows).toBe(1);
  });

  it('should skip skills when agent does not exist', async () => {
    const db = createMockDb({ companyExists: true, agentIds: ['agent-1'] });
    const transformed: TransformResult = {
      triggers: [],
      workflows: [],
      skills: [
        {
          id: 's1',
          companyId: 'c1',
          proposedByAgentId: 'non-existent-agent',
          name: 'sk',
          description: 'desc',
          version: 1,
          content: 'code',
          triggerConditions: 'manual',
          exampleInvocations: [],
          status: 'active',
          usageCount: 0,
        },
      ],
      runtimeStates: [],
    };
    const result = await persist(db as never, transformed, 'c1');
    expect(result.skipped.skills).toBe(1);
    expect(result.inserted.skills).toBeUndefined();
  });

  it('should upsert runtime state for valid agents', async () => {
    const db = createMockDb({ companyExists: true, agentIds: ['agent-1'] });
    const transformed: TransformResult = {
      triggers: [],
      workflows: [],
      skills: [],
      runtimeStates: [
        { agentId: 'agent-1', companyId: 'c1', sessionId: 'sess-1', stateJson: { active: true } },
      ],
    };
    const result = await persist(db as never, transformed, 'c1');
    expect(result.inserted.runtimeStates).toBe(1);
  });

  it('should call onProgress callback', async () => {
    const db = createMockDb({ companyExists: true, agentIds: [] });
    const progressCalls: string[] = [];
    const transformed: TransformResult = {
      triggers: [
        {
          id: 't1',
          companyId: 'c1',
          name: 'trig',
          patternType: 'event_match',
          patternConfig: {},
          actionType: 'run_workflow',
          actionConfig: {},
          isActive: true,
        },
      ],
      workflows: [],
      skills: [],
      runtimeStates: [],
    };
    await persist(db as never, transformed, 'c1', {
      onProgress: (phase, entity, current, total) => {
        progressCalls.push(`${phase}:${entity}:${current}/${total}`);
      },
    });
    expect(progressCalls).toContain('write:triggers:1/1');
  });
});
