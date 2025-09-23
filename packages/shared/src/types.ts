import { z } from 'zod';

// Git-related types
export interface GitConflict {
  file: string;
  type: ConflictType;
  hunks: ConflictHunk[];
  complexity: ConflictComplexity;
  explanation?: string;
  autoResolvable: boolean;
}

export interface ConflictHunk {
  startLine: number;
  endLine: number;
  baseContent: string;
  currentContent: string;
  incomingContent: string;
  conflictMarkers: {
    start: string;
    separator: string;
    end: string;
  };
}

export enum ConflictType {
  CONTENT = 'content',
  WHITESPACE = 'whitespace',
  IMPORT = 'import',
  STRUCTURAL = 'structural',
  SEMANTIC = 'semantic',
}

export enum ConflictComplexity {
  TRIVIAL = 'trivial',
  SIMPLE = 'simple',
  MODERATE = 'moderate',
  COMPLEX = 'complex',
}

// Commit-related types
export interface CommitSuggestion {
  type: string;
  scope?: string;
  description: string;
  body?: string;
  footer?: string;
  confidence: number;
}

export interface GitRepository {
  path: string;
  branch: string;
  remotes: GitRemote[];
  status: GitStatus;
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitStatus {
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  untracked: string[];
  conflicted: string[];
}

// Rebase-related types
export interface RebaseInfo {
  commits: GitCommit[];
  conflicts: GitConflict[];
  plan: RebasePlan;
}

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
  files: string[];
  insertions: number;
  deletions: number;
}

export interface RebasePlan {
  operations: RebaseOperation[];
  estimatedConflicts: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface RebaseOperation {
  action: 'pick' | 'squash' | 'fixup' | 'edit' | 'reword' | 'drop';
  commit: string;
  message?: string;
}

// API schemas using Zod
export const GitConflictSchema = z.object({
  file: z.string(),
  type: z.nativeEnum(ConflictType),
  hunks: z.array(z.object({
    startLine: z.number(),
    endLine: z.number(),
    baseContent: z.string(),
    currentContent: z.string(),
    incomingContent: z.string(),
    conflictMarkers: z.object({
      start: z.string(),
      separator: z.string(),
      end: z.string(),
    }),
  })),
  complexity: z.nativeEnum(ConflictComplexity),
  explanation: z.string().optional(),
  autoResolvable: z.boolean(),
});

export const CommitSuggestionSchema = z.object({
  type: z.string(),
  scope: z.string().optional(),
  description: z.string(),
  body: z.string().optional(),
  footer: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export type GitConflictInput = z.input<typeof GitConflictSchema>;
export type CommitSuggestionInput = z.input<typeof CommitSuggestionSchema>;