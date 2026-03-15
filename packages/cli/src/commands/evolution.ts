import type { Command } from 'commander';

interface SkillResponse {
  id: string;
  name: string;
  version: number;
  status: string;
  usageCount: number;
  proposedByAgentId: string;
  description: string;
}

interface CompetenceResponse {
  taskType: string;
  totalAgents: number;
  avgSuccessRate: number;
  avgQuality: number;
  totalRuns: number;
}

export function registerEvolutionCommands(program: Command) {
  const evolution = program.command('evolution').description('Manage evolution systems');

  // -------------------------------------------------------
  // Skills
  // -------------------------------------------------------

  evolution
    .command('skills')
    .description('List evolved skills')
    .requiredOption('--company <id>', 'Company ID')
    .option('--status <status>', 'Filter by status (proposed/approved/active/deprecated)')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (opts: { company: string; status?: string; url: string }) => {
      try {
        const params = new URLSearchParams({ limit: '100' });
        if (opts.status) params.set('status', opts.status);

        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/evolution/skills?${params}`,
        );
        if (!res.ok) {
          console.error(`Failed: ${res.status}`);
          process.exit(1);
        }
        const body = (await res.json()) as { data: SkillResponse[]; total: number };
        console.log(`Skills (${body.total}):`);
        for (const s of body.data) {
          console.log(`  ${s.name} v${s.version} [${s.status}] uses:${s.usageCount} (${s.id})`);
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  evolution
    .command('skill-approve')
    .description('Approve a proposed skill')
    .requiredOption('--company <id>', 'Company ID')
    .requiredOption('--skill <id>', 'Skill ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (opts: { company: string; skill: string; url: string }) => {
      try {
        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/evolution/skills/${opts.skill}/status`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'active' }),
          },
        );
        if (!res.ok) {
          console.error(`Failed: ${res.status}`);
          process.exit(1);
        }
        const skill = (await res.json()) as SkillResponse;
        console.log(`Approved: ${skill.name} v${skill.version} → active`);
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  // -------------------------------------------------------
  // Competence
  // -------------------------------------------------------

  evolution
    .command('competence')
    .description('Show team competence dashboard')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (opts: { company: string; url: string }) => {
      try {
        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/evolution/competence/team`,
        );
        if (!res.ok) {
          console.error(`Failed: ${res.status}`);
          process.exit(1);
        }
        const body = (await res.json()) as { data: CompetenceResponse[] };
        console.log('Team Competence:');
        console.log(
          '  Task Type                  | Agents | Success Rate | Avg Quality | Total Runs',
        );
        console.log(`  ${'-'.repeat(80)}`);
        for (const c of body.data) {
          const sr = c.avgSuccessRate != null ? `${(c.avgSuccessRate * 100).toFixed(0)}%` : 'N/A';
          const aq = c.avgQuality != null ? c.avgQuality.toFixed(2) : 'N/A';
          console.log(
            `  ${c.taskType.padEnd(28)} | ${String(c.totalAgents).padStart(6)} | ${sr.padStart(12)} | ${aq.padStart(11)} | ${String(c.totalRuns).padStart(10)}`,
          );
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  // -------------------------------------------------------
  // Prompts
  // -------------------------------------------------------

  evolution
    .command('prompts')
    .description('List prompt versions')
    .requiredOption('--company <id>', 'Company ID')
    .option('--role <role>', 'Filter by agent role')
    .option('--type <type>', 'Filter by prompt type (heartbeat/system/skill)')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (opts: { company: string; role?: string; type?: string; url: string }) => {
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (opts.role) params.set('agentRole', opts.role);
        if (opts.type) params.set('promptType', opts.type);

        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/evolution/prompts?${params}`,
        );
        if (!res.ok) {
          console.error(`Failed: ${res.status}`);
          process.exit(1);
        }
        const body = (await res.json()) as {
          data: {
            id: string;
            agentRole: string;
            promptType: string;
            version: number;
            isActive: boolean;
            isAbTesting: boolean;
            evaluationScore: number | null;
          }[];
          total: number;
        };
        console.log(`Prompt Versions (${body.total}):`);
        for (const p of body.data) {
          const flags = [p.isActive ? 'ACTIVE' : '', p.isAbTesting ? 'A/B' : '']
            .filter(Boolean)
            .join(',');
          const score = p.evaluationScore != null ? p.evaluationScore.toFixed(3) : '-';
          console.log(
            `  ${p.agentRole}/${p.promptType} v${p.version} [${flags || 'inactive'}] score:${score} (${p.id})`,
          );
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  // -------------------------------------------------------
  // Strategies
  // -------------------------------------------------------

  evolution
    .command('strategies')
    .description('List strategy patterns')
    .requiredOption('--company <id>', 'Company ID')
    .option('--type <type>', 'Filter by pattern type')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (opts: { company: string; type?: string; url: string }) => {
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (opts.type) params.set('patternType', opts.type);

        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/evolution/strategies?${params}`,
        );
        if (!res.ok) {
          console.error(`Failed: ${res.status}`);
          process.exit(1);
        }
        const body = (await res.json()) as {
          data: {
            id: string;
            patternType: string;
            description: string;
            confidence: number;
            successCount: number;
            failureCount: number;
          }[];
          total: number;
        };
        console.log(`Strategy Patterns (${body.total}):`);
        for (const s of body.data) {
          const total = s.successCount + s.failureCount;
          console.log(
            `  [${s.patternType}] ${s.description.slice(0, 50)} conf:${s.confidence.toFixed(2)} (${s.successCount}/${total}) (${s.id})`,
          );
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });
}
