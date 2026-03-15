import type { Command } from 'commander';

interface WorkflowResponse {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

interface WorkflowRunResponse {
  id: string;
  workflowId: string;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  inputVars: Record<string, unknown>;
  outputVars: Record<string, unknown>;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  steps?: WorkflowStepRunResponse[];
}

interface WorkflowStepRunResponse {
  id: string;
  stepName: string;
  stepIndex: number;
  mode: string;
  status: string;
  agentId: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

async function resolveWorkflowIdByName(
  baseUrl: string,
  companyId: string,
  name: string,
): Promise<string | null> {
  const res = await fetch(`${baseUrl}/api/companies/${companyId}/workflows?limit=100`);
  if (!res.ok) return null;
  const body = (await res.json()) as { data: { id: string; name: string }[] };
  const w = body.data.find((w) => w.name.toLowerCase() === name.toLowerCase());
  return w?.id ?? null;
}

export function registerWorkflowCommands(program: Command) {
  const workflow = program.command('workflow').description('Manage automation workflows');

  workflow
    .command('list')
    .description('List workflows for a company')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (opts: { company: string; url: string }) => {
      try {
        const res = await fetch(`${opts.url}/api/companies/${opts.company}/workflows?limit=100`);
        if (!res.ok) {
          console.error(`Failed to list workflows: ${res.status}`);
          process.exit(1);
        }
        const body = (await res.json()) as { data: WorkflowResponse[]; total: number };
        console.log(`Workflows (${body.total}):`);
        for (const w of body.data) {
          const active = w.isActive ? 'active' : 'inactive';
          const created = new Date(w.createdAt).toLocaleString();
          console.log(`  ${w.name} [${active}] - ${created}`);
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  workflow
    .command('run <name>')
    .description('Execute a workflow with optional input JSON')
    .requiredOption('--company <id>', 'Company ID')
    .option('--input <json>', 'Input variables as JSON', '{}')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (name: string, opts: { company: string; input: string; url: string }) => {
      try {
        // Resolve workflow by name
        const workflowId = await resolveWorkflowIdByName(opts.url, opts.company, name);
        if (!workflowId) {
          console.error(`Workflow not found: ${name}`);
          process.exit(1);
        }

        // Parse input JSON
        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = JSON.parse(opts.input) as Record<string, unknown>;
        } catch {
          console.error('Invalid JSON input');
          process.exit(1);
        }

        console.log(`Executing workflow "${name}" (${workflowId})...`);

        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/workflows/${workflowId}/execute`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputVars: parsedInput }),
          },
        );

        if (!res.ok) {
          const body = await res.json();
          console.error(
            `Execution failed: ${(body as { message?: string }).message ?? res.statusText}`,
          );
          process.exit(1);
        }

        const result = (await res.json()) as { runId: string };
        console.log(`Workflow execution started:`);
        console.log(`  Run ID: ${result.runId}`);
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  workflow
    .command('runs <name>')
    .description('List runs for a workflow')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (name: string, opts: { company: string; url: string }) => {
      try {
        // Resolve workflow by name
        const workflowId = await resolveWorkflowIdByName(opts.url, opts.company, name);
        if (!workflowId) {
          console.error(`Workflow not found: ${name}`);
          process.exit(1);
        }

        const res = await fetch(
          `${opts.url}/api/companies/${opts.company}/workflows/${workflowId}/runs?limit=20`,
        );
        if (!res.ok) {
          console.error(`Failed to list runs: ${res.status}`);
          process.exit(1);
        }
        const body = (await res.json()) as { data: WorkflowRunResponse[]; total: number };
        console.log(`Workflow runs for "${name}" (${body.total}):`);
        for (const run of body.data) {
          const runIdShort = run.id.substring(0, 8);
          const startedAt = run.startedAt
            ? new Date(run.startedAt).toLocaleString()
            : 'not started';
          const finishedAt = run.finishedAt
            ? new Date(run.finishedAt).toLocaleString()
            : 'not finished';
          console.log(
            `  ${runIdShort} [${run.status}] - started: ${startedAt}, finished: ${finishedAt}`,
          );
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });

  workflow
    .command('status <runId>')
    .description('Show run detail with step statuses')
    .requiredOption('--company <id>', 'Company ID')
    .option('--url <url>', 'API base URL', process.env.CLAWGEAR_API_URL ?? 'http://localhost:3000')
    .action(async (runId: string, opts: { company: string; url: string }) => {
      try {
        const res = await fetch(`${opts.url}/api/companies/${opts.company}/workflow-runs/${runId}`);
        if (!res.ok) {
          console.error(`Failed to get run status: ${res.status}`);
          process.exit(1);
        }
        const run = (await res.json()) as WorkflowRunResponse;

        console.log(`Workflow Run: ${run.id}`);
        console.log(`  Status:   ${run.status}`);
        console.log(
          `  Started:  ${run.startedAt ? new Date(run.startedAt).toLocaleString() : 'not started'}`,
        );
        console.log(
          `  Finished: ${run.finishedAt ? new Date(run.finishedAt).toLocaleString() : 'not finished'}`,
        );
        console.log(`  Progress: ${run.currentStepIndex + 1}/${run.totalSteps} steps`);

        if (run.steps && run.steps.length > 0) {
          console.log('\nSteps:');
          for (const step of run.steps) {
            const agentId = step.agentId ? step.agentId.substring(0, 8) : 'none';
            const duration =
              step.startedAt && step.finishedAt
                ? `${new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()}ms`
                : '-';
            console.log(
              `  [${step.stepIndex}] ${step.stepName} (${step.mode}) - ${step.status} - agent: ${agentId} - duration: ${duration}`,
            );
            if (step.errorMessage) {
              console.log(`      Error: ${step.errorMessage}`);
            }
          }
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
    });
}
