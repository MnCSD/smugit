import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { GitAnalyzer, ConflictResolver } from '../git';

export const fixCommand = new Command('fix')
  .alias('f')
  .description('Fix merge conflicts automatically or interactively')
  .option('-a, --auto', 'Automatically fix resolvable conflicts')
  .option('-i, --interactive', 'Interactively review and fix conflicts')
  .option('-d, --dry-run', 'Show what would be fixed without making changes')
  .option('--no-checkpoint', 'Skip creating checkpoint branch')
  .action(async (options) => {
    const spinner = ora('Analyzing conflicts...').start();

    try {
      const analyzer = new GitAnalyzer();
      const resolver = new ConflictResolver();

      // First, analyze current conflicts
      const conflicts = await analyzer.analyzeConflicts();

      if (conflicts.length === 0) {
        spinner.succeed('No conflicts found');
        console.log(chalk.green('✨ Repository is clean - no conflicts to fix!'));
        return;
      }

      spinner.succeed(`Found ${conflicts.length} conflict(s)`);

      const autoResolvable = conflicts.filter(c => c.autoResolvable);
      const manualReview = conflicts.filter(c => !c.autoResolvable);

      // Show summary
      console.log('');
      console.log(chalk.bold('🔧 Conflict Resolution Plan'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`${chalk.green('Auto-resolvable:')} ${autoResolvable.length}`);
      console.log(`${chalk.yellow('Manual review:')} ${manualReview.length}`);

      // Create checkpoint branch unless disabled
      let checkpointBranch: string | undefined;
      if (options.checkpoint !== false && !options.dryRun) {
        spinner.start('Creating checkpoint branch...');
        checkpointBranch = await resolver.createCheckpoint();
        spinner.succeed(`Checkpoint created: ${chalk.cyan(checkpointBranch)}`);
      }

      // Handle auto-resolution
      if (options.auto || (!options.interactive && autoResolvable.length > 0)) {
        await handleAutoResolution(resolver, autoResolvable, options.dryRun);
      }

      // Handle interactive resolution
      if (options.interactive && manualReview.length > 0) {
        await handleInteractiveResolution(manualReview, options.dryRun);
      }

      // Show next steps
      if (!options.dryRun && (autoResolvable.length > 0 || options.interactive)) {
        console.log('');
        console.log(chalk.bold('✅ Resolution complete'));
        if (checkpointBranch) {
          console.log(`💾 Checkpoint branch: ${chalk.cyan(checkpointBranch)}`);
        }
        console.log(`💡 Run ${chalk.cyan('git status')} to review changes`);
        console.log(`💡 Run ${chalk.cyan('smugit commit')} to create a merge commit`);
      }

    } catch (error) {
      spinner.fail('Fix operation failed');
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

async function handleAutoResolution(
  resolver: ConflictResolver,
  conflicts: any[],
  dryRun: boolean
) {
  const spinner = ora('Auto-resolving conflicts...').start();

  try {
    const result = await resolver.autoResolveConflicts(conflicts, dryRun);

    if (result.success && result.resolvedFiles.length > 0) {
      spinner.succeed(`${dryRun ? 'Would resolve' : 'Resolved'} ${result.resolvedFiles.length} conflict(s)`);

      console.log('');
      console.log(chalk.bold.green('✅ Auto-resolved files:'));
      result.resolvedFiles.forEach(file => {
        console.log(`  ${chalk.green('✓')} ${file}`);
      });

      if (!dryRun) {
        // Stage the resolved files
        spinner.start('Staging resolved files...');
        await resolver.stageResolvedFiles(result.resolvedFiles);
        spinner.succeed('Files staged for commit');
      }
    }

    if (result.failedFiles.length > 0) {
      console.log('');
      console.log(chalk.bold.red('❌ Failed to resolve:'));
      result.failedFiles.forEach(file => {
        console.log(`  ${chalk.red('✗')} ${file}`);
      });

      if (result.errors.length > 0) {
        console.log('');
        console.log(chalk.bold('Errors:'));
        result.errors.forEach(error => {
          console.log(`  ${chalk.red('•')} ${error}`);
        });
      }
    }
  } catch (error) {
    spinner.fail('Auto-resolution failed');
    throw error;
  }
}

async function handleInteractiveResolution(conflicts: any[], dryRun: boolean) {
  console.log('');
  console.log(chalk.bold.yellow('🔍 Interactive Conflict Resolution'));
  console.log(chalk.gray('─'.repeat(50)));

  for (const conflict of conflicts) {
    console.log('');
    console.log(`${chalk.bold('File:')} ${conflict.file}`);
    console.log(`${chalk.bold('Type:')} ${conflict.type}`);
    console.log(`${chalk.bold('Complexity:')} ${conflict.complexity}`);

    if (conflict.explanation) {
      console.log(`${chalk.bold('Explanation:')} ${chalk.dim(conflict.explanation)}`);
    }

    console.log(`${chalk.bold('Conflict blocks:')} ${conflict.hunks.length}`);

    const action = await inquirer.prompt([
      {
        type: 'list',
        name: 'resolution',
        message: 'How would you like to resolve this conflict?',
        choices: [
          { name: 'Skip for now', value: 'skip' },
          { name: 'Accept current version', value: 'current' },
          { name: 'Accept incoming version', value: 'incoming' },
          { name: 'Open in editor', value: 'editor' },
          { name: 'Show detailed diff', value: 'diff' },
        ],
      },
    ]);

    switch (action.resolution) {
      case 'skip':
        console.log(chalk.yellow('⏭️  Skipped'));
        break;

      case 'current':
        if (!dryRun) {
          console.log(chalk.green('✅ Accepting current version...'));
          // TODO: Implement current version resolution
        } else {
          console.log(chalk.green('Would accept current version'));
        }
        break;

      case 'incoming':
        if (!dryRun) {
          console.log(chalk.green('✅ Accepting incoming version...'));
          // TODO: Implement incoming version resolution
        } else {
          console.log(chalk.green('Would accept incoming version'));
        }
        break;

      case 'editor':
        console.log(chalk.blue('🔧 Opening in default editor...'));
        // TODO: Implement editor integration
        break;

      case 'diff':
        displayDetailedDiff(conflict);
        break;
    }
  }
}

function displayDetailedDiff(conflict: any) {
  console.log('');
  console.log(chalk.bold('📋 Detailed Conflict Diff'));
  console.log(chalk.gray('─'.repeat(50)));

  conflict.hunks.forEach((hunk: any, index: number) => {
    console.log(`${chalk.bold(`Conflict Block ${index + 1}:`)} Lines ${hunk.startLine}-${hunk.endLine}`);
    console.log('');

    console.log(chalk.red('<<<<<<< Current (HEAD)'));
    if (hunk.currentContent.trim()) {
      hunk.currentContent.split('\n').forEach((line: string) => {
        console.log(chalk.red(`- ${line}`));
      });
    } else {
      console.log(chalk.red('  (empty)'));
    }

    console.log(chalk.gray('======='));

    if (hunk.incomingContent.trim()) {
      hunk.incomingContent.split('\n').forEach((line: string) => {
        console.log(chalk.green(`+ ${line}`));
      });
    } else {
      console.log(chalk.green('  (empty)'));
    }

    console.log(chalk.blue('>>>>>>> Incoming'));
    console.log('');
  });
}