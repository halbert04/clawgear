---
title: "Mock DB chain patterns for Drizzle ORM select queries"
category: test-failures
tags:
  - drizzle-orm
  - bun-test
  - mock-chaining
  - select-query
  - destructuring
  - pagination
  - hono
module: packages/api
symptom: >
  Drizzle select() chains like db.select().from(table).where(cond) are used
  in two incompatible ways in route handlers: (1) array-destructured for
  single-row lookups, and (2) further chained for paginated lists via
  .where().limit(n).offset(m). Mocking .where() to return a plain array
  satisfies destructuring but breaks .limit() calls; returning an object
  with .limit() breaks array destructuring.
root_cause: >
  Drizzle's query builder returns a thenable object that is both iterable
  (awaitable as an array) and chainable (exposes .limit(), .offset()).
  A plain mock array or plain mock object cannot satisfy both contracts
  simultaneously, so the mock must be a hybrid: an array instance with
  additional method properties attached via Object.assign or property
  assignment with a double-cast through unknown.
date: 2026-03-09
severity: medium
affected_files:
  - packages/api/src/routes/agents.test.ts
  - packages/api/src/routes/approvals.test.ts
  - packages/api/src/routes/companies.test.ts
  - packages/api/src/routes/goals.test.ts
  - packages/api/src/routes/issues.test.ts
  - packages/api/src/routes/projects.test.ts
  - packages/api/src/routes/quality.test.ts
  - packages/api/src/routes/activity.test.ts
  - packages/api/src/routes/budget.test.ts
  - packages/api/src/integration.test.ts
---

# Mock DB Chain Patterns for Drizzle ORM in Bun Tests

## Problem

When testing Hono route handlers that use Drizzle ORM, you need to mock the full query chain. Drizzle queries use a fluent builder pattern:

```typescript
// Single-row lookup (destructured as array)
const [row] = await db.select().from(table).where(eq(col, val));

// Paginated list (chained further)
const rows = await db.select().from(table).where(eq(col, val)).limit(10).offset(0);

// Count query (select with arguments)
const [{ count }] = await db.select({ count: count() }).from(table).where(eq(col, val));

// Insert
const [created] = await db.insert(table).values(data).returning();

// Update
const [updated] = await db.update(table).set(data).where(eq(col, val)).returning();
```

The core difficulty: `.where()` must return something that is **simultaneously**:
1. An **array** (for destructuring like `const [row] = await ...where()`)
2. An **object with `.limit()`** (for paginated queries like `.where().limit(10).offset(0)`)

## Failed Approaches

- **Plain array return from `.where()`**: Breaks when `.limit()` is called (`TypeError: .limit is not a function`)
- **Object with `.limit()` method**: Breaks when destructured (`TypeError: result is not iterable`)
- **Different return types based on arguments**: Too complex and fragile to maintain

## Solution: The Dual-Nature Array

JavaScript arrays are objects, so you can attach arbitrary properties to them. The mock returns a real array (enabling destructuring) with a `.limit` property monkey-patched on:

```typescript
const selectWhere = mock(() => {
  const result = [row] as unknown[];
  (result as unknown as Record<string, unknown>).limit = selectLimit;
  return result;
});
```

The double-cast `(result as unknown as Record<string, unknown>)` bypasses TypeScript's type checker. The value is a real array AND has a `.limit` property.

## Complete Mock DB Factory

```typescript
import { mock } from 'bun:test';

function createMockDb() {
  const row = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Acme Corp',
    // ... all columns for the entity
    budgetMonthlyCents: 100000n,
    spentMonthlyCents: 0n,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  // INSERT chain: db.insert(table).values(data).returning()
  const insertReturning = mock(() => [row]);
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  // SELECT chain (data): db.select().from(table).where(cond).limit(n).offset(m)
  const selectOffset = mock(() => [row]);
  const selectLimit = mock(() => ({ offset: selectOffset }));

  // KEY TECHNIQUE: .where() returns an array WITH a .limit property
  const selectWhere = mock(() => {
    const result = [row] as unknown[];
    (result as unknown as Record<string, unknown>).limit = selectLimit;
    return result;
  });

  const selectFrom = mock(() => ({
    where: selectWhere,
    limit: selectLimit, // for no-where pagination: select().from(T).limit()
  }));

  // SELECT chain (count): db.select({count}).from(table).where(cond)
  const countSelectFrom = mock(() => ({ where: mock(() => [{ count: 1 }]) }));

  // UPDATE chain: db.update(table).set(data).where(cond).returning()
  const updateReturning = mock(() => [{ ...row, updatedAt: new Date() }]);
  const updateWhere = mock(() => ({ returning: updateReturning }));
  const updateSet = mock(() => ({ where: updateWhere }));

  // SELECT dispatch: args.length > 0 means count query
  const db = {
    insert: insertFn,
    select: mock((...args: unknown[]) => {
      if (args.length > 0) return { from: countSelectFrom };
      return { from: selectFrom };
    }),
    update: mock(() => ({ set: updateSet })),
    execute: mock(() => Promise.resolve([{ '?column?': 1 }])),
  };

  return { db, row, insertReturning, selectWhere };
}
```

