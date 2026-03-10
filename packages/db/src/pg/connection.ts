import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createConnection(url?: string) {
  const connectionUrl = url ?? process.env.DATABASE_URL;
  if (!connectionUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const client = postgres(connectionUrl, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: true,
  });

  const db = drizzle(client, { schema });

  return { db, client };
}

export type Database = ReturnType<typeof createConnection>['db'];
