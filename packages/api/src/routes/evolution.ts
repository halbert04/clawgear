import { agentCompetence, evolvedSkills, promptVersions, strategyPatterns } from '@clawgear/db/pg';
import {
  createEvolvedSkillSchema,
  createPromptVersionSchema,
  createStrategyPatternSchema,
  paginationSchema,
  updateSkillStatusSchema,
} from '@clawgear/shared/validators';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

export function evolutionRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = new Hono();

  // -------------------------------------------------------
  // EVOLVED SKILLS
  // -------------------------------------------------------

  // GET /skills
  app.get('/skills', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const status = c.req.query('status');

    const conditions = [eq(evolvedSkills.companyId, companyId)];
    if (status) conditions.push(eq(evolvedSkills.status, status));

    const where = and(...conditions);
    const rows = await db
      .select()
      .from(evolvedSkills)
      .where(where)
      .orderBy(desc(evolvedSkills.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(evolvedSkills)
      .where(where);

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // POST /skills
  app.post('/skills', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createEvolvedSkillSchema.parse(await c.req.json());
    const agentId = c.req.query('agentId');
    if (!agentId) return c.json({ error: 'agentId query param required' }, 400);

    // Find next version
    const [latest] = await db
      .select({ maxVersion: sql<number>`COALESCE(MAX(${evolvedSkills.version}), 0)` })
      .from(evolvedSkills)
      .where(and(eq(evolvedSkills.companyId, companyId), eq(evolvedSkills.name, body.name)));

    const version = (latest?.maxVersion ?? 0) + 1;

    const [skill] = await db
      .insert(evolvedSkills)
      .values({
        companyId,
        proposedByAgentId: agentId,
        name: body.name,
        description: body.description,
        version,
        content: body.content,
        triggerConditions: body.triggerConditions,
        exampleInvocations: body.exampleInvocations,
        status: 'proposed',
        parentSkillId: body.parentSkillId ?? null,
      })
      .returning();

    return c.json(serializeRow(skill!), 201);
  });

  // GET /skills/:id
  app.get('/skills/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const [skill] = await db
      .select()
      .from(evolvedSkills)
      .where(and(eq(evolvedSkills.id, id), eq(evolvedSkills.companyId, companyId)));
    if (!skill) throw notFound('EvolvedSkill', id);
    return c.json(serializeRow(skill));
  });

  // PATCH /skills/:id/status
  app.patch('/skills/:id/status', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const body = updateSkillStatusSchema.parse(await c.req.json());

    const [updated] = await db
      .update(evolvedSkills)
      .set({ status: body.status, updatedAt: new Date() })
      .where(and(eq(evolvedSkills.id, id), eq(evolvedSkills.companyId, companyId)))
      .returning();

    if (!updated) throw notFound('EvolvedSkill', id);
    return c.json(serializeRow(updated));
  });

  // GET /skills/search
  app.get('/skills/search', async (c) => {
    const companyId = c.req.param('companyId')!;
    const query = c.req.query('q') ?? '';
    const limit = Number(c.req.query('limit') ?? '10');

    const rows = await db
      .select()
      .from(evolvedSkills)
      .where(
        and(
          eq(evolvedSkills.companyId, companyId),
          eq(evolvedSkills.status, 'active'),
          sql`(
            ${evolvedSkills.name} ILIKE ${`%${query}%`}
            OR ${evolvedSkills.description} ILIKE ${`%${query}%`}
          )`,
        ),
      )
      .orderBy(desc(evolvedSkills.usageCount))
      .limit(limit);

    return c.json({ data: serializeRows(rows) });
  });

  // -------------------------------------------------------
  // PROMPT VERSIONS
  // -------------------------------------------------------

  // GET /prompts
  app.get('/prompts', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const agentRole = c.req.query('agentRole');
    const promptType = c.req.query('promptType');

    const conditions = [eq(promptVersions.companyId, companyId)];
    if (agentRole) conditions.push(eq(promptVersions.agentRole, agentRole));
    if (promptType) conditions.push(eq(promptVersions.promptType, promptType));

    const where = and(...conditions);
    const rows = await db
      .select()
      .from(promptVersions)
      .where(where)
      .orderBy(desc(promptVersions.version))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(promptVersions)
      .where(where);

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // POST /prompts
  app.post('/prompts', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createPromptVersionSchema.parse(await c.req.json());

    const [latest] = await db
      .select({ maxVersion: sql<number>`COALESCE(MAX(${promptVersions.version}), 0)` })
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.companyId, companyId),
          eq(promptVersions.agentRole, body.agentRole),
          eq(promptVersions.promptType, body.promptType),
        ),
      );

    const version = (latest?.maxVersion ?? 0) + 1;

    const [pv] = await db
      .insert(promptVersions)
      .values({
        companyId,
        agentRole: body.agentRole,
        promptType: body.promptType,
        version,
        content: body.content,
        parentVersionId: body.parentVersionId ?? null,
      })
      .returning();

    return c.json(serializeRow(pv!), 201);
  });

  // POST /prompts/:id/activate
  app.post('/prompts/:id/activate', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [version] = await db
      .select()
      .from(promptVersions)
      .where(and(eq(promptVersions.id, id), eq(promptVersions.companyId, companyId)));

    if (!version) throw notFound('PromptVersion', id);

    // Deactivate all others for same role/type
    await db
      .update(promptVersions)
      .set({ isActive: false })
      .where(
        and(
          eq(promptVersions.companyId, companyId),
          eq(promptVersions.agentRole, version.agentRole),
          eq(promptVersions.promptType, version.promptType),
        ),
      );

    const [updated] = await db
      .update(promptVersions)
      .set({ isActive: true, isAbTesting: false, abTrafficPercent: 0 })
      .where(eq(promptVersions.id, id))
      .returning();

    return c.json(serializeRow(updated!));
  });

  // -------------------------------------------------------
  // COMPETENCE
  // -------------------------------------------------------

  // GET /competence
  app.get('/competence', async (c) => {
    const companyId = c.req.param('companyId')!;
    const agentId = c.req.query('agentId');
    const taskType = c.req.query('taskType');

    const conditions = [eq(agentCompetence.companyId, companyId)];
    if (agentId) conditions.push(eq(agentCompetence.agentId, agentId));
    if (taskType) conditions.push(eq(agentCompetence.taskType, taskType));

    const rows = await db
      .select()
      .from(agentCompetence)
      .where(and(...conditions))
      .orderBy(desc(agentCompetence.avgQualityScore));

    return c.json({ data: serializeRows(rows) });
  });

  // GET /competence/team
  app.get('/competence/team', async (c) => {
    const companyId = c.req.param('companyId')!;

    const summary = await db
      .select({
        taskType: agentCompetence.taskType,
        totalAgents: sql<number>`count(DISTINCT ${agentCompetence.agentId})`,
        avgSuccessRate: sql<number>`avg(${agentCompetence.successfulRuns}::float / NULLIF(${agentCompetence.totalRuns}, 0))`,
        avgQuality: sql<number>`avg(${agentCompetence.avgQualityScore})`,
        totalRuns: sql<number>`sum(${agentCompetence.totalRuns})`,
      })
      .from(agentCompetence)
      .where(eq(agentCompetence.companyId, companyId))
      .groupBy(agentCompetence.taskType);

    return c.json({ data: summary });
  });

  // -------------------------------------------------------
  // STRATEGY PATTERNS
  // -------------------------------------------------------

  // GET /strategies
  app.get('/strategies', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const patternType = c.req.query('patternType');
    const agentId = c.req.query('agentId');

    const conditions = [eq(strategyPatterns.companyId, companyId)];
    if (patternType) conditions.push(eq(strategyPatterns.patternType, patternType));
    if (agentId) conditions.push(eq(strategyPatterns.agentId, agentId));

    const where = and(...conditions);
    const rows = await db
      .select()
      .from(strategyPatterns)
      .where(where)
      .orderBy(desc(strategyPatterns.confidence))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(strategyPatterns)
      .where(where);

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // POST /strategies
  app.post('/strategies', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createStrategyPatternSchema.parse(await c.req.json());

    const [pattern] = await db
      .insert(strategyPatterns)
      .values({
        companyId,
        agentId: body.agentId,
        patternType: body.patternType,
        description: body.description,
        contextJson: body.contextJson,
      })
      .returning();

    return c.json(serializeRow(pattern!), 201);
  });

  // GET /strategies/:id
  app.get('/strategies/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const [pattern] = await db
      .select()
      .from(strategyPatterns)
      .where(and(eq(strategyPatterns.id, id), eq(strategyPatterns.companyId, companyId)));
    if (!pattern) throw notFound('StrategyPattern', id);
    return c.json(serializeRow(pattern));
  });

  return app;
}
