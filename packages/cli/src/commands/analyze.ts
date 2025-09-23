import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { GitAnalyzer } from '../git';
import { ConflictType, ConflictComplexity } from '@smugit/shared';

export const analyzeCommand = new Command('analyze')
  .alias('a')
  .description('Analyze repository for conflicts and issues')
  .option('-c, --conflicts', 'Analyze merge conflicts')
  .option('-r, --repository', 'Analyze repository status')
  .option('-v, --verbose', 'Show detailed analysis')
  .action(async (options) => {
    const spinner = ora('Analyzing repository...').start();

    try {
      const analyzer = new GitAnalyzer();

      // Analyze repository if requested or by default
      if (options.repository || (!options.conflicts && !options.repository)) {
        spinner.text = 'Analyzing repository status...';
        const repo = await analyzer.analyzeRepository();

        spinner.succeed('Repository analysis complete');
        displayRepositoryStatus(repo, options.verbose);
      }

      // Analyze conflicts if requested
      if (options.conflicts || (!options.conflicts && !options.repository)) {
        spinner.start('Analyzing conflicts...');
        const conflicts = await analyzer.analyzeConflicts();

        if (conflicts.length === 0) {
          spinner.succeed('No conflicts found');
          console.log(chalk.green('✨ Repository is clean - no conflicts detected!'));
        } else {
          spinner.succeed(`Found ${conflicts.length} conflict(s)`);
          displayConflicts(conflicts, options.verbose);
        }
      }
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

function displayRepositoryStatus(repo: any, verbose: boolean) {
  console.log('');
  console.log(chalk.bold.blue('🔍 Repository Status'));
  console.log(chalk.gray('─'.repeat(50)));

  console.log(`${chalk.bold('Path:')} ${repo.path}`);
  console.log(`${chalk.bold('Branch:')} ${chalk.cyan(repo.branch)}`);

  if (repo.remotes.length > 0) {
    console.log(`${chalk.bold('Remotes:')}`);
    repo.remotes.forEach((remote: any) => {
      console.log(`  ${chalk.cyan(remote.name)}: ${remote.url}`);
    });
  }

  const status = repo.status;
  if (status.ahead > 0 || status.behind > 0) {
    console.log(`${chalk.bold('Sync Status:')}`);
    if (status.ahead > 0) {
      console.log(`  ${chalk.green('↑')} ${status.ahead} commit(s) ahead`);
    }
    if (status.behind > 0) {
      console.log(`  ${chalk.red('↓')} ${status.behind} commit(s) behind`);
    }
  }

  if (status.staged.length > 0) {
    console.log(`${chalk.bold('Staged files:')} ${chalk.green(status.staged.length)}`);
    if (verbose) {
      status.staged.forEach((file: string) => {
        console.log(`  ${chalk.green('+')} ${file}`);
      });
    }
  }

  if (status.modified.length > 0) {
    console.log(`${chalk.bold('Modified files:')} ${chalk.yellow(status.modified.length)}`);
    if (verbose) {
      status.modified.forEach((file: string) => {
        console.log(`  ${chalk.yellow('M')} ${file}`);
      });
    }
  }

  if (status.untracked.length > 0) {
    console.log(`${chalk.bold('Untracked files:')} ${chalk.gray(status.untracked.length)}`);
    if (verbose) {
      status.untracked.forEach((file: string) => {
        console.log(`  ${chalk.gray('?')} ${file}`);
      });
    }
  }

  if (status.conflicted.length > 0) {
    console.log(`${chalk.bold('Conflicted files:')} ${chalk.red(status.conflicted.length)}`);
    status.conflicted.forEach((file: string) => {
      console.log(`  ${chalk.red('!')} ${file}`);
    });
  }
}

function displayConflicts(conflicts: any[], verbose: boolean) {
  console.log('');
  console.log(chalk.bold.red('⚠️  Merge Conflicts'));
  console.log(chalk.gray('─'.repeat(50)));

  const autoResolvable = conflicts.filter(c => c.autoResolvable);
  const manualReview = conflicts.filter(c => !c.autoResolvable);

  if (autoResolvable.length > 0) {
    console.log(chalk.bold.green(`✅ Auto-resolvable: ${autoResolvable.length}`));
    autoResolvable.forEach(conflict => {
      console.log(`  ${getComplexityIcon(conflict.complexity)} ${conflict.file}`);
      console.log(`    ${chalk.dim(getTypeDescription(conflict.type))}`);
      if (verbose && conflict.explanation) {
        console.log(`    ${chalk.gray(conflict.explanation)}`);
      }
    });
    console.log('');
  }

  if (manualReview.length > 0) {
    console.log(chalk.bold.yellow(`🔍 Manual review needed: ${manualReview.length}`));
    manualReview.forEach(conflict => {
      console.log(`  ${getComplexityIcon(conflict.complexity)} ${conflict.file}`);
      console.log(`    ${chalk.dim(getTypeDescription(conflict.type))}`);
      if (verbose && conflict.explanation) {
        console.log(`    ${chalk.gray(conflict.explanation)}`);
      }
      if (verbose) {
        console.log(`    ${chalk.dim(`${conflict.hunks.length} conflict block(s)`)}`);
      }
    });
  }

  // Provide guidance
  console.log('');
  console.log(chalk.bold('💡 Next steps:'));
  if (autoResolvable.length > 0) {
    console.log(`  Run ${chalk.cyan('smugit fix --auto')} to resolve ${autoResolvable.length} conflicts automatically`);
  }
  if (manualReview.length > 0) {
    console.log(`  Review ${manualReview.length} conflicts manually or run ${chalk.cyan('smugit fix --interactive')}`);
  }
}

function getComplexityIcon(complexity: ConflictComplexity): string {
  switch (complexity) {
    case ConflictComplexity.TRIVIAL:
      return chalk.green('●');
    case ConflictComplexity.SIMPLE:
      return chalk.yellow('●');
    case ConflictComplexity.MODERATE:
      return chalk.hex('#FFA500')('●');
    case ConflictComplexity.COMPLEX:
      return chalk.red('●');
    default:
      return '●';
  }
}

function getTypeDescription(type: ConflictType): string {
  switch (type) {
    case ConflictType.WHITESPACE:
      return 'Whitespace differences';
    case ConflictType.IMPORT:
      return 'Import/require statements';
    case ConflictType.STRUCTURAL:
      return 'Code structure changes';
    case ConflictType.SEMANTIC:
      return 'Logic/behavior differences';
    case ConflictType.CONTENT:
    default:
      return 'Content changes';
  }
}