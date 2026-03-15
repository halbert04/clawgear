import type { Command } from 'commander';

export function registerAgentCommands(program: Command) {
  const agent = program.command('agent').description('Manage agents');

  agent
    .command('heartbeat <name>')
    .description('Trigger a heartbeat for an agent')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (name: string, opts: { company: string; url: string }) => {
      try {
        // First look up agent by name
        const agentsRes = await fetch(`${opts.url}/api/companies/${opts.company}/agents?limit=100`);
        if (!agentsRes.ok) {
          console.error(`Failed to list agents: ${agentsRes.status}`);
          process.exit(1);
        }
        const agentsBody = (await agentsRes.json()) as {
          data: { id: string; name: string }[];
        };
        const agent = agentsBody.data.find((a) => a.name.toLowerCase() === name.toLowerCase());
        if (!agent) {
          console.error(`Agent not found: ${name}`);
          process.exit(1);
        }

        console.log(`Triggering heartbeat for agent "${agent.name}" (${agent.id})...`);

        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/agents/${agent.id}/heartbeats`,
          { method: 'POST' },
        );

        if (!res.ok) {
          const body = await res.json();
          console.error(
            `Heartbeat failed: ${(body as { message?: string }).message ?? res.statusText}`,
          );
          process.exit(1);
        }

        const result = (await res.json()) as {
          runId: string;
          status: string;
          output?: string;
          durationMs: number;
          usage?: { inputTokens: number; outputTokens: number; costCents: number };
        };
        console.log(`Heartbeat completed:`);
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

  agent
    .command('list')
    .description('List agents in a company')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (opts: { company: string; url: string }) => {
      try {
        const res = await fetch(`${opts.url}/api/companies/${opts.company}/agents?limit=100`);
        if (!res.ok) {
          console.error(`Failed to list agents: ${res.status}`);
          process.exit(1);
        }
        const body = (await res.json()) as {
          data: { id: string; name: string; role: string; status: string }[];
          total: number;
        };
        console.log(`Agents (${body.total}):`);
        for (const a of body.data) {
          console.log(`  ${a.name} [${a.role}] - ${a.status} (${a.id})`);
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  agent
    .command('spawn')
    .description('Create a new agent')
    .requiredOption('--company <id>', 'Company ID')
    .requiredOption('--name <name>', 'Agent name')
    .requiredOption('--role <role>', 'Agent role')
    .option('--adapter <type>', 'Adapter type', 'claude_code')
    .option('--model-tier <tier>', 'Model tier', 'smart')
    .option('--system-prompt <prompt>', 'System prompt')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(
      async (opts: {
        company: string;
        name: string;
        role: string;
        adapter: string;
        modelTier: string;
        systemPrompt?: string;
        url: string;
      }) => {
        try {
          const res = await fetch(`${opts.url}/api/companies/${opts.company}/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: opts.name,
              role: opts.role,
              adapterType: opts.adapter,
              modelTier: opts.modelTier,
              systemPrompt: opts.systemPrompt ?? null,
            }),
          });

          if (!res.ok) {
            const body = await res.json();
            console.error(`Failed: ${(body as { message?: string }).message ?? res.statusText}`);
            process.exit(1);
          }

          const agent = (await res.json()) as { id: string; name: string; role: string };
          console.log(`Agent created: ${agent.name} [${agent.role}] (${agent.id})`);
        } catch (err) {
          console.error('Error:', (err as Error).message);
          process.exit(1);
        }
      },
    );
}
