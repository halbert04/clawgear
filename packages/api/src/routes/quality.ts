import { qualityEvaluations, qualityRubrics } from '@clawgear/db/pg';
import type { InProcessEventBus } from '@clawgear/kernel';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import { createRubricSchema, paginationSchema, uuidSchema } from '@clawgear/shared/validators';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

const createEvaluationSchema = z.object({
  rubricId: uuidSchema,
  agentId: uuidSchema,
  issueId: uuidSchema.nullable().optional(),
  heartbeatRunId: uuidSchema.nullable().optional(),
  evaluatorType: z.enum(['self', 'judge', 'peer', 'deterministic']),
  scores: z.array(z.object({
    criterion: z.string(),
    score: z.number().min(0).max(1),
    feedback: z.string().nullable().optional(),
  })),
  overallScore: z.number().min(0).max(1),
  passed: z.boolean(),
  revisionNumber: z.number().int().min(1).default(1),
  feedback: z.string().nullable().optional(),
});

export function qualityRoutes(deps: AppDeps) {
  const { db, eventBus } = deps;
  const app = new Hono();

  // -------------------------------------------------------
  // RUBRICS
  // -------------------------------------------------------

  // POST /rubrics
  app.post('/rubrics', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createRubricSchema.parse(await c.req.json());
    const [rubric] = await db
      .insert(qualityRubrics)
      .values({
        companyId,
        name: body.name,
        role: body.role ?? null,
        taskType: body.taskType ?? null,
        criteria: body.criteria,
        judgeModel: body.judgeModel,
        judgePrompt: body.judgePrompt,
        minImprovementThreshold: body.minImprovementThreshold,
      })
      .returning();

    emitQualityEvent(eventBus, 'quality.rubric_created', companyId, {
      rubricId: rubric!.id,
      name: rubric!.name,
    });
    return c.json(serializeRow(rubric!), 201);
  });

  // GET /rubrics
  app.get('/rubrics', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const role = c.req.query('role');
    const taskType = c.req.query('taskType');

    const conditions = [eq(qualityRubrics.companyId, companyId)];
    if (role) conditions.push(eq(qualityRubrics.role, role));
    if (taskType) conditions.push(eq(qualityRubrics.taskType, taskType));

    const where = and(...conditions);

    const rows = await db
      .select()
      .from(qualityRubrics)
      .where(where)
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(qualityRubrics)
      .where(where);

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /rubrics/:id
  app.get('/rubrics/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const [rubric] = await db
      .select()
      .from(qualityRubrics)
      .where(and(eq(qualityRubrics.id, id), eq(qualityRubrics.companyId, companyId)));
    if (!rubric) throw notFound('QualityRubric', id);
    return c.json(serializeRow(rubric));
  });

  // PATCH /rubrics/:id
  app.patch('/rubrics/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const body = createRubricSchema.partial().parse(await c.req.json());

    const values: Record<string, unknown> = {};
    if (body.name !== undefined) values.name = body.name;
    if (body.role !== undefined) values.role = body.role;
    if (body.taskType !== undefined) values.taskType = body.taskType;
    if (body.criteria !== undefined) values.criteria = body.criteria;
    if (body.judgeModel !== undefined) values.judgeModel = body.judgeModel;
    if (body.judgePrompt !== undefined) values.judgePrompt = body.judgePrompt;
    if (body.minImprovementThreshold !== undefined)
      values.minImprovementThreshold = body.minImprovementThreshold;

    if (Object.keys(values).length === 0) {
      const [existing] = await db
        .select()
        .from(qualityRubrics)
        .where(and(eq(qualityRubrics.id, id), eq(qualityRubrics.companyId, companyId)));
      if (!existing) throw notFound('QualityRubric', id);
      return c.json(serializeRow(existing));
    }

    values.updatedAt = new Date();
    const [updated] = await db
      .update(qualityRubrics)
      .set(values)
      .where(and(eq(qualityRubrics.id, id), eq(qualityRubrics.companyId, companyId)))
      .returning();
    if (!updated) throw notFound('QualityRubric', id);

    emitQualityEvent(eventBus, 'quality.rubric_updated', companyId, {
      rubricId: updated.id,
      name: updated.name,
    });
    return c.json(serializeRow(updated));
  });

  // -------------------------------------------------------
  // EVALUATIONS
  // -------------------------------------------------------

  // POST /evaluations
  app.post('/evaluations', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createEvaluationSchema.parse(await c.req.json());
    const [evaluation] = await db
      .insert(qualityEvaluations)
      .values({
        companyId,
        rubricId: body.rubricId,
        agentId: body.agentId,
        issueId: body.issueId ?? null,
        runId: body.heartbeatRunId!,
        evaluatorType: body.evaluatorType,
        scores: body.scores,
        overallScore: body.overallScore,
        passed: body.passed,
        revisionNumber: body.revisionNumber,
        feedback: body.feedback ?? null,
      })
      .returning();

    const eventType = body.passed ? 'quality.gate_passed' : 'quality.gate_failed';
    emitQualityEvent(eventBus, eventType, companyId, {
      evaluationId: evaluation!.id,
      agentId: body.agentId,
      rubricId: body.rubricId,
      overallScore: body.overallScore,
      passed: body.passed,
    });

    return c.json(serializeRow(evaluation!), 201);
  });

  // GET /evaluations
  app.get('/evaluations', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const agentId = c.req.query('agentId');
    const issueId = c.req.query('issueId');

    const conditions = [eq(qualityEvaluations.companyId, companyId)];
    if (agentId) conditions.push(eq(qualityEvaluations.agentId, agentId));
    if (issueId) conditions.push(eq(qualityEvaluations.issueId, issueId));

    const where = and(...conditions);

    const rows = await db
      .select()
      .from(qualityEvaluations)
      .where(where)
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(qualityEvaluations)
      .where(where);

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /evaluations/:id
  app.get('/evaluations/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const [evaluation] = await db
      .select()
      .from(qualityEvaluations)
      .where(and(eq(qualityEvaluations.id, id), eq(qualityEvaluations.companyId, companyId)));
    if (!evaluation) throw notFound('QualityEvaluation', id);
    return c.json(serializeRow(evaluation));
  });

  // -------------------------------------------------------
  // AGENT SUMMARY
  // -------------------------------------------------------

  // GET /agents/:agentId/summary
  app.get('/agents/:agentId/summary', async (c) => {
    const companyId = c.req.param('companyId')!;
    const agentId = c.req.param('agentId');

    const evaluations = await db
      .select()
      .from(qualityEvaluations)
      .where(
        and(
          eq(qualityEvaluations.companyId, companyId),
          eq(qualityEvaluations.agentId, agentId),
        ),
      );

    const totalCount = evaluations.length;
    if (totalCount === 0) {
      return c.json({
        agentId,
        totalEvaluations: 0,
        avgOverallScore: 0,
        passRate: 0,
        countByEvaluatorType: {},
        trend: [],
      });
    }

    const sumScore = evaluations.reduce((acc, e) => acc + e.overallScore, 0);
    const avgOverallScore = sumScore / totalCount;
    const passedCount = evaluations.filter((e) => e.passed).length;
    const passRate = passedCount / totalCount;

    const countByEvaluatorType: Record<string, number> = {};
    for (const e of evaluations) {
      countByEvaluatorType[e.evaluatorType] =
        (countByEvaluatorType[e.evaluatorType] ?? 0) + 1;
    }

    // Trend: last 10 evaluations ordered by createdAt
    const sorted = [...evaluations].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const trend = sorted.slice(-10).map((e) => ({
      id: e.id,
      overallScore: e.overallScore,
      passed: e.passed,
      createdAt: e.createdAt,
    }));

    return c.json({
      agentId,
      totalEvaluations: totalCount,
      avgOverallScore: Math.round(avgOverallScore * 1000) / 1000,
      passRate: Math.round(passRate * 1000) / 1000,
      countByEvaluatorType,
      trend,
    });
  });

  return app;
}

function emitQualityEvent(
  eventBus: InProcessEventBus,
  type: string,
  companyId: string,
  payload: Record<string, unknown>,
) {
  const event: SystemEvent = {
    type,
    companyId,
    timestamp: new Date(),
    payload,
  };
  eventBus.emit(event);
}
