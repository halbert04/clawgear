import { describe, expect, mock, test } from 'bun:test';
import { InProcessEventBus } from '@clawgear/kernel';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';
import { qualityRoutes } from './quality.js';

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const RUBRIC_ID = '660e8400-e29b-41d4-a716-446655440002';
const AGENT_ID = '770e8400-e29b-41d4-a716-446655440003';
const EVAL_ID = '880e8400-e29b-41d4-a716-446655440004';
const RUN_ID = '990e8400-e29b-41d4-a716-446655440005';

const rubricRow = {
  id: RUBRIC_ID,
  companyId: COMPANY_ID,
  name: 'Code Quality',
  role: 'engineer',
  taskType: 'code_review',
  criteria: [
    { name: 'correctness', description: 'Is it correct?', weight: 0.5, passThreshold: 0.7 },
  ],
  judgeModel: 'claude-sonnet-4-20250514',
  judgePrompt: 'Evaluate this code.',
  minImprovementThreshold: 0.1,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const evaluationRow = {
  id: EVAL_ID,
  companyId: COMPANY_ID,
  rubricId: RUBRIC_ID,
  agentId: AGENT_ID,
  issueId: null,
  runId: RUN_ID,
  evaluatorType: 'judge',
  evaluatorAgentId: null,
  scores: [{ criterion: 'correctness', score: 0.9, feedback: 'Good' }],
  overallScore: 0.9,
  passed: true,
  feedback: 'Well done',
  revisionNumber: 1,
  createdAt: new Date('2026-01-01'),
};

function createMockApp(dbOverrides: Record<string, unknown> = {}) {
  const insertReturning = mock(() => [rubricRow]);
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  const selectLimit = mock(() => ({ offset: mock(() => [rubricRow]) }));
  const selectWhere = mock(() => {
    const result = [rubricRow] as unknown[];
    (result as unknown as Record<string, unknown>).limit = selectLimit;
    return result;
  });
  const selectFrom = mock(() => ({ where: selectWhere, limit: selectLimit }));

  const updateReturning = mock(() => [
    { ...rubricRow, name: 'Updated Rubric', updatedAt: new Date() },
  ]);
  const updateWhere = mock(() => ({ returning: updateReturning }));
  const updateSet = mock(() => ({ where: updateWhere }));
  const updateFn = mock(() => ({ set: updateSet }));

  const countSelectFrom = mock(() => ({ where: mock(() => [{ count: 1 }]) }));

  const db = {
    insert: insertFn,
    select: mock((...args: unknown[]) => {
      if (args.length > 0) return { from: countSelectFrom };
      return { from: selectFrom };
    }),
    update: updateFn,
    ...dbOverrides,
  };

  const eventBus = new InProcessEventBus();
  const emitSpy = mock(() => {});
  eventBus.emit = emitSpy;

  const hono = new Hono();
  hono.onError(errorHandler);
  hono.route(`/api/companies/:companyId/quality`, qualityRoutes({ db: db as never, eventBus }));

  return { app: hono, db, eventBus, emitSpy };
}

describe('Quality Routes', () => {
  // -------------------------------------------------------
  // RUBRICS
  // -------------------------------------------------------

  test('POST /rubrics creates a rubric', async () => {
    const { app, emitSpy } = createMockApp();

    const res = await app.request(`/api/companies/${COMPANY_ID}/quality/rubrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Code Quality',
        role: 'engineer',
        taskType: 'code_review',
        criteria: [
          { name: 'correctness', description: 'Is it correct?', weight: 0.5, passThreshold: 0.7 },
        ],
        judgePrompt: 'Evaluate this code.',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Code Quality');
    expect(body.id).toBe(RUBRIC_ID);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'quality.rubric_created' }),
    );
  });

  test('POST /rubrics returns 400 on invalid data', async () => {
    const { app } = createMockApp();

    const res = await app.request(`/api/companies/${COMPANY_ID}/quality/rubrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation Error');
  });

  test('GET /rubrics returns paginated list', async () => {
    const { app } = createMockApp();

    const res = await app.request(`/api/companies/${COMPANY_ID}/quality/rubrics`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  test('GET /rubrics supports ?role= filter', async () => {
    const { app } = createMockApp();

    const res = await app.request(`/api/companies/${COMPANY_ID}/quality/rubrics?role=engineer`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
  });

  test('GET /rubrics/:id returns rubric detail', async () => {
    const { app } = createMockApp();

    const res = await app.request(`/api/companies/${COMPANY_ID}/quality/rubrics/${RUBRIC_ID}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Code Quality');
  });

  test('GET /rubrics/:id returns 404 for missing rubric', async () => {
    const selectFrom = mock(() => ({
      where: mock(() => []),
      limit: mock(() => ({ offset: mock(() => []) })),
    }));
    const { app } = createMockApp({
      select: mock(() => ({ from: selectFrom })),
    });

    const res = await app.request(
      `/api/companies/${COMPANY_ID}/quality/rubrics/550e8400-e29b-41d4-a716-446655440099`,
    );

    expect(res.status).toBe(404);
  });

  test('PATCH /rubrics/:id updates rubric', async () => {
    const { app, emitSpy } = createMockApp();

    const res = await app.request(`/api/companies/${COMPANY_ID}/quality/rubrics/${RUBRIC_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Rubric' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Rubric');
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'quality.rubric_updated' }),
    );
  });

  // -------------------------------------------------------
  // EVALUATIONS
  // -------------------------------------------------------

  test('POST /evaluations creates an evaluation', async () => {
    const insertReturning = mock(() => [evaluationRow]);
    const insertValues = mock(() => ({ returning: insertReturning }));
    const insertFn = mock(() => ({ values: insertValues }));

    const { app, emitSpy } = createMockApp({ insert: insertFn });

    const res = await app.request(`/api/companies/${COMPANY_ID}/quality/evaluations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rubricId: RUBRIC_ID,
        agentId: AGENT_ID,
        heartbeatRunId: RUN_ID,
        evaluatorType: 'judge',
        scores: [{ criterion: 'correctness', score: 0.9, feedback: 'Good' }],
        overallScore: 0.9,
        passed: true,
        feedback: 'Well done',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(EVAL_ID);
    expect(body.overallScore).toBe(0.9);
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'quality.gate_passed' }));
  });

  test('POST /evaluations emits quality.gate_failed when not passed', async () => {
    const failedRow = { ...evaluationRow, passed: false, overallScore: 0.3 };
    const insertReturning = mock(() => [failedRow]);
    const insertValues = mock(() => ({ returning: insertReturning }));
    const insertFn = mock(() => ({ values: insertValues }));

    const { app, emitSpy } = createMockApp({ insert: insertFn });

    const res = await app.request(`/api/companies/${COMPANY_ID}/quality/evaluations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rubricId: RUBRIC_ID,
        agentId: AGENT_ID,
        heartbeatRunId: RUN_ID,
        evaluatorType: 'self',
        scores: [{ criterion: 'correctness', score: 0.3 }],
        overallScore: 0.3,
        passed: false,
        feedback: 'Needs improvement',
      }),
    });

    expect(res.status).toBe(201);
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'quality.gate_failed' }));
  });

  test('GET /evaluations returns paginated list', async () => {
    const selectLimit = mock(() => ({ offset: mock(() => [evaluationRow]) }));
    const selectWhere = mock(() => {
      const result = [evaluationRow] as unknown[];
      (result as unknown as Record<string, unknown>).limit = selectLimit;
      return result;
    });
    const selectFrom = mock(() => ({ where: selectWhere, limit: selectLimit }));
    const countSelectFrom = mock(() => ({ where: mock(() => [{ count: 1 }]) }));

    const { app } = createMockApp({
      select: mock((...args: unknown[]) => {
        if (args.length > 0) return { from: countSelectFrom };
        return { from: selectFrom };
      }),
    });

    const res = await app.request(`/api/companies/${COMPANY_ID}/quality/evaluations`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.total).toBe(1);
  });

  test('GET /evaluations/:id returns evaluation detail', async () => {
    const selectFrom = mock(() => ({
      where: mock(() => [evaluationRow]),
      limit: mock(() => ({ offset: mock(() => [evaluationRow]) })),
    }));

    const { app } = createMockApp({
      select: mock(() => ({ from: selectFrom })),
    });

    const res = await app.request(`/api/companies/${COMPANY_ID}/quality/evaluations/${EVAL_ID}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(EVAL_ID);
    expect(body.overallScore).toBe(0.9);
  });

  // -------------------------------------------------------
  // AGENT SUMMARY
  // -------------------------------------------------------

  test('GET /agents/:agentId/summary returns agent quality summary', async () => {
    const evals = [
      { ...evaluationRow, overallScore: 0.9, passed: true, evaluatorType: 'judge' },
      { ...evaluationRow, id: 'id-2', overallScore: 0.7, passed: true, evaluatorType: 'self' },
      { ...evaluationRow, id: 'id-3', overallScore: 0.4, passed: false, evaluatorType: 'judge' },
    ];

    const selectFrom = mock(() => ({
      where: mock(() => evals),
      limit: mock(() => ({ offset: mock(() => evals) })),
    }));

    const { app } = createMockApp({
      select: mock(() => ({ from: selectFrom })),
    });

    const res = await app.request(
      `/api/companies/${COMPANY_ID}/quality/agents/${AGENT_ID}/summary`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agentId).toBe(AGENT_ID);
    expect(body.totalEvaluations).toBe(3);
    // avg = (0.9 + 0.7 + 0.4) / 3 = 0.666...
    expect(body.avgOverallScore).toBeCloseTo(0.667, 2);
    // pass rate = 2/3 = 0.666...
    expect(body.passRate).toBeCloseTo(0.667, 2);
    expect(body.countByEvaluatorType).toEqual({ judge: 2, self: 1 });
    expect(body.trend).toBeArray();
    expect(body.trend.length).toBe(3);
  });

  test('GET /agents/:agentId/summary returns zeros when no evaluations', async () => {
    const selectFrom = mock(() => ({
      where: mock(() => []),
      limit: mock(() => ({ offset: mock(() => []) })),
    }));

    const { app } = createMockApp({
      select: mock(() => ({ from: selectFrom })),
    });

    const res = await app.request(
      `/api/companies/${COMPANY_ID}/quality/agents/${AGENT_ID}/summary`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalEvaluations).toBe(0);
    expect(body.avgOverallScore).toBe(0);
    expect(body.passRate).toBe(0);
    expect(body.countByEvaluatorType).toEqual({});
    expect(body.trend).toEqual([]);
  });
});
