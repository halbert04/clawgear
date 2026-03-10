import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Agent-local SQLite schema for session transcripts and scratch data

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  transcript: text('transcript').notNull().default('[]'), // JSONL
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const scratchKv = sqliteTable('scratch_kv', {
  key: text('key').primaryKey(),
  agentId: text('agent_id').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
