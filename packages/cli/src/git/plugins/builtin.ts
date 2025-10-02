import { ConflictComplexity, ConflictType, GitConflict } from '@smugit/shared';
import { ConflictResolutionPlugin, ConflictResolutionContext, PluginResolution } from './types';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function replaceConflictBlocks(
  conflict: GitConflict,
  context: ConflictResolutionContext,
  replacer: (hunkIndex: number) => string
): Promise<string> {
  let resolvedContent = await context.readFile(conflict.file);

  conflict.hunks.forEach((hunk, index) => {
    const replacement = replacer(index);
    const conflictPattern = new RegExp(
      `${escapeRegExp(hunk.conflictMarkers.start)}[\\s\\S]*?${escapeRegExp(hunk.conflictMarkers.end)}`,
      's'
    );

    resolvedContent = resolvedContent.replace(conflictPattern, replacement);
  });

  return resolvedContent;
}

function normalizeWhitespace(content: string): string {
  return content
    .replace(/\t/g, '  ')
    .replace(/[ ]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('import ') || (trimmed.startsWith('const ') && trimmed.includes('require('))) {
      imports.push(trimmed);
    }
  }

  return imports;
}

function mergeImports(current: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const imp of [...current, ...incoming]) {
    const normalized = imp.replace(/\s+/g, ' ').trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      merged.push(imp);
    }
  }

  return merged;
}

function sortImports(imports: string[]): string[] {
  return imports.sort((a, b) => {
    const aIsExternal = !a.includes('./') && !a.includes('../');
    const bIsExternal = !b.includes('./') && !b.includes('../');

    if (aIsExternal && !bIsExternal) return -1;
    if (!aIsExternal && bIsExternal) return 1;

    return a.localeCompare(b);
  });
}

function splitLines(content: string): string[] {
  return content.split('\n');
}

function joinLines(lines: string[]): string {
  return lines.join('\n');
}

function isSubsetLines(source: string[], target: string[]): boolean {
  const targetSet = new Set(target.map(line => line.trim()).filter(Boolean));
  const meaningfulSource = source.map(line => line.trim()).filter(Boolean);

  if (meaningfulSource.length === 0) {
    return true;
  }

  return meaningfulSource.every(line => targetSet.has(line));
}

