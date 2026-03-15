import type { Command } from 'commander';

export function registerMigrationCommands(program: Command) {
  const migrate = program
    .command('migrate')
    .description('Import data from external systems into ClawGear');

  migrate
    .command('run')
    .description('Run a migration from an external system')
    .requiredOption('--from <source>', 'Source system: paperclip, openfang, or openclaw')
    .requiredOption('--file <path>', 'Path to JSON export file')
    .requiredOption('--company <id>', 'Target company ID')
    .option('--dry-run', 'Preview migration without writing to database', false)
    .option('--output <path>', 'Write migration report to file')
    .action(
      async (opts: {
        from: string;
        file: string;
        company: string;
        dryRun: boolean;
        output?: string;
      }) => {
        try {
          const validSources = ['paperclip', 'openfang', 'openclaw'];
          if (!validSources.includes(opts.from)) {
            console.error(
              `Invalid source: ${opts.from}. Must be one of: ${validSources.join(', ')}`,
            );
            process.exit(1);
          }

          const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (!uuidRe.test(opts.company)) {
            console.error(`Invalid company ID: ${opts.company} (expected UUID format)`);
            process.exit(1);
          }

          const fs = await import('node:fs');
          const path = await import('node:path');

          const filePath = path.resolve(opts.file);
          if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            process.exit(1);
          }

          let raw: unknown;
          try {
            raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          } catch {
            console.error(`Invalid JSON file: ${filePath}`);
            process.exit(1);
          }

          const { migrate, persist } = await import('@clawgear/migration');
          const sep = '------------------------------------------------';
          const mode = opts.dryRun ? 'DRY RUN' : 'LIVE';

          console.log(`\n  ClawGear Migration [${mode}]`);
          console.log(`  ${sep}`);
          console.log(`  Source:   ${opts.from}`);
          console.log(`  File:     ${filePath}`);
          console.log(`  Company:  ${opts.company}`);
          console.log('');

          // Phase 1: Transform
          console.log('  [1/3] Transforming data...');
          const t0 = performance.now();

          const { report, transformed } = migrate({
            source: opts.from as 'paperclip' | 'openfang' | 'openclaw',
            companyId: opts.company,
            data: raw,
            dryRun: opts.dryRun,
          });

          const transformMs = Math.round(performance.now() - t0);
          const entityTypes = Object.keys(report.counts).length;
          const entityTotal = Object.values(report.counts).reduce((s, c) => s + c, 0);
          console.log(
            `        ${entityTypes} entity types, ${entityTotal} entities in ${transformMs}ms`,
          );

          // Phase 2: Pre-flight check
          console.log('');
          console.log('  [2/3] Pre-flight check');
          console.log(`  ${sep}`);
          console.log('  Entity            Transformed   Warnings');
          console.log(`  ${sep}`);

          const warningCounts: Record<string, number> = {};
          for (const w of report.warnings) {
            warningCounts[w.entityType] = (warningCounts[w.entityType] ?? 0) + 1;
          }
          for (const [entity, count] of Object.entries(report.counts)) {
            const warns = warningCounts[entity] ?? 0;
            console.log(
              `  ${entity.padEnd(20)}${String(count).padStart(11)}${String(warns).padStart(11)}`,
            );
          }
          console.log(`  ${sep}`);

          // Phase 3: Persist or skip
          let persistResult: import('@clawgear/migration').PersistResult | undefined;

          if (opts.dryRun) {
            console.log('');
            console.log('  [3/3] Writing to database...');
            console.log('        Skipped (dry run)');
          } else {
            console.log('');
            console.log('  [3/3] Writing to database...');
            const { createConnection } = await import('@clawgear/db');
            const { db, client } = createConnection();

            try {
              const t1 = performance.now();
              persistResult = await persist(db, transformed, opts.company, {
                verify: true,
                onProgress: (_phase, entity, current, total) => {
                  process.stdout.write(`\r        ${entity}: ${current}/${total}    `);
                },
              });
              const persistMs = Math.round(performance.now() - t1);

              // Clear progress line and print final counts
              process.stdout.write(`\r${' '.repeat(60)}\r`);
              const entities = ['triggers', 'workflows', 'skills', 'runtimeStates'];
              for (const e of entities) {
                const ins = persistResult.inserted[e] ?? 0;
                const total = ins + (persistResult.skipped[e] ?? 0);
                if (total > 0) {
                  console.log(`        ${`${e}:`.padEnd(15)}${ins}/${total}`);
                }
              }
              console.log(`        Done in ${persistMs}ms`);

              report.persistence = persistResult;
            } finally {
              await client.end();
            }
          }

          // Results table
          if (persistResult) {
            console.log('');
            console.log('  Results');
            console.log(`  ${sep}`);
            console.log('  Entity            Inserted    Skipped');
            console.log(`  ${sep}`);
            for (const e of ['triggers', 'workflows', 'skills', 'runtimeStates']) {
              const ins = persistResult.inserted[e] ?? 0;
              const skip = persistResult.skipped[e] ?? 0;
              if (ins > 0 || skip > 0) {
                console.log(
                  `  ${e.padEnd(20)}${String(ins).padStart(8)}${String(skip).padStart(11)}`,
                );
              }
            }
            console.log(`  ${sep}`);

            if (Object.keys(persistResult.verified).length > 0) {
              console.log('');
              const verParts = Object.entries(persistResult.verified)
                .map(([k, v]) => `${k}: ${v}`)
                .join('    ');
              console.log(`  Verification (total rows in company):`);
              console.log(`    ${verParts}`);
            }
          }

          // ID mappings
          const totalMappings = Object.values(report.idMappings).reduce(
            (sum, m) => sum + Object.keys(m).length,
            0,
          );
          console.log('');
          console.log(`  ID mappings: ${totalMappings}`);

          // Write report to file if requested
          if (opts.output) {
            const outputPath = path.resolve(opts.output);
            fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
            console.log(`  Report: ${outputPath}`);
          }

          // Warnings summary
          if (report.warnings.length > 0) {
            console.log('');
            console.log(`  Warnings (${report.warnings.length}):`);
            for (const warn of report.warnings.slice(0, 10)) {
              console.log(`    [${warn.entityType}] ${warn.entityId}: ${warn.message}`);
            }
            if (report.warnings.length > 10) {
              console.log(`    ... and ${report.warnings.length - 10} more`);
            }
          }

          // Errors summary
          if (report.errors.length > 0) {
            console.log('');
            console.log(`  Errors (${report.errors.length}):`);
            for (const err of report.errors.slice(0, 20)) {
              console.log(`    [${err.entityType}] ${err.entityId}: ${err.message}`);
            }
            if (report.errors.length > 20) {
              console.log(`    ... and ${report.errors.length - 20} more`);
            }
          }

          console.log('');
          console.log(`  Status: ${report.status}`);
          console.log('');

          if (opts.dryRun) {
            console.log('  No data was written. Remove --dry-run to execute.\n');
          }

          if (report.status === 'failed') {
            process.exit(1);
          }
        } catch (err) {
          console.error(`Migration error: ${String(err)}`);
          process.exit(1);
        }
      },
    );

  migrate
    .command('validate')
    .description('Validate a migration export file without importing')
    .requiredOption('--from <source>', 'Source system: paperclip, openfang, or openclaw')
    .requiredOption('--file <path>', 'Path to JSON export file')
    .action(async (opts: { from: string; file: string }) => {
      try {
        const validSources = ['paperclip', 'openfang', 'openclaw'];
        if (!validSources.includes(opts.from)) {
          console.error(`Invalid source: ${opts.from}. Must be one of: ${validSources.join(', ')}`);
          process.exit(1);
        }

        const fs = await import('node:fs');
        const path = await import('node:path');

        const filePath = path.resolve(opts.file);
        if (!fs.existsSync(filePath)) {
          console.error(`File not found: ${filePath}`);
          process.exit(1);
        }

        let raw: unknown;
        try {
          raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
          console.error('Invalid JSON file');
          process.exit(1);
        }

        const { parsePaperclipData, parseOpenfangData, parseOpenclawData } = await import(
          '@clawgear/migration'
        );

        console.log(`Validating ${opts.from} export file: ${filePath}\n`);

        let entityCounts: Record<string, number> = {};

        switch (opts.from) {
          case 'paperclip': {
            const data = parsePaperclipData(raw);
            entityCounts = {
              companies: data.companies.length,
              agents: data.agents.length,
              goals: data.goals.length,
              projects: data.projects.length,
              issues: data.issues.length,
            };
            break;
          }
          case 'openfang': {
            const data = parseOpenfangData(raw);
            entityCounts = {
              agents: data.agents.length,
              skills: data.skills.length,
              facts: data.facts.length,
              lessons: data.lessons.length,
            };
            break;
          }
          case 'openclaw': {
            const data = parseOpenclawData(raw);
            entityCounts = {
              config: data.config.length,
              sessions: data.sessions.length,
              skills: data.skills.length,
              triggers: data.triggers.length,
              workflows: data.workflows.length,
            };
            break;
          }
        }

        console.log('File structure valid. Entity counts:');
        for (const [entity, count] of Object.entries(entityCounts)) {
          console.log(`  ${entity}: ${count}`);
        }

        const total = Object.values(entityCounts).reduce((s, c) => s + c, 0);
        console.log(`\nTotal entities: ${total}`);
        console.log('Validation passed.');
      } catch (err) {
        console.error(`Validation error: ${String(err)}`);
        process.exit(1);
      }
    });
}
