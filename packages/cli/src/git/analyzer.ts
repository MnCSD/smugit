import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import {
  GitConflict,
  ConflictType,
  ConflictComplexity,
  ConflictHunk,
  GitRepository,
  GitStatus,
  GitRemote,
  CommitSuggestion,
  GitCommit,
} from '@smugit/shared';
import {
  analyzeConflictComplexity,
  generateConflictExplanation,
  isAutoResolvable,
  extractScopeFromBranch,
  inferCommitType,
} from '@smugit/shared';
import * as fs from 'fs/promises';
import * as path from 'path';

export class GitAnalyzer {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string = process.cwd()) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  /**
   * Analyzes the current repository state
   */
  async analyzeRepository(): Promise<GitRepository> {
    const status = await this.git.status();
    const branch = await this.git.branch();
    const remotes = await this.git.getRemotes(true);

    return {
      path: this.repoPath,
      branch: branch.current || 'unknown',
      remotes: remotes.map((remote): GitRemote => ({
        name: remote.name,
        url: remote.refs.fetch,
      })),
      status: this.parseGitStatus(status),
    };
  }

  /**
   * Detects and analyzes merge conflicts
   */
  async analyzeConflicts(): Promise<GitConflict[]> {
    const status = await this.git.status();
    const conflictedFiles = status.conflicted;

    if (conflictedFiles.length === 0) {
      return [];
    }

    const conflicts: GitConflict[] = [];

    for (const file of conflictedFiles) {
      try {
        const conflict = await this.analyzeFileConflict(file);
        conflicts.push(conflict);
      } catch (error) {
        console.warn(`Failed to analyze conflict in ${file}:`, error);
      }
    }

    return conflicts;
  }

  /**
   * Analyzes a specific file's conflicts
   */
  private async analyzeFileConflict(filePath: string): Promise<GitConflict> {
    const fullPath = path.join(this.repoPath, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');

    const hunks = this.parseConflictHunks(content);
    const type = this.detectConflictType(filePath, content);
    const complexity = this.determineOverallComplexity(hunks);
    const baseAutoResolvable = isAutoResolvable(type, complexity);
    const contentAutoResolvable =
      type === ConflictType.CONTENT && complexity !== ConflictComplexity.COMPLEX
        ? this.canAutoResolveContent(hunks)
        : false;

    return {
      file: filePath,
      type,
      hunks,
      complexity,
      explanation: generateConflictExplanation(
        type,
        filePath,
        hunks.map(h => h.currentContent).join('\n'),
        hunks.map(h => h.incomingContent).join('\n')
      ),
      autoResolvable: baseAutoResolvable || contentAutoResolvable,
    };
  }

  /**
   * Parses conflict markers in file content
   */
  private parseConflictHunks(content: string): ConflictHunk[] {
    const lines = content.split('\n');
    const hunks: ConflictHunk[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Look for conflict start marker
      if (line.startsWith('<<<<<<<')) {
        const startLine = i;
        const currentContent: string[] = [];
        const incomingContent: string[] = [];
        let baseContent = '';
        let separatorLine = -1;
        let endLine = -1;

        i++; // Move past start marker

        // Collect current content (until separator)
        while (i < lines.length && !lines[i].startsWith('=======')) {
          if (lines[i].startsWith('|||||||')) {
            // Handle 3-way merge with base
            i++;
            const baseLines: string[] = [];
            while (i < lines.length && !lines[i].startsWith('=======')) {
              baseLines.push(lines[i]);
              i++;
            }
            baseContent = baseLines.join('\n');
          } else {
            currentContent.push(lines[i]);
          }
          i++;
        }

        if (i < lines.length && lines[i].startsWith('=======')) {
          separatorLine = i;
          i++; // Move past separator

          // Collect incoming content (until end marker)
          while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
            incomingContent.push(lines[i]);
            i++;
          }

          if (i < lines.length && lines[i].startsWith('>>>>>>>')) {
            endLine = i;

            hunks.push({
              startLine: startLine + 1, // Convert to 1-based
              endLine: endLine + 1,
              baseContent,
              currentContent: currentContent.join('\n'),
              incomingContent: incomingContent.join('\n'),
              conflictMarkers: {
                start: lines[startLine],
                separator: lines[separatorLine],
                end: lines[endLine],
              },
            });
          }
        }
      }

      i++;
    }

    return hunks;
  }

  /**
   * Detects the type of conflict based on file and content analysis
   */
  private detectConflictType(_filePath: string, content: string): ConflictType {
    // Check for import/require conflicts
    if (content.includes('import ') || content.includes('require(')) {
      return ConflictType.IMPORT;
    }

    // Check for whitespace-only conflicts
    const conflictBlocks = content.match(/<<<<<<< .*?\n(.*?)\n=======\n(.*?)\n>>>>>>> .*?\n/gs);
    if (conflictBlocks) {
      const hasOnlyWhitespace = conflictBlocks.every(block => {
        const [, current, incoming] = block.match(/<<<<<<< .*?\n(.*?)\n=======\n(.*?)\n>>>>>>> .*?\n/s) || [];
        return current?.replace(/\s+/g, ' ').trim() === incoming?.replace(/\s+/g, ' ').trim();
      });

      if (hasOnlyWhitespace) {
        return ConflictType.WHITESPACE;
      }
    }

    // Check for structural changes (class, function declarations)
    if (content.includes('class ') || content.includes('function ') || content.includes('interface ')) {
      return ConflictType.STRUCTURAL;
    }

    // Default to content conflict
    return ConflictType.CONTENT;
  }

  /**
   * Determines overall complexity from multiple hunks
   */
  private determineOverallComplexity(hunks: ConflictHunk[]): ConflictComplexity {
    if (hunks.length === 0) return ConflictComplexity.TRIVIAL;

    const complexities = hunks.map(hunk =>
      analyzeConflictComplexity(hunk.currentContent, hunk.incomingContent)
    );

    // Return the highest complexity found
    if (complexities.includes(ConflictComplexity.COMPLEX)) return ConflictComplexity.COMPLEX;
    if (complexities.includes(ConflictComplexity.MODERATE)) return ConflictComplexity.MODERATE;
    if (complexities.includes(ConflictComplexity.SIMPLE)) return ConflictComplexity.SIMPLE;
    return ConflictComplexity.TRIVIAL;
  }

  private canAutoResolveContent(hunks: ConflictHunk[]): boolean {
    return hunks.every(hunk => this.isSimpleContentPattern(hunk));
  }

  private isSimpleContentPattern(hunk: ConflictHunk): boolean {
    const trimmedCurrent = hunk.currentContent.trim();
    const trimmedIncoming = hunk.incomingContent.trim();

    if (!trimmedCurrent || !trimmedIncoming) {
      return true;
    }

    if (trimmedCurrent === trimmedIncoming) {
      return true;
    }

    const normalizedCurrent = trimmedCurrent.replace(/\s+/g, ' ');
    const normalizedIncoming = trimmedIncoming.replace(/\s+/g, ' ');

    if (normalizedCurrent === normalizedIncoming) {
      return true;
    }

    const currentLines = this.splitLines(hunk.currentContent);
    const incomingLines = this.splitLines(hunk.incomingContent);

    if (this.isSubsetLines(currentLines, incomingLines) || this.isSubsetLines(incomingLines, currentLines)) {
      return true;
    }

    if (this.isLikelyList(currentLines) && this.isLikelyList(incomingLines)) {
      return true;
    }

    if (this.isKeyValueBlock(currentLines) && this.isKeyValueBlock(incomingLines)) {
      return true;
    }

    return false;
  }

  private splitLines(content: string): string[] {
    return content.split('\n');
  }

  private isSubsetLines(source: string[], target: string[]): boolean {
    const targetSet = new Set(target.map(line => line.trim()).filter(Boolean));
    const meaningfulSource = source.map(line => line.trim()).filter(Boolean);

    if (meaningfulSource.length === 0) {
      return true;
    }

    return meaningfulSource.every(line => targetSet.has(line));
  }

  private isLikelyList(lines: string[]): boolean {
    const bulletPattern = /^\s*(?:[-*+]|\d+\.)\s+/;
    let hasEntries = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (!bulletPattern.test(trimmed)) {
        return false;
      }

      hasEntries = true;
    }

    return hasEntries;
  }

  private isKeyValueBlock(lines: string[]): boolean {
    const kvPattern = /^\s*["']?[\w.-]+["']?\s*[:=]/;
    let hasEntries = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (!kvPattern.test(trimmed)) {
        return false;
      }

      hasEntries = true;
    }

    return hasEntries;
  }

  /**
   * Generates commit message suggestions based on changes
   */
  async generateCommitSuggestion(): Promise<CommitSuggestion> {
    const status = await this.git.status();
    const branch = await this.git.branch();
    const diff = await this.git.diff(['--cached']);

    const changedFiles = [...status.staged, ...status.modified];
    const type = inferCommitType(changedFiles);
    const scope = extractScopeFromBranch(branch.current || '');

    // Analyze the diff to create a meaningful description
    const description = this.generateDescriptionFromDiff(diff, changedFiles);

    return {
      type,
      scope,
      description,
      confidence: this.calculateConfidence(diff, changedFiles),
    };
  }

  /**
   * Generates description from git diff
   */
  private generateDescriptionFromDiff(_diff: string, files: string[]): string {
    if (files.length === 1) {
      const fileName = path.basename(files[0]);
      return `update ${fileName}`;
    }

    if (files.length <= 3) {
      return `update ${files.map(f => path.basename(f)).join(', ')}`;
    }

    // For many files, use a more generic description
    const extensions = [...new Set(files.map(f => path.extname(f)))];
    if (extensions.length === 1 && extensions[0]) {
      return `update ${extensions[0].slice(1)} files`;
    }

    return `update ${files.length} files`;
  }

  /**
   * Calculates confidence score for commit suggestion
   */
  private calculateConfidence(diff: string, files: string[]): number {
    let confidence = 0.5; // Base confidence

    // Higher confidence for single file changes
    if (files.length === 1) confidence += 0.2;

    // Higher confidence for specific file types
    const hasTestFiles = files.some(f => f.includes('test') || f.includes('spec'));
    const hasDocFiles = files.some(f => f.endsWith('.md'));

    if (hasTestFiles || hasDocFiles) confidence += 0.2;

    // Lower confidence for very large diffs
    const diffLines = diff.split('\n').length;
    if (diffLines > 500) confidence -= 0.2;

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Converts simple-git status to our GitStatus format
   */
  private parseGitStatus(status: StatusResult): GitStatus {
    return {
      ahead: status.ahead,
      behind: status.behind,
      staged: status.staged,
      modified: status.modified,
      untracked: status.not_added,
      conflicted: status.conflicted,
    };
  }

  /**
   * Gets commit history for rebase analysis
   */
  async getCommitHistory(limit: number = 10): Promise<GitCommit[]> {
    const log = await this.git.log({ maxCount: limit });

    return log.all.map((commit): GitCommit => ({
      hash: commit.hash,
      author: commit.author_name,
      date: commit.date,
      message: commit.message,
      files: [], // Would need additional git call to get files
      insertions: 0, // Would need additional parsing
      deletions: 0, // Would need additional parsing
    }));
  }
}
