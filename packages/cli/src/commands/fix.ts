import { Command, Option } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs/promises';
import * as path from 'path';

import { GitAnalyzer, ConflictResolver } from '../git';

type FallbackStrategy = 'incoming' | 'current' | 'both' | 'none';
type InteractiveChoice = 'current' | 'incoming' | 'skip';

const DEFAULT_DIVIDER_WIDTH = 68;
const SECTION_LINE_CHAR = '\u2500';

const sectionDivider = (width = DEFAULT_DIVIDER_WIDTH) => chalk.gray(SECTION_LINE_CHAR.repeat(width));

export const fixCommand = new Command('fix')
  .alias('f')
  .description('Fix merge conflicts automatically or interactively')
  .option('-a, --auto', 'Automatically fix resolvable conflicts')
  .option('-i, --interactive', 'Interactively review and fix conflicts')
  .option('-d, --dry-run', 'Show what would be fixed without making changes')
  .option('--no-checkpoint', 'Skip creating checkpoint branch')
  .addOption(
    new Option('--fallback <strategy>', 'Fallback strategy when auto resolution fails')
      .choices(['incoming', 'current', 'both', 'none'])
      .default('incoming')
  )
  .addOption(
    new Option('--accept <choice>', 'Auto-select a resolution when using --interactive')
      .choices(['current', 'incoming', 'skip'])
  )
  .action(async (options) => {
    const spinner = ora('Analyzing conflicts...').start();

    try {
      const analyzer = new GitAnalyzer();
      const resolver = new ConflictResolver();

      const conflicts = await analyzer.analyzeConflicts();

      if (conflicts.length === 0) {
        spinner.succeed('No conflicts found');
        console.log(chalk.green('✅ Repository is clean - no conflicts to fix!'));
        return;
      }

      spinner.succeed(`Found ${conflicts.length} conflict(s)`);

      const autoResolvable = conflicts.filter(conflict => conflict.autoResolvable);
      const manualReview = conflicts.filter(conflict => !conflict.autoResolvable);

      console.log('');
      console.log(chalk.bold('Resolution plan'));
      console.log(sectionDivider());
      console.log(`${chalk.green('Auto-resolvable:')} ${autoResolvable.length}`);
      console.log(`${chalk.yellow('Manual review:')} ${manualReview.length}`);

      let checkpointBranch: string | undefined;
      if (options.checkpoint !== false && !options.dryRun) {
        spinner.start('Creating checkpoint branch...');
        checkpointBranch = await resolver.createCheckpoint();
        spinner.succeed(`Checkpoint created: ${chalk.cyan(checkpointBranch)}`);
      }

      if (options.auto || (!options.interactive && autoResolvable.length > 0)) {
        const fallback = (options.fallback ?? 'incoming') as FallbackStrategy;
        const conflictsForAuto = options.auto ? conflicts : autoResolvable;
        await handleAutoResolution(resolver, conflictsForAuto, Boolean(options.dryRun), fallback);
      }

      if (options.interactive && manualReview.length > 0) {
        await handleInteractiveResolution(
          manualReview,
          Boolean(options.dryRun),
          options.accept as InteractiveChoice | undefined
        );
      }

      if (!options.dryRun && (autoResolvable.length > 0 || manualReview.length > 0)) {
        console.log('');
        console.log(chalk.bold('Next steps'));
        console.log(sectionDivider());
        if (checkpointBranch) {
          console.log(`Checkpoint branch: ${chalk.cyan(checkpointBranch)}`);
        }
        console.log(`Run ${chalk.cyan('git status')} to review changes`);
        console.log(`Run ${chalk.cyan('smugit commit')} to create a merge commit`);
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
  dryRun: boolean,
  fallback: FallbackStrategy
) {
  if (conflicts.length === 0) {
    console.log(chalk.yellow('No auto-resolvable conflicts detected.'));
    return;
  }

  const spinner = ora('Auto-resolving conflicts...').start();

  try {
    const result = await resolver.autoResolveConflicts(conflicts, dryRun, fallback);

    if (result.success && result.resolvedFiles.length > 0) {
      spinner.succeed(`${dryRun ? 'Would resolve' : 'Resolved'} ${result.resolvedFiles.length} conflict(s)`);

      console.log('');
      console.log(chalk.bold.green('Auto-resolved files'));
      const fallbackByFile = new Map(result.fallbackApplied.map(entry => [entry.file, entry.strategy]));
      const resolvedByMap = new Map(result.resolvedBy.map(entry => [entry.file, entry]));

      result.resolvedFiles.forEach(file => {
        const pluginInfo = resolvedByMap.get(file);
        const fallbackStrategy = fallbackByFile.get(file);

        if (pluginInfo) {
          const via = chalk.dim(`via ${pluginInfo.plugin}`);
          console.log(`  ${chalk.green('✓')} ${file} ${via}`);
          pluginInfo.notes?.forEach(note => console.log(`    ${chalk.dim('•')} ${note}`));
        } else if (fallbackStrategy) {
          console.log(`  ${chalk.yellow('~')} ${file} ${chalk.dim(`fallback: ${fallbackStrategy}`)}`);
        } else {
          console.log(`  ${chalk.green('✓')} ${file}`);
        }
      });

      if (result.notes.length > 0) {
        console.log('');
        console.log(chalk.bold.blue('Notes'));
        result.notes.forEach(message => console.log(`  ${chalk.blue('•')} ${message}`));
      }

      if (result.warnings.length > 0) {
        console.log('');
        console.log(chalk.bold.yellow('Warnings'));
        result.warnings.forEach(message => console.log(`  ${chalk.yellow('•')} ${message}`));
      }

      if (!dryRun) {
        spinner.start('Staging resolved files...');
        await resolver.stageResolvedFiles(result.resolvedFiles);
        spinner.succeed('Files staged for commit');
      }
    }

    if (result.failedFiles.length > 0) {
      console.log('');
      console.log(chalk.bold.red('Failed to resolve'));
      result.failedFiles.forEach(file => console.log(`  ${chalk.red('✗')} ${file}`));

      if (result.errors.length > 0) {
        console.log('');
        console.log(chalk.bold('Errors'));
        result.errors.forEach(error => console.log(`  ${chalk.red('•')} ${error}`));
      }
    }
  } catch (error) {
    spinner.fail('Auto-resolution failed');
    throw error;
  }
}

async function handleInteractiveResolution(
  conflicts: any[],
  dryRun: boolean,
  preselected?: InteractiveChoice
) {
  const resolvedCurrent: string[] = [];
  const resolvedIncoming: string[] = [];
  const skippedFiles: string[] = [];

  console.log('');
  console.log(chalk.bold.yellow('Interactive conflict resolution'));
  console.log(chalk.dim('Review each file, preview the first block, then choose what to keep.'));
  console.log(sectionDivider());

  for (const conflict of conflicts) {
    console.log('');
    console.log(chalk.bold.cyan(`File: ${conflict.file}`));
    console.log(chalk.dim(`Type: ${conflict.type} • Complexity: ${conflict.complexity}`));
    if (conflict.explanation) {
      console.log(chalk.dim(conflict.explanation));
    }

    console.log('');
    console.log(chalk.bold('Preview'));
    if (conflict.hunks.length > 0) {
      const firstHunk = conflict.hunks[0];
      const currentSnippet = firstHunk.currentContent.split('\n')[0]?.trim() ?? '';
      const incomingSnippet = firstHunk.incomingContent.split('\n')[0]?.trim() ?? '';
      console.log(`${chalk.red('  Current ->')} ${currentSnippet || chalk.dim('(empty)')}`);
      console.log(`${chalk.green('  Incoming ->')} ${incomingSnippet || chalk.dim('(empty)')}`);
      if (conflict.hunks.length > 1) {
        console.log(chalk.dim(`  …plus ${conflict.hunks.length - 1} more block(s)`));
      }
    } else {
      console.log(chalk.dim('  (no preview available)'));
    }

    const record = async (choice: InteractiveChoice) => {
      await applyResolutionChoice(conflict, choice, dryRun);
      if (choice === 'current') {
        resolvedCurrent.push(conflict.file);
      } else if (choice === 'incoming') {
        resolvedIncoming.push(conflict.file);
      } else {
        skippedFiles.push(conflict.file);
      }
    };

    if (preselected) {
      await record(preselected);
      console.log(sectionDivider());
      continue;
    }

    const action = await inquirer.prompt([
      {
        type: 'list',
        name: 'resolution',
        message: chalk.bold('Resolution choice'),
        choices: [
          { name: 'Show detailed diff first', value: 'diff' },
          { name: 'Accept current version (HEAD)', value: 'current' },
          { name: 'Accept incoming version (merge branch)', value: 'incoming' },
          { name: 'Skip for now', value: 'skip' },
          { name: 'Open in editor', value: 'editor' },
        ],
      },
    ]);

    switch (action.resolution as InteractiveChoice | 'diff' | 'editor') {
      case 'skip':
        await record('skip');
        break;

      case 'current':
        await record('current');
        break;

      case 'incoming':
        await record('incoming');
        break;

      case 'editor':
        console.log(chalk.blue('Opening in default editor...'));
        break;

      case 'diff': {
        await displayDetailedDiff(conflict);
        const followUp = await inquirer.prompt([
          {
            type: 'list',
            name: 'resolution',
            message: chalk.bold('Resolution choice'),
            choices: [
              { name: 'Accept current version (HEAD)', value: 'current' },
              { name: 'Accept incoming version (merge branch)', value: 'incoming' },
              { name: 'Skip for now', value: 'skip' },
              { name: 'Open in editor', value: 'editor' },
            ],
          },
        ]);

        if (followUp.resolution === 'editor') {
          console.log(chalk.blue('Opening in default editor...'));
        } else {
          await record(followUp.resolution as InteractiveChoice);
        }
        break;
      }
    }

    console.log(sectionDivider());
  }

  console.log('');
  console.log(chalk.bold.green('Interactive summary'));
  if (resolvedCurrent.length > 0) {
    console.log(`${chalk.green('  ✓ Current accepted:')} ${resolvedCurrent.join(', ')}`);
  }
  if (resolvedIncoming.length > 0) {
    console.log(`${chalk.green('  ✓ Incoming accepted:')} ${resolvedIncoming.join(', ')}`);
  }
  if (skippedFiles.length > 0) {
    console.log(`${chalk.yellow('  • Skipped for later:')} ${skippedFiles.join(', ')}`);
  }
  if (resolvedCurrent.length === 0 && resolvedIncoming.length === 0 && skippedFiles.length === 0) {
    console.log(chalk.dim('  No actions taken yet.'));
  }
  console.log('');
}

async function applyResolutionChoice(
  conflict: any,
  choice: InteractiveChoice,
  dryRun: boolean
) {
  switch (choice) {
    case 'skip':
      console.log(chalk.yellow('⏭️  Skipped'));
      return;

    case 'current':
      if (!dryRun) {
        console.log(chalk.green('✅ Accepting current version...'));
        await resolveWithVersion(conflict, 'current');
      } else {
        console.log(chalk.green('Would accept current version'));
      }
      return;

    case 'incoming':
      if (!dryRun) {
        console.log(chalk.green('✅ Accepting incoming version...'));
        await resolveWithVersion(conflict, 'incoming');
      } else {
        console.log(chalk.green('Would accept incoming version'));
      }
      return;
  }
}

async function displayDetailedDiff(conflict: any) {
  console.log('');
  console.log(chalk.bold('Conflict Details'));
  console.log(sectionDivider());

  for (const hunk of conflict.hunks) {
    const currentLines = (hunk.currentContent || '').split('\n');
    const incomingLines = (hunk.incomingContent || '').split('\n');

    renderSideBySide(currentLines, incomingLines, {
      leftLabel: 'Current (HEAD)',
      rightLabel: 'Incoming (merge)',
    });
  }
}

function renderSideBySide(
  leftLines: string[],
  rightLines: string[],
  labels: { leftLabel: string; rightLabel: string }
) {
  const maxLines = Math.max(leftLines.length, rightLines.length);
  const lineNoWidth = Math.max(String(maxLines).length, 2);
  const columnWidth = 60;

  // Top border
  console.log('');
  console.log(chalk.gray('═'.repeat(columnWidth + 1) + '╤' + '═'.repeat(columnWidth + 1)));

  // Headers
  const leftHeaderText = ` ${labels.leftLabel}`;
  const rightHeaderText = ` ${labels.rightLabel}`;
  const leftHeaderPadded = leftHeaderText + ' '.repeat(columnWidth - leftHeaderText.length);
  const rightHeaderPadded = rightHeaderText + ' '.repeat(columnWidth - rightHeaderText.length);

  console.log(chalk.gray(leftHeaderPadded + '│' + rightHeaderPadded));

  // Header separator
  console.log(chalk.gray('─'.repeat(columnWidth + 1) + '┼' + '─'.repeat(columnWidth + 1)));

  // Content lines
  for (let index = 0; index < maxLines; index++) {
    // Strip carriage returns that can mess up the display
    const leftLine = (leftLines[index] ?? '').replace(/\r/g, '');
    const rightLine = (rightLines[index] ?? '').replace(/\r/g, '');
    const same = leftLine === rightLine;

    // Truncate lines if too long
    const maxContentWidth = columnWidth - lineNoWidth - 3;
    const leftText = leftLine.length > maxContentWidth ? leftLine.substring(0, maxContentWidth - 3) + '...' : leftLine;
    const rightText = rightLine.length > maxContentWidth ? rightLine.substring(0, maxContentWidth - 3) + '...' : rightLine;

    const leftDisplay = leftText || '';
    const rightDisplay = rightText || '';

    const lineNum = String(index + 1).padStart(lineNoWidth);

    // Build the content with line numbers
    const leftNumDisplay = chalk.dim(lineNum);
    const rightNumDisplay = chalk.dim(lineNum);

    const leftPlainLen = ` ${lineNum} ${leftDisplay}`.length;
    const rightPlainLen = ` ${lineNum} ${rightDisplay}`.length;

    if (same) {
      // Same lines - no background, just gray text
      const leftContent = ` ${leftNumDisplay} ${chalk.dim(leftDisplay)}`;
      const rightContent = ` ${rightNumDisplay} ${chalk.dim(rightDisplay)}`;
      const leftPadded = leftContent + ' '.repeat(columnWidth - leftPlainLen);
      const rightPadded = rightContent + ' '.repeat(columnWidth - rightPlainLen);
      console.log(leftPadded + chalk.gray('│') + rightPadded);
    } else {
      // Different lines - subtle red/green background with white text
      const leftContent = ` ${leftNumDisplay} ${leftDisplay}`;
      const rightContent = ` ${rightNumDisplay} ${rightDisplay}`;
      const leftPadded = leftContent + ' '.repeat(columnWidth - leftPlainLen);
      const rightPadded = rightContent + ' '.repeat(columnWidth - rightPlainLen);

      // Use darker red and green backgrounds
      const leftStyled = chalk.bgRed.whiteBright(leftPadded);
      const rightStyled = chalk.bgGreen.whiteBright(rightPadded);

      console.log(leftStyled + chalk.gray('│') + rightStyled);
    }
  }

  // Bottom border
  console.log(chalk.gray('═'.repeat(columnWidth + 1) + '╧' + '═'.repeat(columnWidth + 1)));
  console.log('');
}

async function resolveWithVersion(conflict: any, version: 'current' | 'incoming') {
  try {
    const resolver = new ConflictResolver();
    const fullPath = path.join(process.cwd(), conflict.file);
    const original = await fs.readFile(fullPath, 'utf-8');

    let resolvedContent = original;

    for (const hunk of conflict.hunks) {
      const replacement = version === 'current' ? hunk.currentContent : hunk.incomingContent;
      const lines = resolvedContent.split('\n');
      const newLines: string[] = [];
      let inConflict = false;

      for (const line of lines) {
        if (line.startsWith('<<<<<<<')) {
          newLines.push(replacement);
          inConflict = true;
        } else if (line.startsWith('>>>>>>>')) {
          inConflict = false;
        } else if (!inConflict) {
          newLines.push(line);
        }
      }

      resolvedContent = newLines.join('\n');
    }

    await fs.writeFile(fullPath, resolvedContent, 'utf-8');
    await resolver.stageResolvedFiles([conflict.file]);

    console.log(chalk.green(`✅ Resolved ${conflict.file} with ${version} version`));
  } catch (error) {
    console.error(chalk.red(`Failed to resolve ${conflict.file}:`), error);
  }
}
