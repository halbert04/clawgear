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

          const fs = await import('node:fs');
          const path = await import('node:path');

          const filePath = path.resolve(opts.file);
          if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            process.exit(1);
          }

          const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

          const { migrate } = await import('@clawgear/migration');

          if (opts.dryRun) {
            console.log(`[DRY RUN] Previewing migration from ${opts.from}...\n`);
          } else {
            console.log(`Migrating from ${opts.from}...\n`);
          }

          const { report } = migrate({
            source: opts.from as 'paperclip' | 'openfang' | 'openclaw',
            companyId: opts.company,
            data: raw,
            dryRun: opts.dryRun,
          });

          // Print summary
          console.log(`Status: ${report.status}`);
          console.log(`Source: ${report.source}`);
          console.log(`Company: ${report.companyId}`);
          console.log(`Dry run: ${report.dryRun}\n`);

          console.log('Entities processed:');
          for (const [entity, count] of Object.entries(report.counts)) {
            console.log(`  ${entity}: ${count}`);
          }

          if (report.errors.length > 0) {
            console.log(`\nErrors (${report.errors.length}):`);
            for (const err of report.errors.slice(0, 20)) {
              console.log(`  [${err.entityType}] ${err.entityId}: ${err.message}`);
            }
            if (report.errors.length > 20) {
              console.log(`  ... and ${report.errors.length - 20} more`);
            }
          }

          if (report.warnings.length > 0) {
            console.log(`\nWarnings (${report.warnings.length}):`);
            for (const warn of report.warnings.slice(0, 10)) {
              console.log(`  [${warn.entityType}] ${warn.entityId}: ${warn.message}`);
            }
            if (report.warnings.length > 10) {
              console.log(`  ... and ${report.warnings.length - 10} more`);
            }
          }

          // ID mappings summary
          const totalMappings = Object.values(report.idMappings).reduce(
            (sum, m) => sum + Object.keys(m).length,
            0,
          );
          console.log(`\nID mappings created: ${totalMappings}`);

          // Write report to file if requested
          if (opts.output) {
            const outputPath = path.resolve(opts.output);
            fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
            console.log(`\nReport written to: ${outputPath}`);
          }

          if (opts.dryRun) {
            console.log('\n[DRY RUN] No data was written. Remove --dry-run to execute.');
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
