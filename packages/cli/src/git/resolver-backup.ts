import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { GitConflict, ConflictHunk } from '@smugit/shared';

export interface ASTResolutionResult {
  success: boolean;
  resolvedContent?: string;
  error?: string;
}

export class ASTConflictResolver {
  /**
   * Attempts to resolve a structural conflict using AST analysis
   */
  async resolveStructuralConflict(conflict: GitConflict): Promise<ASTResolutionResult> {
    try {
      // For now, handle single hunk conflicts (most common case)
      if (conflict.hunks.length !== 1) {
        return {
          success: false,
          error: 'Multi-hunk AST resolution not yet supported',
        };
      }

      const hunk = conflict.hunks[0];
      return this.resolveHunkWithAST(hunk);
    } catch (error) {
      return {
        success: false,
        error: `AST resolution failed: ${error}`,
      };
    }
  }

  /**
   * Resolves a single conflict hunk using AST analysis
   */
  private async resolveHunkWithAST(hunk: ConflictHunk): Promise<ASTResolutionResult> {
    try {
      // Clean up the content by converting literal \n to actual newlines
      const cleanCurrentContent = this.cleanConflictContent(hunk.currentContent);
      const cleanIncomingContent = this.cleanConflictContent(hunk.incomingContent);

      const currentAST = this.parseCode(cleanCurrentContent);
      const incomingAST = this.parseCode(cleanIncomingContent);

      if (!currentAST || !incomingAST) {
        return {
          success: false,
          error: 'Failed to parse conflict content as JavaScript',
        };
      }

      // Attempt intelligent merge of function declarations
      const mergedAST = this.mergeFunctionDeclarations(currentAST, incomingAST);

      if (mergedAST) {
        const resolvedCode = generate(mergedAST).code;
        return {
          success: true,
          resolvedContent: resolvedCode,
        };
      }

      return {
        success: false,
        error: 'No resolution strategy found for this structural conflict',
      };
    } catch (error) {
      return {
        success: false,
        error: `AST processing error: ${error}`,
      };
    }
  }

  /**
   * Cleans conflict content by converting literal escape sequences to actual characters
   */
  private cleanConflictContent(content: string): string {
    return content
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .trim();
  }

  /**
   * Safely parses JavaScript code into AST
   */
  private parseCode(code: string): t.File | null {
    try {
      return parse(code, {
        sourceType: 'module',
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        plugins: [
          'jsx',
          'typescript',
          'decorators-legacy',
          'objectRestSpread',
          'functionBind',
          'asyncGenerators',
          'functionSent',
          'dynamicImport',
        ],
      });
    } catch (error) {
      console.warn('Failed to parse as JavaScript:', error);
      return null;
    }
  }

  /**
   * Merges function declarations from two ASTs intelligently
   */
  private mergeFunctionDeclarations(currentAST: t.File, incomingAST: t.File): t.File | null {
    try {
      // Extract function declarations from both sides
      const currentFunctions = this.extractFunctionDeclarations(currentAST);
      const incomingFunctions = this.extractFunctionDeclarations(incomingAST);

      // Find functions with the same name
      const functionsByName = new Map<string, {
        current?: t.FunctionDeclaration;
        incoming?: t.FunctionDeclaration;
      }>();

      currentFunctions.forEach(func => {
        const name = func.id?.name || 'anonymous';
        functionsByName.set(name, { current: func });
      });

      incomingFunctions.forEach(func => {
        const name = func.id?.name || 'anonymous';
        const existing = functionsByName.get(name);
        if (existing) {
          existing.incoming = func;
        } else {
          functionsByName.set(name, { incoming: func });
        }
      });

      // Try to merge functions with same name
      const mergedFunctions: t.FunctionDeclaration[] = [];

      for (const [name, { current, incoming }] of functionsByName) {
        if (current && incoming) {
          // Both sides have the function - try to merge
          const merged = this.mergeFunctionSignatures(current, incoming);
          if (merged) {
            mergedFunctions.push(merged);
          } else {
            // Can't merge - use a heuristic (prefer incoming for now)
            mergedFunctions.push(incoming);
          }
        } else if (current) {
          mergedFunctions.push(current);
        } else if (incoming) {
          mergedFunctions.push(incoming);
        }
      }

      // Create new AST with merged functions
      const mergedAST = t.file(
        t.program(mergedFunctions, [], 'module'),
        [],
        []
      );

      return mergedAST;
    } catch (error) {
      console.warn('Function merge failed:', error);
      return null;
    }
  }

  /**
   * Extracts function declarations from an AST
   */
  private extractFunctionDeclarations(ast: t.File): t.FunctionDeclaration[] {
    const functions: t.FunctionDeclaration[] = [];

    traverse(ast, {
      FunctionDeclaration(path) {
        functions.push(path.node);
      },
    });

    return functions;
  }

  /**
   * Attempts to merge two function signatures intelligently
   */
  private mergeFunctionSignatures(
    current: t.FunctionDeclaration,
    incoming: t.FunctionDeclaration
  ): t.FunctionDeclaration | null {
    try {
      // Check if they have the same name
      const currentName = current.id?.name;
      const incomingName = incoming.id?.name;

      if (currentName !== incomingName) {
        return null;
      }

      // Merge parameters - prefer incoming if they added parameters
      const currentParams = current.params.length;
      const incomingParams = incoming.params.length;

      let mergedFunction: t.FunctionDeclaration;

      if (incomingParams >= currentParams) {
        // Incoming has same or more parameters - use incoming
        mergedFunction = { ...incoming };
      } else {
        // Current has more parameters - use current
        mergedFunction = { ...current };
      }

      // Try to merge function bodies if they're simple additions
      const mergedBody = this.mergeFunctionBodies(current.body, incoming.body);
      if (mergedBody) {
        mergedFunction.body = mergedBody;
      }

      return mergedFunction;
    } catch (error) {
      console.warn('Function signature merge failed:', error);
      return null;
    }
  }

  /**
   * Attempts to merge function bodies
   */
  private mergeFunctionBodies(
    currentBody: t.BlockStatement,
    incomingBody: t.BlockStatement
  ): t.BlockStatement | null {
    try {
      // Simple heuristic: if one body is a subset of the other, use the larger one
      const currentStmts = currentBody.body.length;
      const incomingStmts = incomingBody.body.length;

      // For now, just return the larger function body
      // In the future, we could do more sophisticated merging
      return incomingStmts >= currentStmts ? incomingBody : currentBody;
    } catch (error) {
      console.warn('Function body merge failed:', error);
      return null;
    }
  }

  /**
   * Checks if a conflict involves function declarations
   */
  isFunctionConflict(hunk: ConflictHunk): boolean {
    const hasCurrentFunction = hunk.currentContent.includes('function ') ||
                               hunk.currentContent.match(/\w+\s*\([^)]*\)\s*\{/);
    const hasIncomingFunction = hunk.incomingContent.includes('function ') ||
                                hunk.incomingContent.match(/\w+\s*\([^)]*\)\s*\{/);

    return hasCurrentFunction && hasIncomingFunction;
  }
}