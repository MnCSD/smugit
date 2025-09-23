import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { GitAnalyzer } from '../git';
import { isValidConventionalCommit } from '@smugit/shared';

export const commitCommand = new Command('commit')
  .alias('c')
  .description('Generate and create intelligent commit messages')
  .option('-m, --message <message>', 'Use custom commit message')
  .option('-a, --auto', 'Automatically generate and commit')
  .option('-i, --interactive', 'Interactive commit message creation')
  .option('-d, --dry-run', 'Show suggested commit message without committing')
  .action(async (options) => {
    const spinner = ora('Analyzing changes...').start();

    try {
      const analyzer = new GitAnalyzer();
      const repo = await analyzer.analyzeRepository();

      // Check if there are any changes to commit
      const hasStaged = repo.status.staged.length > 0;
      const hasModified = repo.status.modified.length > 0;

      if (!hasStaged && !hasModified) {
        spinner.fail('No changes to commit');
        console.log(chalk.yellow('💡 Make some changes first, then run this command again'));
        return;
      }

      spinner.text = 'Generating commit suggestion...';
      const suggestion = await analyzer.generateCommitSuggestion();
      spinner.succeed('Commit analysis complete');

      // Display current status
      displayChangeSummary(repo.status);

      // Handle different modes
      if (options.message) {
        await handleCustomMessage(options.message, options.dryRun);
      } else if (options.auto) {
        await handleAutoCommit(suggestion, options.dryRun);
      } else {
        await handleInteractiveCommit(suggestion, options.dryRun);
      }

    } catch (error) {
      spinner.fail('Commit operation failed');
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

function displayChangeSummary(status: any) {
  console.log('');
  console.log(chalk.bold.blue('📝 Change Summary'));
  console.log(chalk.gray('─'.repeat(50)));

  if (status.staged.length > 0) {
    console.log(`${chalk.bold('Staged files:')} ${chalk.green(status.staged.length)}`);
    status.staged.forEach((file: string) => {
      console.log(`  ${chalk.green('+')} ${file}`);
    });
  }

  if (status.modified.length > 0) {
    console.log(`${chalk.bold('Modified files:')} ${chalk.yellow(status.modified.length)} ${chalk.dim('(not staged)')}`);
    status.modified.slice(0, 5).forEach((file: string) => {
      console.log(`  ${chalk.yellow('M')} ${file}`);
    });
    if (status.modified.length > 5) {
      console.log(`  ${chalk.dim(`... and ${status.modified.length - 5} more`)}`);
    }
  }
}

async function handleCustomMessage(message: string, dryRun: boolean) {
  console.log('');
  console.log(chalk.bold('✏️  Custom Commit Message'));
  console.log(chalk.gray('─'.repeat(50)));

  const isConventional = isValidConventionalCommit(message);

  console.log(`${chalk.bold('Message:')} ${message}`);
  console.log(`${chalk.bold('Format:')} ${isConventional ? chalk.green('✓ Conventional') : chalk.yellow('⚠ Non-conventional')}`);

  if (!isConventional) {
    console.log(chalk.yellow('💡 Consider using conventional commit format: type(scope): description'));
  }

  if (dryRun) {
    console.log(chalk.blue('🔍 Dry run - would commit with this message'));
    return;
  }

  const proceed = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Proceed with this commit message?',
      default: true,
    },
  ]);

  if (proceed.confirm) {
    await executeCommit(message);
  } else {
    console.log(chalk.yellow('Commit cancelled'));
  }
}

async function handleAutoCommit(suggestion: any, dryRun: boolean) {
  const conventionalMessage = formatConventionalCommit(suggestion);

  console.log('');
  console.log(chalk.bold.green('🤖 Auto-Generated Commit'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`${chalk.bold('Message:')} ${conventionalMessage}`);
  console.log(`${chalk.bold('Confidence:')} ${getConfidenceIndicator(suggestion.confidence)}`);

  if (dryRun) {
    console.log(chalk.blue('🔍 Dry run - would commit with this message'));
    return;
  }

  if (suggestion.confidence < 0.7) {
    console.log(chalk.yellow('⚠️  Low confidence - consider reviewing the message'));

    const proceed = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Proceed with auto-generated commit?',
        default: false,
      },
    ]);

    if (!proceed.confirm) {
      console.log(chalk.yellow('Auto-commit cancelled - try interactive mode'));
      return;
    }
  }

  await executeCommit(conventionalMessage);
}

