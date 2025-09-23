import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { GitAnalyzer } from '../git';

export const statusCommand = new Command('status')
  .alias('s')
  .description('Show enhanced repository status with Smugit insights')
  .option('-v, --verbose', 'Show detailed status information')
  .option('--conflicts-only', 'Show only conflict information')
  .action(async (options) => {
    const spinner = ora('Gathering repository status...').start();

    try {
      const analyzer = new GitAnalyzer();

      // Get repository status
      const repo = await analyzer.analyzeRepository();

      // Check for conflicts
      const conflicts = await analyzer.analyzeConflicts();

      // Get recent commits
      const recentCommits = await analyzer.getCommitHistory(5);

      spinner.succeed('Status analysis complete');

      if (options.conflictsOnly) {
        displayConflictsOnly(conflicts);
      } else {
        displayFullStatus(repo, conflicts, recentCommits, options.verbose);
      }

      // Show actionable suggestions
      displaySuggestions(repo.status, conflicts);

    } catch (error) {
      spinner.fail('Status check failed');
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

function displayFullStatus(repo: any, conflicts: any[], commits: any[], verbose: boolean) {
  console.log('');
  console.log(chalk.bold.blue('📊 Smugit Status'));
  console.log(chalk.gray('═'.repeat(60)));

  // Repository info
  console.log(chalk.bold('🏠 Repository'));
  console.log(`  Path: ${repo.path}`);
  console.log(`  Branch: ${chalk.cyan(repo.branch)}`);

  if (repo.remotes.length > 0) {
    console.log(`  Remote: ${chalk.gray(repo.remotes[0].name)} → ${repo.remotes[0].url}`);
  }

  // Sync status
  const status = repo.status;
  if (status.ahead > 0 || status.behind > 0) {
    console.log('');
    console.log(chalk.bold('🔄 Sync Status'));
    if (status.ahead > 0) {
      console.log(`  ${chalk.green('↑')} ${status.ahead} commit(s) ahead of remote`);
    }
    if (status.behind > 0) {
      console.log(`  ${chalk.red('↓')} ${status.behind} commit(s) behind remote`);
    }
  }

  // Working directory status
  const hasChanges = status.staged.length > 0 || status.modified.length > 0 || status.untracked.length > 0;

  if (hasChanges) {
    console.log('');
    console.log(chalk.bold('📁 Working Directory'));

    if (status.staged.length > 0) {
      console.log(`  ${chalk.green('Staged:')} ${status.staged.length} file(s)`);
      if (verbose) {
        status.staged.forEach((file: string) => {
          console.log(`    ${chalk.green('+')} ${file}`);
        });
      }
    }

    if (status.modified.length > 0) {
      console.log(`  ${chalk.yellow('Modified:')} ${status.modified.length} file(s)`);
      if (verbose) {
        status.modified.forEach((file: string) => {
          console.log(`    ${chalk.yellow('M')} ${file}`);
        });
      }
    }

    if (status.untracked.length > 0) {
      console.log(`  ${chalk.gray('Untracked:')} ${status.untracked.length} file(s)`);
      if (verbose) {
        status.untracked.slice(0, 10).forEach((file: string) => {
          console.log(`    ${chalk.gray('?')} ${file}`);
        });
        if (status.untracked.length > 10) {
          console.log(`    ${chalk.dim(`... and ${status.untracked.length - 10} more`)}`);
        }
      }
    }
  } else {
    console.log('');
    console.log(chalk.bold('📁 Working Directory'));
    console.log(`  ${chalk.green('✨ Clean - no changes')}`);
  }

  // Conflicts
  if (conflicts.length > 0) {
    console.log('');
    console.log(chalk.bold.red('⚠️  Conflicts'));
    displayConflictSummary(conflicts, verbose);
  }

  // Recent commits
  if (commits.length > 0 && verbose) {
    console.log('');
    console.log(chalk.bold('📜 Recent Commits'));
    commits.slice(0, 3).forEach((commit: any) => {
      const shortHash = commit.hash.substring(0, 7);
      const shortMessage = commit.message.split('\n')[0].substring(0, 60);
      const timeAgo = getTimeAgo(new Date(commit.date));

      console.log(`  ${chalk.yellow(shortHash)} ${shortMessage} ${chalk.dim(`(${timeAgo})`)}`);
    });
  }
}

function displayConflictsOnly(conflicts: any[]) {
  console.log('');
  console.log(chalk.bold.red('⚠️  Merge Conflicts'));
  console.log(chalk.gray('═'.repeat(60)));

  if (conflicts.length === 0) {
    console.log(chalk.green('✨ No conflicts found'));
    return;
  }

  displayConflictSummary(conflicts, true);
}

function displayConflictSummary(conflicts: any[], verbose: boolean) {
  const autoResolvable = conflicts.filter(c => c.autoResolvable);
  const manualReview = conflicts.filter(c => !c.autoResolvable);

  console.log(`  Total: ${chalk.red(conflicts.length)} conflict(s)`);
  console.log(`  Auto-resolvable: ${chalk.green(autoResolvable.length)}`);
  console.log(`  Manual review: ${chalk.yellow(manualReview.length)}`);

  if (verbose) {
    if (autoResolvable.length > 0) {
      console.log('');
      console.log(`  ${chalk.bold.green('✅ Auto-resolvable:')}`);
      autoResolvable.forEach(conflict => {
        console.log(`    ${getComplexityDot(conflict.complexity)} ${conflict.file} ${chalk.dim(`(${conflict.type})`)}`);
      });
    }

    if (manualReview.length > 0) {
      console.log('');
      console.log(`  ${chalk.bold.yellow('🔍 Manual review:')}`);
      manualReview.forEach(conflict => {
        console.log(`    ${getComplexityDot(conflict.complexity)} ${conflict.file} ${chalk.dim(`(${conflict.type})`)}`);
      });
    }
  }
}

function displaySuggestions(status: any, conflicts: any[]) {
  const suggestions: string[] = [];

  // Conflict suggestions
  if (conflicts.length > 0) {
    const autoResolvable = conflicts.filter(c => c.autoResolvable);

    if (autoResolvable.length > 0) {
      suggestions.push(`${chalk.cyan('smugit fix --auto')} - Auto-resolve ${autoResolvable.length} conflicts`);
    }

    if (conflicts.length > autoResolvable.length) {
      suggestions.push(`${chalk.cyan('smugit fix --interactive')} - Review remaining conflicts`);
    }
  }

  // Commit suggestions
  if (status.staged.length > 0) {
    suggestions.push(`${chalk.cyan('smugit commit')} - Create intelligent commit`);
  } else if (status.modified.length > 0) {
    suggestions.push(`${chalk.cyan('git add')} - Stage changes for commit`);
  }

  // Sync suggestions
  if (status.ahead > 0) {
    suggestions.push(`${chalk.cyan('git push')} - Push ${status.ahead} commit(s) to remote`);
  }

  if (status.behind > 0) {
    suggestions.push(`${chalk.cyan('git pull')} - Pull ${status.behind} commit(s) from remote`);
  }

  if (suggestions.length > 0) {
    console.log('');
    console.log(chalk.bold('💡 Suggested Actions'));
    console.log(chalk.gray('─'.repeat(40)));
    suggestions.forEach(suggestion => {
      console.log(`  ${suggestion}`);
    });
  }
}

function getComplexityDot(complexity: string): string {
  switch (complexity) {
    case 'trivial':
      return chalk.green('●');
    case 'simple':
      return chalk.yellow('●');
    case 'moderate':
      return chalk.hex('#FFA500')('●');
    case 'complex':
      return chalk.red('●');
    default:
      return '●';
  }
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else {
    const diffMins = Math.floor(diffMs / (1000 * 60));
    return `${Math.max(1, diffMins)} min${diffMins > 1 ? 's' : ''} ago`;
  }
}