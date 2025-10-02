import simpleGit, { SimpleGit } from 'simple-git';
import { GitConflict, ConflictHunk } from '@smugit/shared';
import * as fs from 'fs/promises';
import * as path from 'path';

import { builtinPlugins } from './plugins/builtin';
import {
  getConflictResolutionPlugins,
  registerConflictResolutionPlugin,
} from './plugins/registry';
import {
  ConflictResolutionPlugin,
  ConflictResolutionContext,
  PluginResolution,
} from './plugins/types';

export interface ResolutionResult {
  success: boolean;
  resolvedFiles: string[];
  failedFiles: string[];
  errors: string[];
  fallbackApplied: { file: string; strategy: 'incoming' | 'current' | 'both' }[];
  warnings: string[];
  notes: string[];
  resolvedBy: { file: string; plugin: string; notes?: string[] }[];
}

let builtinsRegistered = false;

function ensureBuiltinPluginsRegistered(): void {
  if (!builtinsRegistered) {
    builtinPlugins.forEach(registerConflictResolutionPlugin);
    builtinsRegistered = true;
  }
}

export class ConflictResolver {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string = process.cwd()) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
    ensureBuiltinPluginsRegistered();
  }

  async autoResolveConflicts(
    conflicts: GitConflict[],
    dryRun: boolean = true,
    fallback: 'incoming' | 'current' | 'both' | 'none' = 'incoming'
  ): Promise<ResolutionResult> {
    const result: ResolutionResult = {
      success: true,
      resolvedFiles: [],
      failedFiles: [],
      errors: [],
      fallbackApplied: [],
      warnings: [],
      notes: [],
      resolvedBy: [],
    };

    const fallbackStrategy = fallback === 'none' ? undefined : fallback;
    const plugins = getConflictResolutionPlugins();
    const context = this.createContext();

    for (const conflict of conflicts) {
      try {
        const pluginOutcome = await this.runPlugins(conflict, plugins, context);

        if (pluginOutcome) {
          if (!dryRun) {
            await this.writeResolvedFile(conflict.file, pluginOutcome.content);
          }

          result.resolvedFiles.push(conflict.file);
          result.resolvedBy.push({
            file: conflict.file,
            plugin: pluginOutcome.plugin.name,
            notes: pluginOutcome.notes,
          });

          pluginOutcome.notes?.forEach(note => {
            result.notes.push(`${conflict.file}: ${note}`);
          });

          continue;
        }

        if (fallbackStrategy) {
          const fallbackContent = await this.applyFallbackStrategy(conflict, fallbackStrategy);

          if (fallbackContent) {
            if (!dryRun) {
              await this.writeResolvedFile(conflict.file, fallbackContent);
            }

            result.resolvedFiles.push(conflict.file);
            result.fallbackApplied.push({ file: conflict.file, strategy: fallbackStrategy });

            result.warnings.push(
              `Applied fallback strategy "${fallbackStrategy}" to ${conflict.file}. Review before committing.`
            );

            continue;
          }
        }

        result.failedFiles.push(conflict.file);
        result.errors.push(`No automated strategy matched ${conflict.file}.`);
        result.success = false;
      } catch (error) {
        result.failedFiles.push(conflict.file);
        result.errors.push(`Failed to resolve ${conflict.file}: ${error}`);
        result.success = false;
      }
    }

    return result;
  }

  async createCheckpoint(branchName?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointBranch = branchName || `smugit-checkpoint-${timestamp}`;

    await this.git.checkoutLocalBranch(checkpointBranch);
    return checkpointBranch;
  }

  async stageResolvedFiles(files: string[]): Promise<void> {
    for (const file of files) {
      await this.git.add(file);
    }
  }

  private async runPlugins(
    conflict: GitConflict,
    plugins: ConflictResolutionPlugin[],
    context: ConflictResolutionContext
  ): Promise<
    | {
        content: string;
        plugin: ConflictResolutionPlugin;
        notes?: string[];
      }
    | undefined
  > {
    for (const plugin of plugins) {
      if (!plugin.supports(conflict)) {
        continue;
      }

      const resolution: PluginResolution | null = await plugin.resolve(conflict, context);
      if (resolution) {
        return {
          content: resolution.content,
          plugin,
          notes: resolution.notes,
        };
      }
    }

    return undefined;
  }

  private createContext(): ConflictResolutionContext {
    return {
      repoPath: this.repoPath,
      readFile: (filePath: string) => this.readFile(filePath),
    };
  }

  private async applyFallbackStrategy(
    conflict: GitConflict,
    strategy: 'incoming' | 'current' | 'both'
  ): Promise<string | undefined> {
    const content = await this.readFile(conflict.file);
    let resolvedContent = content;

    for (const hunk of conflict.hunks) {
      let replacement: string;

      switch (strategy) {
        case 'incoming':
          replacement = hunk.incomingContent;
          break;
        case 'current':
          replacement = hunk.currentContent;
          break;
        case 'both':
          replacement = this.combineBothVersions(hunk);
          break;
        default:
          return undefined;
      }

      const conflictPattern = new RegExp(
        `${escapeRegExp(hunk.conflictMarkers.start)}[\\s\\S]*?${escapeRegExp(hunk.conflictMarkers.end)}`,
        's'
      );

      resolvedContent = resolvedContent.replace(conflictPattern, replacement);
    }

    return resolvedContent;
  }

  private combineBothVersions(hunk: ConflictHunk): string {
    const segments: string[] = [];
    const seen = new Set<string>();

    const push = (segment: string) => {
      if (!segment.trim()) {
        return;
      }

      const normalized = segment.replace(/\s+/g, ' ').trim();
      if (seen.has(normalized)) {
        return;
      }

      seen.add(normalized);
      segments.push(segment.trimEnd());
    };

    push(hunk.currentContent);
    push(hunk.incomingContent);

    if (segments.length === 0) {
      return '';
    }

    return segments.join('\n');
  }

  private async readFile(filePath: string): Promise<string> {
    const fullPath = path.join(this.repoPath, filePath);
    return fs.readFile(fullPath, 'utf-8');
  }

  private async writeResolvedFile(filePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.repoPath, filePath);
    await fs.writeFile(fullPath, content, 'utf-8');
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
