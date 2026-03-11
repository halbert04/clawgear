import type { Command } from 'commander';

// Response types
interface TriggerResponse {
  id: string;
  name: string;
  description: string | null;
  patternType: string;
  actionType: string;
  isActive: boolean;
  fireCount: number;
  maxFireCount: number | null;
  lastFiredAt: string | null;
  cooldownMs: number;
  createdAt: string;
}

export function registerTriggerCommands(program: Command) {
  const trigger = program.command('trigger').description('Manage automation triggers');

  trigger
    .command('list')
    .description('List triggers in a company')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', 'http://localhost:3000')
    .action(async (opts: { company: string; url: string }) => {
      try {
        const res = await fetch(`${opts.url}/api/companies/${opts.company}/triggers?limit=100`);
        if (!res.ok) {
          console.error(`Failed to list triggers: ${res.status}`);
          process.exit(1);
        }
        const body = (await res.json()) as {
          data: TriggerResponse[];
          total: number;
        };
        console.log(`Triggers (${body.total}):`);
        for (const t of body.data) {
          const active = t.isActive ? 'ACTIVE' : 'INACTIVE';
          const lastFired = t.lastFiredAt
            ? ` last: ${new Date(t.lastFiredAt).toLocaleString()}`
            : '';
          console.log(
            `  ${t.name} [${t.patternType} -> ${t.actionType}] [${active}] fires: ${t.fireCount}${lastFired}`,
          );
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  trigger
    .command('create')
    .description('Create a new trigger')
    .requiredOption('--company <id>', 'Company ID')
    .requiredOption('--name <name>', 'Trigger name')
    .requiredOption('--pattern-type <type>', 'Pattern type (e.g., memory_created)')
    .requiredOption('--pattern-config <json>', 'Pattern configuration as JSON')
    .requiredOption('--action-type <type>', 'Action type (e.g., call_hand)')
    .requiredOption('--action-config <json>', 'Action configuration as JSON')
    .option('--cooldown <ms>', 'Cooldown in milliseconds', '10000')
    .option('--max-fires <n>', 'Maximum fire count')
    .option('--url <url>', 'API base URL', 'http://localhost:3000')
    .action(
      async (opts: {
        company: string;
        name: string;
        patternType: string;
        patternConfig: string;
        actionType: string;
        actionConfig: string;
        cooldown: string;
        maxFires?: string;
        url: string;
      }) => {
        try {
          let patternConfig: unknown;
          let actionConfig: unknown;

          try {
            patternConfig = JSON.parse(opts.patternConfig);
          } catch {
            console.error('Invalid pattern-config JSON');
            process.exit(1);
          }

          try {
            actionConfig = JSON.parse(opts.actionConfig);
          } catch {
            console.error('Invalid action-config JSON');
            process.exit(1);
          }

          const body = {
            name: opts.name,
            patternType: opts.patternType,
            patternConfig,
            actionType: opts.actionType,
            actionConfig,
            cooldownMs: Number.parseInt(opts.cooldown, 10),
            maxFireCount: opts.maxFires ? Number.parseInt(opts.maxFires, 10) : null,
          };

          const res = await fetch(`${opts.url}/api/companies/${opts.company}/triggers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const body = await res.json();
            console.error(`Failed: ${(body as { message?: string }).message ?? res.statusText}`);
            process.exit(1);
          }

          const trigger = (await res.json()) as TriggerResponse;
          console.log(
            `Trigger created: ${trigger.name} [${trigger.patternType} -> ${trigger.actionType}] (${trigger.id})`,
          );
        } catch (err) {
          console.error('Error:', (err as Error).message);
          process.exit(1);
        }
      },
    );

  trigger
    .command('activate <name>')
    .description('Activate a trigger')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', 'http://localhost:3000')
    .action(async (name: string, opts: { company: string; url: string }) => {
      try {
        const triggerId = await resolveTriggerIdByName(opts.url, opts.company, name);
        if (!triggerId) {
          console.error(`Trigger not found: ${name}`);
          process.exit(1);
        }

        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/triggers/${triggerId}/activate`,
          { method: 'POST' },
        );

        if (!res.ok) {
          const body = await res.json();
          console.error(`Failed: ${(body as { message?: string }).message ?? res.statusText}`);
          process.exit(1);
        }

        console.log(`Trigger activated: ${name}`);
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  trigger
    .command('deactivate <name>')
    .description('Deactivate a trigger')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', 'http://localhost:3000')
    .action(async (name: string, opts: { company: string; url: string }) => {
      try {
        const triggerId = await resolveTriggerIdByName(opts.url, opts.company, name);
        if (!triggerId) {
          console.error(`Trigger not found: ${name}`);
          process.exit(1);
        }

        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/triggers/${triggerId}/deactivate`,
          { method: 'POST' },
        );

        if (!res.ok) {
          const body = await res.json();
          console.error(`Failed: ${(body as { message?: string }).message ?? res.statusText}`);
          process.exit(1);
        }

        console.log(`Trigger deactivated: ${name}`);
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  trigger
    .command('history <name>')
    .description('Show trigger detail and history')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', 'http://localhost:3000')
    .action(async (name: string, opts: { company: string; url: string }) => {
      try {
        const triggerId = await resolveTriggerIdByName(opts.url, opts.company, name);
        if (!triggerId) {
          console.error(`Trigger not found: ${name}`);
          process.exit(1);
        }

        const res = await fetch(`${opts.url}/api/companies/${opts.company}/triggers/${triggerId}`);
        if (!res.ok) {
          console.error(`Failed: ${res.statusText}`);
          process.exit(1);
        }

        const t = (await res.json()) as TriggerResponse;
        console.log(`Trigger: ${t.name}`);
        console.log(`  Pattern Type:  ${t.patternType}`);
        console.log(`  Action Type:   ${t.actionType}`);
        console.log(`  Status:        ${t.isActive ? 'ACTIVE' : 'INACTIVE'}`);
        console.log(`  Fire Count:    ${t.fireCount}`);
        console.log(`  Max Fires:     ${t.maxFireCount ?? 'unlimited'}`);
        console.log(
          `  Last Fired:    ${t.lastFiredAt ? new Date(t.lastFiredAt).toLocaleString() : 'never'}`,
        );
        console.log(`  Cooldown:      ${t.cooldownMs}ms`);
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });
}

async function resolveTriggerIdByName(
  baseUrl: string,
  companyId: string,
  name: string,
): Promise<string | null> {
  const res = await fetch(`${baseUrl}/api/companies/${companyId}/triggers?limit=100`);
  if (!res.ok) return null;
  const body = (await res.json()) as { data: { id: string; name: string }[] };
  const trigger = body.data.find((t) => t.name.toLowerCase() === name.toLowerCase());
  return trigger?.id ?? null;
}
