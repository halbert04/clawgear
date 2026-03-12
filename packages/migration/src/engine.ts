import { parseOpenclawData, transformOpenclaw } from './sources/openclaw.js';
import { parseOpenfangData, transformOpenfang } from './sources/openfang.js';
import { parsePaperclipData, transformPaperclip } from './sources/paperclip.js';
import type {
  MigrationContext,
  MigrationOptions,
  MigrationReport,
  MigrationSource,
} from './types.js';

function createContext(
  source: MigrationSource,
  companyId: string,
  dryRun: boolean,
): MigrationContext {
  return {
    companyId,
    source,
    dryRun,
    idMaps: {
      companies: new Map(),
      agents: new Map(),
      goals: new Map(),
      projects: new Map(),
      issues: new Map(),
      skills: new Map(),
    },
    errors: [],
    warnings: [],
    counts: {},
  };
}

function buildReport(ctx: MigrationContext): MigrationReport {
  const hasErrors = ctx.errors.length > 0;
  const hasCounts = Object.values(ctx.counts).some((v) => v > 0);

  return {
    source: ctx.source,
    companyId: ctx.companyId,
    dryRun: ctx.dryRun,
    status: hasErrors ? (hasCounts ? 'partial' : 'failed') : 'success',
    counts: ctx.counts,
    errors: ctx.errors,
    warnings: ctx.warnings,
    idMappings: {
      companies: Object.fromEntries(ctx.idMaps.companies),
      agents: Object.fromEntries(ctx.idMaps.agents),
      goals: Object.fromEntries(ctx.idMaps.goals),
      projects: Object.fromEntries(ctx.idMaps.projects),
      issues: Object.fromEntries(ctx.idMaps.issues),
      skills: Object.fromEntries(ctx.idMaps.skills),
    },
  };
}

export interface TransformResult {
  [key: string]: Record<string, unknown>[];
}

/**
 * Run a migration from an external source.
 * In dry-run mode, transforms data and reports what would be imported without writing to DB.
 */
export function migrate(options: MigrationOptions): {
  report: MigrationReport;
  transformed: TransformResult;
} {
  const ctx = createContext(options.source, options.companyId, options.dryRun);

  let transformed: TransformResult;

  switch (options.source) {
    case 'paperclip': {
      const data = parsePaperclipData(options.data);
      transformed = transformPaperclip(data, ctx);
      break;
    }
    case 'openfang': {
      const data = parseOpenfangData(options.data);
      transformed = transformOpenfang(data, ctx);
      break;
    }
    case 'openclaw': {
      const data = parseOpenclawData(options.data);
      transformed = transformOpenclaw(data, ctx);
      break;
    }
    default:
      ctx.errors.push({
        entityType: 'migration',
        entityId: '',
        message: `Unknown migration source: ${options.source}`,
        severity: 'error',
      });
      transformed = {};
  }

  const report = buildReport(ctx);
  return { report, transformed };
}
