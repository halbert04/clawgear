import { auditChain } from '@clawgear/db/pg';
import { asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

export function auditRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = new Hono();

  // GET /api/companies/:companyId/audit/verify — verify chain integrity
  app.get('/verify', async (c) => {
    const companyId = c.req.param('companyId')!;

    const entries = await db
      .select()
      .from(auditChain)
      .where(eq(auditChain.companyId, companyId))
      .orderBy(asc(auditChain.sequence));

    if (entries.length === 0) {
      return c.json({
        valid: true,
        entriesVerified: 0,
        brokenAtSequence: null,
        error: null,
      });
    }

    // Verify genesis
    const genesis = entries[0]!;
    if (genesis.previousHash !== null) {
      return c.json({
        valid: false,
        entriesVerified: 0,
        brokenAtSequence: 0,
        error: 'Genesis entry must have null previousHash',
      });
    }

    // Verify chain links
    for (let i = 1; i < entries.length; i++) {
      const entry = entries[i]!;
      const prev = entries[i - 1]!;

      if (entry.previousHash !== prev.chainHash) {
        return c.json({
          valid: false,
          entriesVerified: i,
          brokenAtSequence: i,
          error: `Broken chain link at sequence ${entry.sequence}`,
        });
      }

      if (entry.sequence !== i) {
        return c.json({
          valid: false,
          entriesVerified: i,
          brokenAtSequence: i,
          error: `Sequence gap: expected ${i}, got ${entry.sequence}`,
        });
      }
    }

    return c.json({
      valid: true,
      entriesVerified: entries.length,
      brokenAtSequence: null,
      error: null,
    });
  });

  // GET /api/companies/:companyId/audit — list audit entries
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
    const offset = Number(c.req.query('offset') ?? 0);

    const rows = await db
      .select()
      .from(auditChain)
      .where(eq(auditChain.companyId, companyId))
      .orderBy(asc(auditChain.sequence))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditChain)
      .where(eq(auditChain.companyId, companyId));

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /api/companies/:companyId/audit/head — get latest chain hash
  app.get('/head', async (c) => {
    const companyId = c.req.param('companyId')!;

    const [latest] = await db
      .select({
        chainHash: auditChain.chainHash,
        sequence: auditChain.sequence,
      })
      .from(auditChain)
      .where(eq(auditChain.companyId, companyId))
      .orderBy(asc(auditChain.sequence))
      .limit(1);

    if (!latest) {
      return c.json({ head: null, length: 0 });
    }

    // Get actual latest by ordering desc
    const [head] = await db
      .select({
        chainHash: auditChain.chainHash,
        sequence: auditChain.sequence,
      })
      .from(auditChain)
      .where(eq(auditChain.companyId, companyId))
      .orderBy(sql`${auditChain.sequence} DESC`)
      .limit(1);

    return c.json({
      head: head!.chainHash,
      length: head!.sequence + 1,
    });
  });

  // GET /api/companies/:companyId/audit/entry/:sequence — get single entry
  app.get('/entry/:sequence', async (c) => {
    const companyId = c.req.param('companyId')!;
    const sequence = Number(c.req.param('sequence'));

    const [entry] = await db
      .select()
      .from(auditChain)
      .where(sql`${auditChain.companyId} = ${companyId} AND ${auditChain.sequence} = ${sequence}`);

    if (!entry) {
      return c.json({ error: 'Entry not found' }, 404);
    }

    return c.json(serializeRow(entry));
  });

  return app;
}
