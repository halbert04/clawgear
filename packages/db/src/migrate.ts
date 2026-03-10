import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createConnection } from './pg/connection.js';

async function main() {
  const url = process.env.DATABASE_URL ?? 'postgresql://clawgear:clawgear@localhost:5432/clawgear';
  console.log('Running migrations...');

  const { db, client } = createConnection(url);

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrations complete.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
