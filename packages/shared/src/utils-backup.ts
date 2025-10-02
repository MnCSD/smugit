import { ConflictComplexity, ConflictType } from './types';

/**
 * Determines if a conflict is auto-resolvable based on type and complexity
 */
const TRIVIAL_AUTO_TYPES = new Set<ConflictType>([
  ConflictType.WHITESPACE,
  ConflictType.IMPORT,
  ConflictType.STRUCTURAL,
]);

export function isAutoResolvable(type: ConflictType, complexity: ConflictComplexity): boolean {
  if (complexity === ConflictComplexity.TRIVIAL) {
    return TRIVIAL_AUTO_TYPES.has(type);
  }

  if (complexity === ConflictComplexity.SIMPLE &&
      (type === ConflictType.WHITESPACE ||
       type === ConflictType.IMPORT ||
       type === ConflictType.STRUCTURAL)) {
    return true;
  }

  return false;
}

/**
 * Generates a conflict explanation based on type and content
 */
export function generateConflictExplanation(
  type: ConflictType,
  file: string,
  _currentContent: string,
  _incomingContent: string
): string {
  switch (type) {
    case ConflictType.WHITESPACE:
      return `Whitespace differences in ${file}. Usually safe to auto-resolve.`;

    case ConflictType.IMPORT:
      return `Import statement conflicts in ${file}. Different import order or style.`;

    case ConflictType.STRUCTURAL:
      return `Structural changes in ${file}. Code organization differs between branches.`;

    case ConflictType.SEMANTIC:
      return `Semantic conflicts in ${file}. Logic or behavior differs between branches.`;

    case ConflictType.CONTENT:
    default:
      return `Content conflicts in ${file}. Manual review recommended.`;
  }
}

/**
 * Analyzes conflict complexity based on content length and patterns
 */
export function analyzeConflictComplexity(
  currentContent: string,
  incomingContent: string
): ConflictComplexity {
  const currentLines = currentContent.split('\n').length;
  const incomingLines = incomingContent.split('\n').length;
  const totalLines = Math.max(currentLines, incomingLines);

  // Trivial: single line or whitespace-only changes
  if (totalLines <= 1 || isWhitespaceOnly(currentContent, incomingContent)) {
    return ConflictComplexity.TRIVIAL;
  }

  // Simple: few lines, no complex logic
  if (totalLines <= 5 && !hasComplexLogic(currentContent) && !hasComplexLogic(incomingContent)) {
    return ConflictComplexity.SIMPLE;
  }

  // Moderate: medium size or some complexity
  if (totalLines <= 20) {
    return ConflictComplexity.MODERATE;
  }

  // Complex: large changes or high complexity
  return ConflictComplexity.COMPLEX;
}

/**
 * Checks if differences are whitespace-only
 */
function isWhitespaceOnly(content1: string, content2: string): boolean {
  const normalized1 = content1.replace(/\s+/g, ' ').trim();
  const normalized2 = content2.replace(/\s+/g, ' ').trim();
  return normalized1 === normalized2;
}

/**
 * Detects complex logic patterns in code
 */
function hasComplexLogic(content: string): boolean {
  const complexPatterns = [
    /\b(if|else|for|while|switch|try|catch)\b/g,
    /function\s*\(/g,
    /=>\s*{/g,
    /class\s+\w+/g,
    /async\s+/g,
  ];

  return complexPatterns.some(pattern => pattern.test(content));
}

/**
 * Validates conventional commit format
 */
export function isValidConventionalCommit(message: string): boolean {
  const conventionalPattern = /^(feat|fix|docs|style|refactor|test|chore)(\(.+\))?: .{1,50}/;
  return conventionalPattern.test(message);
}

/**
 * Extracts scope from branch name for commit messages
 */
export function extractScopeFromBranch(branchName: string): string | undefined {
  // Extract from patterns like: feature/auth-login, fix/payment-bug
  const patterns = [
    /^(?:feature|feat|fix|hotfix|bugfix)\/([^-]+)/,
    /^([^\/]+)\//,
  ];

  for (const pattern of patterns) {
    const match = branchName.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Determines commit type from file changes
 */
export function inferCommitType(changedFiles: string[]): string {
  const hasTests = changedFiles.some(file =>
    file.includes('test') || file.includes('spec') || file.endsWith('.test.ts')
  );

  const hasDocs = changedFiles.some(file =>
    file.endsWith('.md') || file.includes('doc')
  );

  const hasConfig = changedFiles.some(file =>
    file.includes('config') || file.endsWith('.json') || file.endsWith('.yml')
  );

  if (hasDocs) return 'docs';
  if (hasTests && changedFiles.length === 1) return 'test';
  if (hasConfig) return 'chore';

  // Default to feat for new functionality
  return 'feat';
}
