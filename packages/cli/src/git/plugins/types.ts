import { GitConflict } from '@smugit/shared';

export interface ConflictResolutionContext {
  repoPath: string;
  readFile(filePath: string): Promise<string>;
}

export interface PluginResolution {
  content: string;
  notes?: string[];
}

export interface ConflictResolutionPlugin {
  name: string;
  priority?: number;
  supports(conflict: GitConflict): boolean;
  resolve(
    conflict: GitConflict,
    context: ConflictResolutionContext
  ): Promise<PluginResolution | null>;
}