function isLikelyList(lines: string[]): boolean {
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

function mergeListLines(currentLines: string[], incomingLines: string[]): string {
  const merged: string[] = [];
  const seen = new Set<string>();

  const pushLine = (line: string) => {
    if (!line.trim()) {
      merged.push(line);
      return;
    }

    const normalized = line.trim();
    if (seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    merged.push(line.trimEnd());
  };

  currentLines.forEach(pushLine);
  incomingLines.forEach(pushLine);

  return merged.join('\n');
}

interface KeyValueEntry {
  key: string;
  prefix: string;
  value: string;
  suffix: string;
  line: string;
  raw?: boolean;
}

function isKeyValueBlock(lines: string[]): boolean {
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

function parseKeyValueLine(line: string): KeyValueEntry | undefined {
  const match = line.match(/^(\s*["']?[\w.-]+["']?\s*[:=]\s*)(.*?)(\s*,?\s*)$/);
  if (!match) {
    return undefined;
  }

  const [, prefix, value, suffix] = match;
  const keyMatch = prefix.match(/["']?([\w.-]+)["']?\s*[:=]\s*$/);
  if (!keyMatch) {
    return undefined;
  }

  return {
    key: keyMatch[1],
    prefix,
    value,
    suffix: suffix || '',
    line,
  };
}

function mergeKeyValueLines(currentLines: string[], incomingLines: string[]): string | undefined {
  const entries = new Map<string, KeyValueEntry>();
  const order: string[] = [];
  const blankPrefix = '__blank__';

  const processLine = (line: string, preferIncoming: boolean): boolean => {
    if (!line.trim()) {
      const placeholder = `${blankPrefix}${order.length}`;
      if (!entries.has(placeholder)) {
        entries.set(placeholder, { key: placeholder, prefix: '', value: '', suffix: '', line, raw: true });
        order.push(placeholder);
      } else if (preferIncoming) {
        entries.set(placeholder, { key: placeholder, prefix: '', value: '', suffix: '', line, raw: true });
      }
      return true;
    }

    const parsed = parseKeyValueLine(line);
    if (!parsed) {
      return false;
    }

    if (!entries.has(parsed.key)) {
      entries.set(parsed.key, parsed);
      order.push(parsed.key);
      return true;
    }

    if (preferIncoming) {
      entries.set(parsed.key, parsed);
    }

    return true;
  };

  for (const line of currentLines) {
    if (!processLine(line, false)) {
      return undefined;
    }
  }

  for (const line of incomingLines) {
    if (!processLine(line, true)) {
      return undefined;
    }
  }

  const structuredKeys = order.filter(key => {
    const entry = entries.get(key);
    return entry !== undefined && !entry.raw;
  });

  const lastStructuredKey = structuredKeys[structuredKeys.length - 1];
  const isJsonStyle = structuredKeys.some(key => {
    const entry = entries.get(key);
    return entry ? /"/.test(entry.prefix) : false;
  });

  return order
    .map(key => {
      const entry = entries.get(key);
      if (!entry) {
        return '';
      }

      if (entry.raw) {
        return entry.line;
      }

      let suffix = entry.suffix;

      if (isJsonStyle) {
        if (key !== lastStructuredKey && !suffix.trim().endsWith(',')) {
          suffix = suffix.replace(/\s*$/, ',');
        }

        if (key === lastStructuredKey && suffix.trim().endsWith(',')) {
          suffix = suffix.replace(/,\s*$/, '');
        }
      }

      return `${entry.prefix}${entry.value}${suffix}`.replace(/\s+$/, '');
    })
    .join('\n');
}

function computeContentReplacement(conflict: GitConflict, hunkIndex: number): string | undefined {
  const hunk = conflict.hunks[hunkIndex];
  const trimmedCurrent = hunk.currentContent.trim();
  const trimmedIncoming = hunk.incomingContent.trim();

  if (!trimmedCurrent && !trimmedIncoming) {
    return '';
  }

  if (!trimmedCurrent) {
    return hunk.incomingContent;
  }

  if (!trimmedIncoming) {
    return hunk.currentContent;
  }

  if (trimmedCurrent === trimmedIncoming) {
    return hunk.currentContent;
  }

  const normalizedCurrent = normalizeWhitespace(trimmedCurrent);
  const normalizedIncoming = normalizeWhitespace(trimmedIncoming);

  if (normalizedCurrent === normalizedIncoming) {
    return normalizeWhitespace(hunk.currentContent);
  }

  const currentLines = splitLines(hunk.currentContent);
  const incomingLines = splitLines(hunk.incomingContent);

  if (isSubsetLines(currentLines, incomingLines)) {
    return joinLines(incomingLines);
  }

  if (isSubsetLines(incomingLines, currentLines)) {
    return joinLines(currentLines);
  }

  if (isLikelyList(currentLines) && isLikelyList(incomingLines)) {
    return mergeListLines(currentLines, incomingLines);
  }

  if (isKeyValueBlock(currentLines) && isKeyValueBlock(incomingLines)) {
    return mergeKeyValueLines(currentLines, incomingLines);
  }

  return undefined;
}

const whitespacePlugin: ConflictResolutionPlugin = {
  name: 'whitespace-normalizer',
  priority: 10,
  supports(conflict) {
    return conflict.type === ConflictType.WHITESPACE;
  },
  async resolve(conflict, context) {
    const resolvedContent = await replaceConflictBlocks(conflict, context, index => {
      const hunk = conflict.hunks[index];
      return normalizeWhitespace(hunk.incomingContent);
    });

    return {
      content: resolvedContent,
      notes: ['Normalized whitespace differences'],
    };
  },
};

const importPlugin: ConflictResolutionPlugin = {
  name: 'import-merge',
  priority: 20,
  supports(conflict) {
    return conflict.type === ConflictType.IMPORT;
  },
  async resolve(conflict, context) {
    const resolvedContent = await replaceConflictBlocks(conflict, context, index => {
      const hunk = conflict.hunks[index];
      const currentImports = extractImports(hunk.currentContent);
      const incomingImports = extractImports(hunk.incomingContent);
      const mergedImports = mergeImports(currentImports, incomingImports);
      const sortedImports = sortImports(mergedImports);
      return sortedImports.join('\n');
    });

    return {
      content: resolvedContent,
      notes: ['Merged and sorted import statements'],
    };
  },
};

const simpleContentPlugin: ConflictResolutionPlugin = {
  name: 'simple-content-merge',
  priority: 30,
  supports(conflict) {
    if (conflict.type !== ConflictType.CONTENT) {
      return false;
    }

    if (conflict.complexity === ConflictComplexity.COMPLEX) {
      return false;
    }

    return conflict.hunks.every((_, index) => computeContentReplacement(conflict, index) !== undefined);
  },
  async resolve(conflict, context) {
    const replacements: string[] = [];
    const resolvedContent = await replaceConflictBlocks(conflict, context, index => {
      const replacement = computeContentReplacement(conflict, index);
      if (replacement === undefined) {
        throw new Error('Simple content plugin could not compute replacement');
      }
      replacements.push(replacement);
      return replacement;
    });

    const notes: string[] = [];
    if (conflict.hunks.length === replacements.length) {
      notes.push('Merged compatible content blocks');
    }

    return {
      content: resolvedContent,
      notes,
    };
  },
};

export const builtinPlugins: ConflictResolutionPlugin[] = [
  whitespacePlugin,
  importPlugin,
  simpleContentPlugin,
];
