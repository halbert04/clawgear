import { InProcessEventBus } from '@clawgear/kernel';
import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';
import { issueRoutes } from './issues.js';

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const ISSUE_ID = '770e8400-e29b-41d4-a716-446655440003';
const AGENT_ID = '880e8400-e29b-41d4-a716-446655440004';
const COMMENT_ID = '990e8400-e29b-41d4-a716-446655440005';

function makeIssueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ISSUE_ID,
    companyId: COMPANY_ID,
    projectId: null,
    goalId: null,
    parentId: null,
    issueNumber: 1,
    identifier: 'ACME-1',
    title: 'Fix the bug',
    description: null,
    status: 'backlog',
    priority: 'medium',
    assigneeAgentId: null,
    checkoutRunId: null,
    executionLockedAt: null,
    lockTimeoutAt: null,
    requiredCapabilities: null,
    billingCode: null,
    requestDepth: 0,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    reopenedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeCommentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    companyId: COMPANY_ID,
    issueId: ISSUE_ID,
    authorAgentId: AGENT_ID,
    authorUserId: null,
    body: 'This is a comment',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function createApp(db: unknown) {
  const eventBus = new InProcessEventBus();
  const emitSpy = mock(() => {});
  eventBus.emit = emitSpy;

  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/companies/:companyId/issues', issueRoutes({ db: db as never, eventBus }));

  return { app, emitSpy, eventBus };
}

