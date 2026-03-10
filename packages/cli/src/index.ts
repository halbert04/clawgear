#!/usr/bin/env bun
import { program } from 'commander';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';

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

program.parse();
