import simpleGit, { SimpleGit } from 'simple-git';
import { GitConflict, ConflictType, ConflictComplexity } from '@smugit/shared';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ASTConflictResolver } from './ast-resolver';

export interface ResolutionResult {
  success: boolean;
  resolvedFiles: string[];
  failedFiles: string[];
  errors: string[];
}

export interface ResolutionStrategy {
  type: ConflictType;
  complexity: ConflictComplexity;
  resolver: (conflict: GitConflict) => Promise<string>;
}

export class ConflictResolver {
  private git: SimpleGit;
  private repoPath: string;
  private strategies: ResolutionStrategy[];
  private astResolver: ASTConflictResolver;

  constructor(repoPath: string = process.cwd()) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
    this.astResolver = new ASTConflictResolver();
    this.strategies = this.initializeStrategies();
  }

  /**
   * Auto-resolves conflicts that are deemed safe
   */
  async autoResolveConflicts(conflicts: GitConflict[], dryRun: boolean = true): Promise<ResolutionResult> {
    const result: ResolutionResult = {
      success: true,
      resolvedFiles: [],
      failedFiles: [],
      errors: [],
    };

    for (const conflict of conflicts) {
      if (!conflict.autoResolvable) {
        continue;
      }

      try {
        const resolvedContent = await this.resolveConflict(conflict);

        if (!dryRun) {
          await this.writeResolvedFile(conflict.file, resolvedContent);
          result.resolvedFiles.push(conflict.file);
        } else {
          // In dry run, just validate that we can resolve it
          result.resolvedFiles.push(conflict.file);
        }
      } catch (error) {
        result.failedFiles.push(conflict.file);
        result.errors.push(`Failed to resolve ${conflict.file}: ${error}`);
        result.success = false;
      }
    }

    return result;
  }

  /**
   * Resolves a single conflict using appropriate strategy
   */
  private async resolveConflict(conflict: GitConflict): Promise<string> {
    const strategy = this.findStrategy(conflict.type, conflict.complexity);

    if (!strategy) {
      throw new Error(`No resolution strategy found for ${conflict.type} conflict with ${conflict.complexity} complexity`);
    }

    return await strategy.resolver(conflict);
  }

  /**
   * Finds appropriate resolution strategy
   */
  private findStrategy(type: ConflictType, complexity: ConflictComplexity): ResolutionStrategy | undefined {
    return this.strategies.find(s => s.type === type && s.complexity === complexity);
  }

  /**
   * Initializes conflict resolution strategies
   */
  private initializeStrategies(): ResolutionStrategy[] {
    return [
      {
        type: ConflictType.WHITESPACE,
        complexity: ConflictComplexity.TRIVIAL,
        resolver: this.resolveWhitespaceConflict.bind(this),
      },
      {
        type: ConflictType.WHITESPACE,
        complexity: ConflictComplexity.SIMPLE,
        resolver: this.resolveWhitespaceConflict.bind(this),
      },
      {
        type: ConflictType.IMPORT,
        complexity: ConflictComplexity.TRIVIAL,
        resolver: this.resolveImportConflict.bind(this),
      },
      {
        type: ConflictType.IMPORT,
        complexity: ConflictComplexity.SIMPLE,
        resolver: this.resolveImportConflict.bind(this),
      },
      {
        type: ConflictType.STRUCTURAL,
      },
      {
        type: ConflictType.STRUCTURAL,
        complexity: ConflictComplexity.MODERATE,
        resolver: this.resolveStructuralConflict.bind(this),
      },
      {
        type: ConflictType.STRUCTURAL,
        complexity: ConflictComplexity.COMPLEX,
        resolver: this.resolveStructuralConflict.bind(this),
        complexity: ConflictComplexity.TRIVIAL,
        resolver: this.resolveStructuralConflict.bind(this),
      },
      {
        type: ConflictType.STRUCTURAL,
      },
      {
        type: ConflictType.STRUCTURAL,
        complexity: ConflictComplexity.MODERATE,
        resolver: this.resolveStructuralConflict.bind(this),
      },
      {
        type: ConflictType.STRUCTURAL,
        complexity: ConflictComplexity.COMPLEX,
        resolver: this.resolveStructuralConflict.bind(this),
        complexity: ConflictComplexity.SIMPLE,
        resolver: this.resolveStructuralConflict.bind(this),
      },
    ];
  }

  /**
   * Resolves whitespace conflicts by normalizing whitespace
   */
  private async resolveWhitespaceConflict(conflict: GitConflict): Promise<string> {
    const filePath = path.join(this.repoPath, conflict.file);
    const content = await fs.readFile(filePath, 'utf-8');

    let resolvedContent = content;

    for (const hunk of conflict.hunks) {
      // For whitespace conflicts, prefer the incoming content but normalize whitespace
      const normalizedIncoming = this.normalizeWhitespace(hunk.incomingContent);

      // Replace the entire conflict block with normalized content
      const conflictPattern = new RegExp(
        `${this.escapeRegExp(hunk.conflictMarkers.start)}[\\s\\S]*?${this.escapeRegExp(hunk.conflictMarkers.end)}`,
        'g'
      );

      resolvedContent = resolvedContent.replace(conflictPattern, normalizedIncoming);
    }

    return resolvedContent;
  }

  /**
   * Resolves import conflicts by merging and sorting imports
   */
  private async resolveImportConflict(conflict: GitConflict): Promise<string> {
    const filePath = path.join(this.repoPath, conflict.file);
    const content = await fs.readFile(filePath, 'utf-8');

    let resolvedContent = content;

    for (const hunk of conflict.hunks) {
      const currentImports = this.extractImports(hunk.currentContent);
      const incomingImports = this.extractImports(hunk.incomingContent);

      // Merge and deduplicate imports
      const mergedImports = this.mergeImports(currentImports, incomingImports);
      const sortedImports = this.sortImports(mergedImports);

      // Replace conflict block with merged imports
      const conflictPattern = new RegExp(
        `${this.escapeRegExp(hunk.conflictMarkers.start)}[\\s\\S]*?${this.escapeRegExp(hunk.conflictMarkers.end)}`,
        'g'
      );

      resolvedContent = resolvedContent.replace(conflictPattern, sortedImports.join('\n'));
    }

    return resolvedContent;
  }

  /**
   * Resolves structural conflicts using AST analysis
   */
  private async resolveStructuralConflict(conflict: GitConflict): Promise<string> {
    // Check if this is a JavaScript/TypeScript file
    const isJSFile = conflict.file.match(/\.(js|ts|jsx|tsx)$/);

    if (!isJSFile) {
      throw new Error('Structural conflicts are only supported for JavaScript/TypeScript files');
    }

    // Try AST-based resolution first
    const astResult = await this.astResolver.resolveStructuralConflict(conflict);

    if (astResult.success && astResult.resolvedContent) {
      // Replace the conflict in the original file content
      const filePath = path.join(this.repoPath, conflict.file);
      const content = await fs.readFile(filePath, 'utf-8');

      let resolvedContent = content;

      for (const _hunk of conflict.hunks) {
        // Read the file as lines to handle the conflict properly
        const lines = resolvedContent.split('\n');
        let newLines: string[] = [];
        let inConflict = false;
        let foundConflict = false;

        for (const line of lines) {
          if (line.startsWith('<<<<<<<')) {
            // Start of conflict - replace with resolved content
            newLines.push(astResult.resolvedContent);
            inConflict = true;
            foundConflict = true;
          } else if (line.startsWith('>>>>>>>')) {
            // End of conflict - skip this line and stop skipping
            inConflict = false;
          } else if (!inConflict) {
            // Not in conflict - keep the line
            newLines.push(line);
          }
          // If inConflict is true, we skip the line (it's conflict content)
        }

        if (foundConflict) {
          resolvedContent = newLines.join('\n');
          console.log('Successfully replaced conflict block with line-by-line approach');
          console.log('Resolved content preview:', resolvedContent.substring(0, 200) + '...');
        } else {
          console.warn('No conflict markers found in file');
        }
      }

      return resolvedContent;
    }

    // Fallback to simple heuristic-based resolution
    return this.fallbackStructuralResolution(conflict);
  }

  /**
   * Fallback resolution for structural conflicts when AST fails
   */
  private async fallbackStructuralResolution(conflict: GitConflict): Promise<string> {
    const filePath = path.join(this.repoPath, conflict.file);
    const content = await fs.readFile(filePath, 'utf-8');

    let resolvedContent = content;

    for (const hunk of conflict.hunks) {
      // Simple heuristic: if incoming has more lines, use incoming
      // This is often the case when someone adds parameters or functionality
      const currentLines = hunk.currentContent.split('\n').length;
      const incomingLines = hunk.incomingContent.split('\n').length;

      const preferredContent = incomingLines >= currentLines ?
        hunk.incomingContent : hunk.currentContent;

      const conflictPattern = new RegExp(
        `${this.escapeRegExp(hunk.conflictMarkers.start)}[\\s\\S]*?${this.escapeRegExp(hunk.conflictMarkers.end)}`,
        'g'
      );

      resolvedContent = resolvedContent.replace(conflictPattern, preferredContent);
    }

    return resolvedContent;
  }

  /**
   * Normalizes whitespace in content
   */
  private normalizeWhitespace(content: string): string {
    return content
      .replace(/\t/g, '  ') // Convert tabs to 2 spaces
      .replace(/[ ]+$/gm, '') // Remove trailing spaces
      .replace(/\n{3,}/g, '\n\n'); // Limit consecutive newlines to 2
  }

  /**
   * Extracts import statements from code
   */
  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import ') || trimmed.startsWith('const ') && trimmed.includes('require(')) {
        imports.push(trimmed);
      }
    }

    return imports;
  }

  /**
   * Merges two sets of imports, removing duplicates
   */
  private mergeImports(current: string[], incoming: string[]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];

    // Add all unique imports
    for (const imp of [...current, ...incoming]) {
      const normalized = imp.replace(/\s+/g, ' ').trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        merged.push(imp);
      }
    }

    return merged;
  }

  /**
   * Sorts imports by type and alphabetically
   */
  private sortImports(imports: string[]): string[] {
    return imports.sort((a, b) => {
      // Sort by import type first (external libs before relative)
      const aIsExternal = !a.includes('./') && !a.includes('../');
      const bIsExternal = !b.includes('./') && !b.includes('../');

      if (aIsExternal && !bIsExternal) return -1;
      if (!aIsExternal && bIsExternal) return 1;

      // Then sort alphabetically
      return a.localeCompare(b);
    });
  }

  /**
   * Escapes special regex characters
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Writes resolved content to file
   */
  private async writeResolvedFile(filePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.repoPath, filePath);
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  /**
   * Creates a checkpoint branch before making changes
   */
  async createCheckpoint(branchName?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointBranch = branchName || `smugit-checkpoint-${timestamp}`;

    await this.git.checkoutLocalBranch(checkpointBranch);
    return checkpointBranch;
  }

  /**
   * Stages resolved files
   */
  async stageResolvedFiles(files: string[]): Promise<void> {
    for (const file of files) {
      await this.git.add(file);
    }
  }
}
