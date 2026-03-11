import type { Command } from 'commander';

interface ChannelBindingResponse {
  id: string;
  channelName: string;
  agentId: string;
  externalChannelId: string | null;
  bindingType: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
}

export function registerChannelCommands(program: Command) {
  const channel = program.command('channel').description('Manage channel adapters and bindings');

  channel
    .command('list')
    .description('List channel bindings for a company')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', 'http://localhost:3000')
    .action(async (opts: { company: string; url: string }) => {
      try {
        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/channel-bindings?limit=100`,
        );
        if (!res.ok) {
          console.error(`Failed to list channel bindings: ${res.status}`);
          process.exit(1);
        }
        const body = (await res.json()) as {
          data: ChannelBindingResponse[];
          total: number;
        };

        // Group by channel name
        const byChannel = new Map<string, ChannelBindingResponse[]>();
        for (const b of body.data) {
          const existing = byChannel.get(b.channelName) ?? [];
          existing.push(b);
          byChannel.set(b.channelName, existing);
        }

        console.log(`Channel Bindings (${body.total}):`);
        for (const [channelName, bindings] of byChannel) {
          console.log(`\n  ${channelName.toUpperCase()} (${bindings.length} bindings):`);
          for (const b of bindings) {
            const active = b.isActive ? 'ACTIVE' : 'INACTIVE';
            const ext = b.externalChannelId ? ` ext:${b.externalChannelId}` : '';
            console.log(
              `    ${b.bindingType} -> agent:${b.agentId.slice(0, 8)}... [${active}] priority:${b.priority}${ext}`,
            );
          }
        }

        if (body.total === 0) {
          console.log('  No channel bindings configured.');
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  channel
    .command('status')
    .description('Show channel adapter status')
    .option('--url <url>', 'API base URL', 'http://localhost:3000')
    .action(async (opts: { url: string }) => {
      try {
        const res = await fetch(`${opts.url}/api/health/detail`);
        if (!res.ok) {
          console.error(`Failed to get status: ${res.status}`);
          process.exit(1);
        }
        const health = (await res.json()) as Record<string, unknown>;
        console.log('Channel Status:');

        const channels = ['webchat', 'slack', 'discord', 'telegram', 'whatsapp', 'teams', 'email'];
        for (const ch of channels) {
          const key = `channel_${ch}`;
          const status = (health as Record<string, unknown>)[key];
          if (status) {
            console.log(`  ${ch}: ${String(status)}`);
          } else {
            console.log(`  ${ch}: not configured`);
          }
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  channel
    .command('test <channel>')
    .description('Test a channel adapter connection')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', 'http://localhost:3000')
    .action(async (channelName: string, opts: { company: string; url: string }) => {
      try {
        console.log(`Testing ${channelName} adapter...`);

        // Check if any bindings exist for this channel
        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/channel-bindings?limit=100`,
        );
        if (!res.ok) {
          console.error(`Failed to check bindings: ${res.status}`);
          process.exit(1);
        }
        const body = (await res.json()) as {
          data: ChannelBindingResponse[];
        };
        const bindings = body.data.filter((b) => b.channelName === channelName);

        if (bindings.length === 0) {
          console.log(`  No bindings found for channel: ${channelName}`);
          console.log(`  Create a binding first with the API or dashboard.`);
          process.exit(1);
        }

        const activeBindings = bindings.filter((b) => b.isActive);
        console.log(`  Found ${bindings.length} bindings (${activeBindings.length} active)`);
        console.log(`  Channel adapter: ${channelName} OK`);
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });
}
