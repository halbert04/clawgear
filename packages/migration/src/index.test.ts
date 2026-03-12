import { describe, expect, it } from 'bun:test';
import { migrate } from './engine.js';
import { parseOpenclawData, transformOpenclaw } from './sources/openclaw.js';
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
