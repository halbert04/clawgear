import type { Command } from 'commander';

interface HandResponse {
  id: string;
  name: string;
  status: string;
  nextRunAt: string | null;
  schedule?: string | null;
  outputMode?: string | null;
  requiresApproval?: boolean;
}

interface HandRunResponse {
  runId: string;
  status: string;
  output?: string;
  durationMs: number;
  usage?: { inputTokens: number; outputTokens: number; costCents: number };
}

export function registerHandCommands(program: Command) {
  const hand = program.command('hand').description('Manage autonomous hands');

  hand
    .command('list')
    .description('List hands in a company')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (opts: { company: string; url: string }) => {
      try {
        const res = await fetch(`${opts.url}/api/companies/${opts.company}/hands?limit=100`);
        if (!res.ok) {
          console.error(`Failed to list hands: ${res.status}`);
          process.exit(1);
        }
        const body = (await res.json()) as {
          data: HandResponse[];
          total: number;
        };
        console.log(`Hands (${body.total}):`);
        for (const h of body.data) {
          const next = h.nextRunAt ? ` next: ${new Date(h.nextRunAt).toLocaleString()}` : '';
          console.log(`  ${h.name} [${h.status}]${next} (${h.id})`);
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  hand
    .command('activate <name>')
    .description('Create and activate a hand from a template')
    .requiredOption('--company <id>', 'Company ID')
    .option('--owner <agentId>', 'Owner agent ID for cost attribution')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (name: string, opts: { company: string; owner?: string; url: string }) => {
      try {
        const res = await fetch(`${opts.url}/api/companies/${opts.company}/hands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            companyId: opts.company,
            ownerAgentId: opts.owner ?? null,
          }),
        });

        if (!res.ok) {
          const body = await res.json();
          console.error(`Failed: ${(body as { message?: string }).message ?? res.statusText}`);
          process.exit(1);
        }

        const hand = (await res.json()) as HandResponse;
        console.log(`Hand activated: ${hand.name} [${hand.status}] (${hand.id})`);
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  hand
    .command('deactivate <name>')
    .description('Deactivate a hand')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (name: string, opts: { company: string; url: string }) => {
      try {
        const handId = await resolveHandId(opts.url, opts.company, name);
        if (!handId) {
          console.error(`Hand not found: ${name}`);
          process.exit(1);
        }

        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/hands/${handId}/deactivate`,
          { method: 'POST' },
        );

        if (!res.ok) {
          const body = await res.json();
          console.error(`Failed: ${(body as { message?: string }).message ?? res.statusText}`);
          process.exit(1);
        }

        console.log(`Hand deactivated: ${name}`);
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  hand
    .command('status <name>')
    .description('Show hand status and schedule info')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (name: string, opts: { company: string; url: string }) => {
      try {
        const handId = await resolveHandId(opts.url, opts.company, name);
        if (!handId) {
          console.error(`Hand not found: ${name}`);
          process.exit(1);
        }

        const res = await fetch(`${opts.url}/api/companies/${opts.company}/hands/${handId}`);
        if (!res.ok) {
          console.error(`Failed: ${res.statusText}`);
          process.exit(1);
        }

        const hand = (await res.json()) as HandResponse;
        console.log(`Hand: ${hand.name}`);
        console.log(`  Status:            ${hand.status}`);
        console.log(`  Schedule:          ${hand.schedule ?? 'none'}`);
        console.log(`  Output Mode:       ${hand.outputMode ?? 'unknown'}`);
        console.log(`  Requires Approval: ${hand.requiresApproval ? 'yes' : 'no'}`);
        console.log(
          `  Next Run:          ${hand.nextRunAt ? new Date(hand.nextRunAt).toLocaleString() : 'not scheduled'}`,
        );
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  hand
    .command('trigger <name>')
    .description('Manually trigger a hand execution')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (name: string, opts: { company: string; url: string }) => {
      try {
        const handId = await resolveHandId(opts.url, opts.company, name);
        if (!handId) {
          console.error(`Hand not found: ${name}`);
          process.exit(1);
        }

        console.log(`Triggering hand "${name}"...`);

        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/hands/${handId}/trigger`,
          { method: 'POST' },
        );

        if (!res.ok) {
          const body = await res.json();
          console.error(
            `Trigger failed: ${(body as { message?: string }).message ?? res.statusText}`,
          );
          process.exit(1);
        }

        const result = (await res.json()) as HandRunResponse;
        console.log('Hand execution completed:');
        console.log(`  Run ID:   ${result.runId}`);
        console.log(`  Status:   ${result.status}`);
        console.log(`  Duration: ${result.durationMs}ms`);
        if (result.usage) {
          console.log(
            `  Tokens:   ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`,
          );
          console.log(`  Cost:     ${result.usage.costCents} cents`);
        }
        if (result.output) {
          console.log(`\nOutput:\n${result.output}`);
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });
}

async function resolveHandId(
  baseUrl: string,
  companyId: string,
  name: string,
): Promise<string | null> {
  const res = await fetch(`${baseUrl}/api/companies/${companyId}/hands?limit=100`);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    data: { id: string; name: string }[];
  };
  const hand = body.data.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return hand?.id ?? null;
}