describe('Issue Routes', () => {
  // ============================================================
  // CREATE WITH NUMBERING
  // ============================================================

  test('POST creates issue with automatic numbering', async () => {
    const issueRow = makeIssueRow();

    // update(companies) for counter increment
    const counterReturning = mock(() => [{ issueCounter: 1, issuePrefix: 'ACME' }]);
    const counterWhere = mock(() => ({ returning: counterReturning }));
    const counterSet = mock(() => ({ where: counterWhere }));

    const insertReturning = mock(() => [issueRow]);
    const insertValues = mock(() => ({ returning: insertReturning }));

    const db = {
      update: mock(() => ({ set: counterSet })),
      insert: mock(() => ({ values: insertValues })),
      select: mock(),
    };

    const { app, emitSpy } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Fix the bug' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.identifier).toBe('ACME-1');
    expect(body.issueNumber).toBe(1);
    expect(body.title).toBe('Fix the bug');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'issue.created' }));
  });

  test('POST returns 404 when company does not exist', async () => {
    // Counter increment returns empty (company not found)
    const counterReturning = mock(() => []);
    const counterWhere = mock(() => ({ returning: counterReturning }));
    const counterSet = mock(() => ({ where: counterWhere }));

    const db = {
      update: mock(() => ({ set: counterSet })),
      insert: mock(),
      select: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Fix the bug' }),
    });

    expect(res.status).toBe(404);
  });

  test('POST emits issue.assigned when assigneeAgentId provided', async () => {
    const issueRow = makeIssueRow({ assigneeAgentId: AGENT_ID });

    const counterReturning = mock(() => [{ issueCounter: 1, issuePrefix: 'ACME' }]);
    const counterWhere = mock(() => ({ returning: counterReturning }));
    const counterSet = mock(() => ({ where: counterWhere }));

    const insertReturning = mock(() => [issueRow]);
    const insertValues = mock(() => ({ returning: insertReturning }));

    const db = {
      update: mock(() => ({ set: counterSet })),
      insert: mock(() => ({ values: insertValues })),
      select: mock(),
    };

    const { app, emitSpy } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Fix the bug', assigneeAgentId: AGENT_ID }),
    });

    expect(res.status).toBe(201);
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'issue.created' }));
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'issue.assigned' }));
  });

  // ============================================================
  // LIST WITH FILTERS
  // ============================================================

  test('GET / returns paginated list', async () => {
    const issueRow = makeIssueRow();
    const selectOffset = mock(() => [issueRow]);
    const selectLimit = mock(() => ({ offset: selectOffset }));

    const db = {
      insert: mock(),
      select: mock((...args: unknown[]) => {
        if (args.length > 0) {
          return { from: mock(() => ({ where: mock(() => [{ count: 1 }]) })) };
        }
        return {
          from: mock(() => ({
            where: mock(() => ({
              limit: selectLimit,
            })),
          })),
        };
      }),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  test('GET / supports status filter', async () => {
    const issueRow = makeIssueRow({ status: 'todo' });
    const selectOffset = mock(() => [issueRow]);
    const selectLimit = mock(() => ({ offset: selectOffset }));

    const db = {
      insert: mock(),
      select: mock((...args: unknown[]) => {
        if (args.length > 0) {
          return { from: mock(() => ({ where: mock(() => [{ count: 1 }]) })) };
        }
        return {
          from: mock(() => ({
            where: mock(() => ({
              limit: selectLimit,
            })),
          })),
        };
      }),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues?status=todo`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
  });

  test('GET / supports assigneeAgentId filter', async () => {
    const issueRow = makeIssueRow({ assigneeAgentId: AGENT_ID });
    const selectOffset = mock(() => [issueRow]);
    const selectLimit = mock(() => ({ offset: selectOffset }));

    const db = {
      insert: mock(),
      select: mock((...args: unknown[]) => {
        if (args.length > 0) {
          return { from: mock(() => ({ where: mock(() => [{ count: 1 }]) })) };
        }
        return {
          from: mock(() => ({
            where: mock(() => ({
              limit: selectLimit,
            })),
          })),
        };
      }),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues?assigneeAgentId=${AGENT_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
  });

  test('GET / supports projectId filter', async () => {
    const projectId = '660e8400-e29b-41d4-a716-446655440002';
    const issueRow = makeIssueRow({ projectId });
    const selectOffset = mock(() => [issueRow]);
    const selectLimit = mock(() => ({ offset: selectOffset }));

    const db = {
      insert: mock(),
      select: mock((...args: unknown[]) => {
        if (args.length > 0) {
          return { from: mock(() => ({ where: mock(() => [{ count: 1 }]) })) };
        }
        return {
          from: mock(() => ({
            where: mock(() => ({
              limit: selectLimit,
            })),
          })),
        };
      }),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues?projectId=${projectId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
  });

  // ============================================================
  // GET DETAIL
  // ============================================================

  test('GET /:id returns issue', async () => {
    const issueRow = makeIssueRow();

    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [issueRow]),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(ISSUE_ID);
    expect(body.identifier).toBe('ACME-1');
  });

  test('GET /:id returns 404 for missing issue', async () => {
    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => []),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/nonexistent-id`);
    expect(res.status).toBe(404);
  });

  // ============================================================
  // STATUS TRANSITIONS (valid + invalid)
  // ============================================================

  test('PATCH /:id allows valid status transition backlog -> todo', async () => {
    const currentRow = makeIssueRow({ status: 'backlog' });
    const updatedRow = makeIssueRow({ status: 'todo', updatedAt: new Date() });

    const updateReturning = mock(() => [updatedRow]);
    const updateWhere = mock(() => ({ returning: updateReturning }));
    const updateSet = mock(() => ({ where: updateWhere }));

    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [currentRow]),
        })),
      })),
      update: mock(() => ({ set: updateSet })),
    };

    const { app, emitSpy } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'todo' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('todo');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'issue.status_changed' }));
  });

  test('PATCH /:id allows valid transition in_review -> in_progress (rejected)', async () => {
    const currentRow = makeIssueRow({ status: 'in_review' });
    const updatedRow = makeIssueRow({ status: 'in_progress', updatedAt: new Date() });

    const updateReturning = mock(() => [updatedRow]);
    const updateWhere = mock(() => ({ returning: updateReturning }));
    const updateSet = mock(() => ({ where: updateWhere }));

    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [currentRow]),
        })),
      })),
      update: mock(() => ({ set: updateSet })),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('in_progress');
  });

  test('PATCH /:id allows any -> cancelled', async () => {
    const currentRow = makeIssueRow({ status: 'in_progress' });
    const updatedRow = makeIssueRow({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() });

    const updateReturning = mock(() => [updatedRow]);
    const updateWhere = mock(() => ({ returning: updateReturning }));
    const updateSet = mock(() => ({ where: updateWhere }));

    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [currentRow]),
        })),
      })),
      update: mock(() => ({ set: updateSet })),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('cancelled');
  });

  test('PATCH /:id rejects invalid status transition backlog -> in_progress', async () => {
    const currentRow = makeIssueRow({ status: 'backlog' });

    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [currentRow]),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid status transition');
  });

  test('PATCH /:id rejects invalid status transition todo -> done', async () => {
    const currentRow = makeIssueRow({ status: 'todo' });

    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [currentRow]),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid status transition');
  });

  test('PATCH /:id rejects invalid status transition done -> in_progress', async () => {
    const currentRow = makeIssueRow({ status: 'done' });

    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [currentRow]),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid status transition');
  });

  test('PATCH /:id returns 404 when issue not found for status change', async () => {
    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => []),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/nonexistent-id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'todo' }),
    });

    expect(res.status).toBe(404);
  });

  // ============================================================
  // ATOMIC CHECKOUT
  // ============================================================

  test('POST /:id/checkout checks out issue to agent', async () => {
    const checkedOutRow = makeIssueRow({
      assigneeAgentId: AGENT_ID,
      status: 'in_progress',
      executionLockedAt: new Date(),
    });

    const updateReturning = mock(() => [checkedOutRow]);
    const updateWhere = mock(() => ({ returning: updateReturning }));
    const updateSet = mock(() => ({ where: updateWhere }));

    const db = {
      insert: mock(),
      select: mock(),
      update: mock(() => ({ set: updateSet })),
    };

    const { app, emitSpy } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: AGENT_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assigneeAgentId).toBe(AGENT_ID);
    expect(body.status).toBe('in_progress');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'issue.checked_out' }));
  });

  test('POST /:id/checkout returns 400 without agentId', async () => {
    const db = {
      insert: mock(),
      select: mock(),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  // ============================================================
  // CHECKOUT CONFLICT
  // ============================================================

  test('POST /:id/checkout returns 409 when already checked out', async () => {
    const existingRow = makeIssueRow({
      assigneeAgentId: 'other-agent',
      status: 'in_progress',
      executionLockedAt: new Date(),
    });

    // Atomic update returns empty (condition not met)
    const updateReturning = mock(() => []);
    const updateWhere = mock(() => ({ returning: updateReturning }));
    const updateSet = mock(() => ({ where: updateWhere }));

    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [existingRow]),
        })),
      })),
      update: mock(() => ({ set: updateSet })),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: AGENT_ID }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already checked out');
  });

  test('POST /:id/checkout returns 404 when issue does not exist', async () => {
    // Atomic update returns empty
    const updateReturning = mock(() => []);
    const updateWhere = mock(() => ({ returning: updateReturning }));
    const updateSet = mock(() => ({ where: updateWhere }));

    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => []),
        })),
      })),
      update: mock(() => ({ set: updateSet })),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/nonexistent-id/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: AGENT_ID }),
    });

    expect(res.status).toBe(404);
  });

  // ============================================================
  // RELEASE
  // ============================================================

  test('POST /:id/release releases checkout', async () => {
    const releasedRow = makeIssueRow({
      assigneeAgentId: null,
      executionLockedAt: null,
      status: 'todo',
    });

    const updateReturning = mock(() => [releasedRow]);
    const updateWhere = mock(() => ({ returning: updateReturning }));
    const updateSet = mock(() => ({ where: updateWhere }));

    const db = {
      insert: mock(),
      select: mock(),
      update: mock(() => ({ set: updateSet })),
    };

    const { app, emitSpy } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assigneeAgentId).toBeNull();
    expect(body.executionLockedAt).toBeNull();
    expect(body.status).toBe('todo');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'issue.released' }));
  });

  test('POST /:id/release returns 404 for missing issue', async () => {
    const updateReturning = mock(() => []);
    const updateWhere = mock(() => ({ returning: updateReturning }));
    const updateSet = mock(() => ({ where: updateWhere }));

    const db = {
      insert: mock(),
      select: mock(),
      update: mock(() => ({ set: updateSet })),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/nonexistent-id/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });

  // ============================================================
  // ADD COMMENT
  // ============================================================

  test('POST /:id/comments adds a comment', async () => {
    const issueRow = makeIssueRow();
    const commentRow = makeCommentRow();

    const insertReturning = mock(() => [commentRow]);
    const insertValues = mock(() => ({ returning: insertReturning }));

    const db = {
      insert: mock(() => ({ values: insertValues })),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [issueRow]),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorAgentId: AGENT_ID, body: 'This is a comment' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.body).toBe('This is a comment');
    expect(body.issueId).toBe(ISSUE_ID);
    expect(body.authorAgentId).toBe(AGENT_ID);
  });

  test('POST /:id/comments returns 404 for missing issue', async () => {
    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => []),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/nonexistent-id/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'This is a comment' }),
    });

    expect(res.status).toBe(404);
  });

  test('POST /:id/comments returns 400 on invalid data', async () => {
    const issueRow = makeIssueRow();

    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [issueRow]),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation Error');
  });
});
