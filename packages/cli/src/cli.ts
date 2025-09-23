#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import { analyzeCommand } from './commands/analyze';
import { fixCommand } from './commands/fix';
import { commitCommand } from './commands/commit';
import { statusCommand } from './commands/status';

const program = new Command();

// ASCII art for Smugit
const logo = `
███████╗███╗   ███╗██╗   ██╗ ██████╗ ██╗████████╗
██╔════╝████╗ ████║██║   ██║██╔════╝ ██║╚══██╔══╝
███████╗██╔████╔██║██║   ██║██║  ███╗██║   ██║
╚════██║██║╚██╔╝██║██║   ██║██║   ██║██║   ██║
███████║██║ ╚═╝ ██║╚██████╔╝╚██████╔╝██║   ██║
╚══════╝╚═╝     ╚═╝ ╚═════╝  ╚═════╝ ╚═╝   ╚═╝
`;

function showWelcome() {
  console.log(chalk.cyan(logo));
  console.log(
    boxen(
      `${chalk.bold('Smugit - Frictionless Git for Teams')}\n\n` +
      `${chalk.gray('Git, but smoooth.')}\n\n` +
      `Run ${chalk.cyan('smugit --help')} to get started.`,
      {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
      }
    )
  );
}

// Configure the main program
program
  .name('smugit')
  .description('Frictionless Git for Teams - Git, but smoooth.')
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--no-color', 'Disable colored output')
  .hook('preAction', (thisCommand) => {
    // Set global options
    const opts = thisCommand.opts();
    if (opts.noColor) {
      chalk.level = 0;
    }
  });

// Add commands
program.addCommand(analyzeCommand);
program.addCommand(fixCommand);
program.addCommand(commitCommand);
program.addCommand(statusCommand);

// Special handling for no arguments - show welcome
if (process.argv.length === 2) {
  showWelcome();
  process.exit(0);
}

// Global error handler
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught Exception:'), error);
  process.exit(1);
});

// Parse command line arguments
program.parse();