## Key Techniques Explained

### 1. Count Query Detection via `args.length`

`db.select()` (no args) returns all columns. `db.select({ count: count() })` passes an argument. Dispatch on `args.length`:

```typescript
select: mock((...args: unknown[]) => {
  if (args.length > 0) return { from: countSelectFrom };
  return { from: selectFrom };
}),
```

### 2. The `db as never` Cast

When passing mock to `createApp()` which expects a real Drizzle DB type:

```typescript
const app = createApp({ db: db as never, eventBus });
```

`as never` satisfies any TypeScript type without matching the full Drizzle interface.

### 3. Per-Test Customization via Exposed Mock References

Return references to inner mocks so tests can override with `.mockReturnValue()`:

```typescript
const { db, insertReturning } = createMockDb();
insertReturning.mockReturnValue([{ ...row, name: 'Updated' }]);
```

### 4. Routes with `.orderBy()` in the Chain

Some routes (like `activity.ts`) chain `.where().orderBy().limit().offset()`. Add `.orderBy` to the dual-nature return:

```typescript
const selectOrderBy = mock(() => ({ limit: selectLimit }));
const selectWhere = mock(() => {
  const result = [row] as unknown[];
  (result as unknown as Record<string, unknown>).limit = selectLimit;
  (result as unknown as Record<string, unknown>).orderBy = selectOrderBy;
  return result;
});
```

## Chain Shape Reference

```
db.insert(table)           -> { values }
  .values(data)            -> { returning }
  .returning()             -> [row]

db.select()                -> { from }          (data query, no args)
db.select(countSpec)       -> { from }          (count query, has args)
  .from(table)             -> { where, limit }
  .where(cond)             -> [row] WITH .limit property attached
  .limit(n)                -> { offset }
  .offset(m)               -> [row]

db.select(countSpec)       -> { from }
  .from(table)             -> { where }
  .where(cond)             -> [{ count: N }]

db.update(table)           -> { set }
  .set(data)               -> { where }
  .where(cond)             -> { returning }
  .returning()             -> [row]

db.execute(sql)            -> Promise<[{ '?column?': 1 }]>
```

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| `.where()` returns plain array | `TypeError: .limit is not a function` | Use dual-nature array pattern |
| `.where()` returns only object | `TypeError: result is not iterable` | Must be an array with attached properties |
| No count query dispatch | Count returns rows instead of `[{count: N}]` | Dispatch on `select()` args.length |
| Missing `.orderBy()` on mock | `TypeError: .orderBy is not a function` | Add `.orderBy` to dual-nature return |
| Missing `.limit()` on `.from()` | `TypeError: .limit is not a function` on from result | Include `limit` on `selectFrom` return |
| BigInt in row factory | `TypeError: Do not know how to serialize a BigInt` | Use `0n` syntax; `serializeRow()` handles conversion |
| Missing `execute` on mock | `db.execute is not a function` in health tests | Always include `execute: mock(...)` |
| Shared mock mutated across tests | Tests pass individually, fail together | Create fresh mock per `test()` block |

## Prevention: Pre-Test Checklist

Before writing tests for a new route, scan the implementation and check:

1. Does it use `const [row] = await db.select()...where()`? (Need array mock)
2. Does it use `.where().limit().offset()`? (Need dual-nature mock)
3. Does it use `.where().orderBy().limit().offset()`? (Need `.orderBy` on dual-nature)
4. Does it use `db.select({count:...})`? (Need arg-dispatch in select mock)
5. Does it use `.from(T).limit().offset()` without `.where()`? (Need `.limit` on `from` result)
6. Does it make multiple sequential selects? (Need a result queue or per-call overrides)
7. Does it use BigInt fields? (Use `0n` in row factory)
8. Does it emit events? (Need `InProcessEventBus` + spy)
9. Does it mount the full app via `createApp()`? (Need `execute` on mock)

## Reference Files

- `packages/api/src/routes/agents.test.ts` -- Most complete reference (dual-nature, count dispatch, not-found variant)
- `packages/api/src/routes/approvals.test.ts` -- Double-cast pattern
- `packages/api/src/routes/activity.test.ts` -- `.orderBy()` chain support
- `packages/api/src/integration.test.ts` -- Simplified pattern for cross-cutting tests

## Future Improvement

Consider extracting a shared `packages/api/src/test-utils/mock-db.ts` utility. Currently 10 test files independently reinvent this pattern with 4 distinct approaches. A shared factory would eliminate duplication and ensure consistency.
