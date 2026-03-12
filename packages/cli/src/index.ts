#!/usr/bin/env bun
import { program } from 'commander';
import { registerAgentCommands } from './commands/agent.js';
import { registerChannelCommands } from './commands/channel.js';
import { registerEvolutionCommands } from './commands/evolution.js';
import { registerHandCommands } from './commands/hand.js';
import { initCommand } from './commands/init.js';
import { registerIssueCommands } from './commands/issue.js';
import { registerMarketplaceCommands } from './commands/marketplace.js';
import { registerMigrationCommands } from './commands/migration.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { registerTriggerCommands } from './commands/trigger.js';
import { registerWorkflowCommands } from './commands/workflow.js';

program.name('clawgear').description('CEO Agent Operating System').version('0.1.0');

program
  .command('init')
  .description('Initialize ClawGear (creates config, runs migrations)')
  .action(initCommand);

program
  .command('start')
  .description('Launch the API server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .action(startCommand);

program
  .command('status')
  .description('Check system health')
  .option('-u, --url <url>', 'API base URL', 'http://localhost:3000')
  .action(statusCommand);

registerAgentCommands(program);
registerIssueCommands(program);
registerHandCommands(program);
registerChannelCommands(program);
registerEvolutionCommands(program);
registerTriggerCommands(program);
registerWorkflowCommands(program);
registerMarketplaceCommands(program);
registerMigrationCommands(program);

program.parse();
