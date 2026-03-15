import type { Command } from 'commander';

export function registerIssueCommands(program: Command) {
  const issue = program.command('issue').description('Manage issues');

  issue
    .command('create')
    .description('Create a new issue')
    .requiredOption('--company <id>', 'Company ID')
    .requiredOption('--title <title>', 'Issue title')
    .option('--description <desc>', 'Issue description')
    .option('--priority <priority>', 'Priority (critical/high/medium/low)', 'medium')
    .option('--assignee <agentId>', 'Assign to agent ID')
    .option('--project <projectId>', 'Project ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(
      async (opts: {
        company: string;
        title: string;
        description?: string;
        priority: string;
        assignee?: string;
        project?: string;
        url: string;
      }) => {
        try {
          const res = await fetch(`${opts.url}/api/companies/${opts.company}/issues`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: opts.title,
              description: opts.description ?? null,
              priority: opts.priority,
              assigneeAgentId: opts.assignee ?? null,
              projectId: opts.project ?? null,
            }),
          });

          if (!res.ok) {
            const body = await res.json();
            console.error(`Failed: ${(body as { message?: string }).message ?? res.statusText}`);
            process.exit(1);
          }

          const iss = (await res.json()) as {
            id: string;
            identifier: string;
            title: string;
            status: string;
          };
          console.log(`Issue created: ${iss.identifier} - ${iss.title} [${iss.status}]`);
        } catch (err) {
          console.error('Error:', (err as Error).message);
          process.exit(1);
        }
      },
    );

  issue
    .command('list')
    .description('List issues in a company')
    .requiredOption('--company <id>', 'Company ID')
    .option('--status <status>', 'Filter by status')
    .option('--assignee <agentId>', 'Filter by assignee')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (opts: { company: string; status?: string; assignee?: string; url: string }) => {
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (opts.status) params.set('status', opts.status);
        if (opts.assignee) params.set('assigneeAgentId', opts.assignee);

        const res = await fetch(`${opts.url}/api/companies/${opts.company}/issues?${params}`);

        if (!res.ok) {
          console.error(`Failed: ${res.status}`);
          process.exit(1);
        }

        const body = (await res.json()) as {
          data: {
            identifier: string;
            title: string;
            status: string;
            priority: string;
            assigneeAgentId: string | null;
          }[];
          total: number;
        };
        console.log(`Issues (${body.total}):`);
        for (const i of body.data) {
          const assignee = i.assigneeAgentId ? ` -> ${i.assigneeAgentId.slice(0, 8)}` : '';
          console.log(`  ${i.identifier} [${i.priority}] ${i.title} (${i.status})${assignee}`);
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  issue
    .command('assign <identifier>')
    .description('Assign an issue to an agent')
    .requiredOption('--company <id>', 'Company ID')
    .requiredOption('--agent <agentId>', 'Agent ID to assign')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (identifier: string, opts: { company: string; agent: string; url: string }) => {
      try {
        // Find issue by identifier
        const listRes = await fetch(`${opts.url}/api/companies/${opts.company}/issues?limit=100`);
        if (!listRes.ok) {
          console.error(`Failed to list issues: ${listRes.status}`);
          process.exit(1);
        }
        const listBody = (await listRes.json()) as {
          data: { id: string; identifier: string; title: string }[];
        };
        const issue = listBody.data.find(
          (i) => i.identifier.toLowerCase() === identifier.toLowerCase(),
        );
        if (!issue) {
          console.error(`Issue not found: ${identifier}`);
          process.exit(1);
        }

        const res = await fetch(`${opts.url}/api/companies/${opts.company}/issues/${issue.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigneeAgentId: opts.agent }),
        });

        if (!res.ok) {
          const body = await res.json();
          console.error(`Failed: ${(body as { message?: string }).message ?? res.statusText}`);
          process.exit(1);
        }

        console.log(`Issue ${identifier} assigned to agent ${opts.agent.slice(0, 8)}...`);
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });
}