async function handleInteractiveCommit(suggestion: any, dryRun: boolean) {
  console.log('');
  console.log(chalk.bold.cyan('🎯 Interactive Commit'));
  console.log(chalk.gray('─'.repeat(50)));

  const suggestedMessage = formatConventionalCommit(suggestion);

  console.log(`${chalk.bold('Suggested:')} ${suggestedMessage}`);
  console.log(`${chalk.bold('Confidence:')} ${getConfidenceIndicator(suggestion.confidence)}`);

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Use suggested message', value: 'use' },
        { name: 'Edit suggested message', value: 'edit' },
        { name: 'Create custom message', value: 'custom' },
        { name: 'Cancel', value: 'cancel' },
      ],
    },
  ]);

  switch (answers.action) {
    case 'use':
      if (dryRun) {
        console.log(chalk.blue('🔍 Dry run - would commit with suggested message'));
        return;
      }
      await executeCommit(suggestedMessage);
      break;

    case 'edit':
      const edited = await inquirer.prompt([
        {
          type: 'input',
          name: 'message',
          message: 'Edit commit message:',
          default: suggestedMessage,
          validate: (input: string) => {
            if (!input.trim()) {
              return 'Commit message cannot be empty';
            }
            return true;
          },
        },
      ]);

      if (dryRun) {
        console.log(chalk.blue('🔍 Dry run - would commit with edited message'));
        console.log(`Message: ${edited.message}`);
        return;
      }

      await executeCommit(edited.message);
      break;

    case 'custom':
      const custom = await inquirer.prompt([
        {
          type: 'input',
          name: 'message',
          message: 'Enter custom commit message:',
          validate: (input: string) => {
            if (!input.trim()) {
              return 'Commit message cannot be empty';
            }
            return true;
          },
        },
      ]);

      if (dryRun) {
        console.log(chalk.blue('🔍 Dry run - would commit with custom message'));
        console.log(`Message: ${custom.message}`);
        return;
      }

      await executeCommit(custom.message);
      break;

    case 'cancel':
      console.log(chalk.yellow('Commit cancelled'));
      break;
  }
}

function formatConventionalCommit(suggestion: any): string {
  let message = suggestion.type;

  if (suggestion.scope) {
    message += `(${suggestion.scope})`;
  }

  message += `: ${suggestion.description}`;

  if (suggestion.body) {
    message += `\n\n${suggestion.body}`;
  }

  if (suggestion.footer) {
    message += `\n\n${suggestion.footer}`;
  }

  return message;
}

function getConfidenceIndicator(confidence: number): string {
  if (confidence >= 0.8) {
    return `${chalk.green('●●●')} ${chalk.green(`${Math.round(confidence * 100)}% High`)}`;
  } else if (confidence >= 0.6) {
    return `${chalk.yellow('●●○')} ${chalk.yellow(`${Math.round(confidence * 100)}% Medium`)}`;
  } else {
    return `${chalk.red('●○○')} ${chalk.red(`${Math.round(confidence * 100)}% Low`)}`;
  }
}

async function executeCommit(message: string) {
  const spinner = ora('Creating commit...').start();

  try {
    // Use Node.js child_process to execute git commit
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`);

    spinner.succeed('Commit created successfully');
    console.log(chalk.green('✅ Commit created:'), chalk.cyan(message.split('\n')[0]));

    // Show next steps
    console.log('');
    console.log(chalk.bold('💡 Next steps:'));
    console.log(`  ${chalk.cyan('git push')} - Push changes to remote`);
    console.log(`  ${chalk.cyan('smugit status')} - Check repository status`);

  } catch (error) {
    spinner.fail('Commit failed');
    throw error;
  }
}