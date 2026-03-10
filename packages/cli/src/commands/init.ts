import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function initCommand() {
  console.log('Initializing ClawGear...\n');

  // Check for .env file
  const envPath = resolve(process.cwd(), '.env');
  const envExamplePath = resolve(process.cwd(), 'env.example');

  if (!existsSync(envPath) && existsSync(envExamplePath)) {
    const content = await Bun.file(envExamplePath).text();
    writeFileSync(envPath, content);
    console.log('  Created .env from env.example');
    console.log('  Edit .env with your configuration before starting.\n');
  } else if (existsSync(envPath)) {
    console.log('  .env already exists, skipping.\n');
  }

  // Run migrations
  console.log('  Running database migrations...');
  try {
    const { createConnection } = await import('@clawgear/db');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');

    const url =
      process.env.DATABASE_URL ?? 'postgresql://clawgear:clawgear@localhost:5432/clawgear';
    const { db, client } = createConnection(url);

    const migrationsPath = resolve(import.meta.dir, '../../../db/drizzle');
    await migrate(db, { migrationsFolder: migrationsPath });
    await client.end();

    console.log('  Migrations complete.\n');
  } catch (err) {
    console.error('  Migration failed:', (err as Error).message);
    console.error('  Make sure PostgreSQL is running: docker compose up -d\n');
    process.exit(1);
  }

  console.log('ClawGear initialized. Run `clawgear start` to launch.');
}
