import { marketplaceSkills } from '@clawgear/db/pg';
import { verifySkillIntegrity } from '@clawgear/marketplace';
import { sql } from 'drizzle-orm';
import { and, eq, ilike, or } from 'drizzle-orm/expressions';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';

export function marketplaceRoutes(deps: AppDeps) {
  const { db, eventBus } = deps;
  const app = new Hono();

  // GET / — Search and list skills
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const query = c.req.query('q') ?? '';
    const tag = c.req.query('tag');
    const author = c.req.query('author');
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
    const offset = Number(c.req.query('offset') ?? 0);

    const conditions = [
      eq(marketplaceSkills.companyId, companyId),
      eq(marketplaceSkills.status, 'published'),
    ];

    if (query) {
      conditions.push(
        or(
          ilike(marketplaceSkills.name, `%${query}%`),
          ilike(marketplaceSkills.description, `%${query}%`),
        )!,
      );
    }
    if (tag) {
      conditions.push(sql`${marketplaceSkills.tags} @> ${JSON.stringify([tag])}::jsonb`);
    }
    if (author) {
      conditions.push(eq(marketplaceSkills.author, author));
    }

    const where = and(...conditions);

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: marketplaceSkills.id,
          name: marketplaceSkills.name,
          version: marketplaceSkills.version,
          description: marketplaceSkills.description,
          author: marketplaceSkills.author,
          tags: marketplaceSkills.tags,
          downloads: marketplaceSkills.downloads,
          createdAt: marketplaceSkills.createdAt,
        })
        .from(marketplaceSkills)
        .where(where)
        .orderBy(marketplaceSkills.downloads)
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(marketplaceSkills).where(where),
    ]);

    return c.json({
      data: rows,
      total: countResult[0]?.count ?? 0,
      limit,
      offset,
    });
  });

  // GET /:name — Get skill details
  app.get('/:name', async (c) => {
    const companyId = c.req.param('companyId')!;
    const name = c.req.param('name')!;

    const [skill] = await db
      .select()
      .from(marketplaceSkills)
      .where(
        and(
          eq(marketplaceSkills.companyId, companyId),
          eq(marketplaceSkills.name, name),
          eq(marketplaceSkills.status, 'published'),
        ),
      )
      .orderBy(sql`${marketplaceSkills.createdAt} DESC`)
      .limit(1);

    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404);
    }

    return c.json(skill);
  });

  // POST /publish — Publish a skill
  app.post('/publish', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = await c.req.json();

    const { manifest, signature, publisherKey, packageData } = body as {
      manifest: Record<string, unknown>;
      signature: string;
      publisherKey: string;
      packageData: string;
    };

    if (!manifest || !signature || !publisherKey || !packageData) {
      return c.json(
        { error: 'Missing required fields: manifest, signature, publisherKey, packageData' },
        400,
      );
    }

    const m = manifest as {
      name: string;
      version: string;
      description: string;
      author: string;
      license: string;
      tags: string[];
      capabilities: string[];
      checksum: string;
    };

    // Check for duplicate name+version
    const [existing] = await db
      .select({ id: marketplaceSkills.id })
      .from(marketplaceSkills)
      .where(
        and(
          eq(marketplaceSkills.companyId, companyId),
          eq(marketplaceSkills.name, m.name),
          eq(marketplaceSkills.version, m.version),
        ),
      )
      .limit(1);

    if (existing) {
      return c.json({ error: `Skill ${m.name}@${m.version} already exists` }, 409);
    }

    // Verify Ed25519 signature and checksum integrity
    const integrity = verifySkillIntegrity(m, signature, publisherKey, packageData);
    if (!integrity.valid) {
      return c.json({ error: `Integrity verification failed: ${integrity.error}` }, 400);
    }

    const [result] = await db
      .insert(marketplaceSkills)
      .values({
        companyId,
        name: m.name,
        version: m.version,
        description: m.description ?? '',
        author: m.author,
        tags: m.tags ?? [],
        capabilities: m.capabilities ?? [],
        manifest,
        signature,
        publisherKey,
        packageData,
        checksum: m.checksum,
      })
      .returning();

    eventBus.emit({
      type: 'marketplace.skill_published',
      companyId,
      timestamp: new Date(),
      payload: { skillId: result!.id, name: m.name, version: m.version, author: m.author },
    });

    return c.json(result, 201);
  });

  // POST /:name/install — Install a skill (increment downloads, return package)
  app.post('/:name/install', async (c) => {
    const companyId = c.req.param('companyId')!;
    const name = c.req.param('name')!;

    const [skill] = await db
      .select()
      .from(marketplaceSkills)
      .where(
        and(
          eq(marketplaceSkills.companyId, companyId),
          eq(marketplaceSkills.name, name),
          eq(marketplaceSkills.status, 'published'),
        ),
      )
      .orderBy(sql`${marketplaceSkills.createdAt} DESC`)
      .limit(1);

    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404);
    }

    // Increment download count
    await db
      .update(marketplaceSkills)
      .set({ downloads: sql`${marketplaceSkills.downloads} + 1` })
      .where(eq(marketplaceSkills.id, skill.id));

    eventBus.emit({
      type: 'marketplace.skill_installed',
      companyId,
      timestamp: new Date(),
      payload: { skillId: skill.id, name: skill.name, version: skill.version },
    });

    return c.json({
      manifest: skill.manifest,
      signature: skill.signature,
      publisherKey: skill.publisherKey,
      packageData: skill.packageData,
    });
  });

  // DELETE /:name — Unpublish a skill
  app.delete('/:name', async (c) => {
    const companyId = c.req.param('companyId')!;
    const name = c.req.param('name')!;

    const result = await db
      .update(marketplaceSkills)
      .set({ status: 'unpublished', updatedAt: new Date() })
      .where(and(eq(marketplaceSkills.companyId, companyId), eq(marketplaceSkills.name, name)))
      .returning({ id: marketplaceSkills.id });

    if (result.length === 0) {
      return c.json({ error: 'Skill not found' }, 404);
    }

    return c.json({ unpublished: result.length });
  });

  return app;
}
