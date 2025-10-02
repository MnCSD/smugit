import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

/**
 * Extracts class declarations from an AST
 */
export function extractClassDeclarations(ast: t.File): t.ClassDeclaration[] {
  const classes: t.ClassDeclaration[] = [];

  traverse(ast, {
    ClassDeclaration(path) {
      classes.push(path.node);
    },
  });

  return classes;
}

/**
 * Merges class declarations intelligently by combining unique methods and properties
 */
export function mergeClassDeclarations(
  currentClasses: t.ClassDeclaration[],
  incomingClasses: t.ClassDeclaration[]
): t.ClassDeclaration[] {
  const classesByName = new Map<string, {
    current?: t.ClassDeclaration;
    incoming?: t.ClassDeclaration;
  }>();

  // Group classes by name
  currentClasses.forEach(cls => {
    const name = cls.id?.name || 'anonymous';
    classesByName.set(name, { current: cls });
  });

  incomingClasses.forEach(cls => {
    const name = cls.id?.name || 'anonymous';
    const existing = classesByName.get(name);
    if (existing) {
      existing.incoming = cls;
    } else {
      classesByName.set(name, { incoming: cls });
    }
  });

  const mergedClasses: t.ClassDeclaration[] = [];

  for (const [_name, { current, incoming }] of classesByName) {
    if (current && incoming) {
      // Both sides have the class - merge their members
      const merged = mergeClassMembers(current, incoming);
      mergedClasses.push(merged);
    } else if (current) {
      mergedClasses.push(current);
    } else if (incoming) {
      mergedClasses.push(incoming);
    }
  }

  return mergedClasses;
}

/**
 * Merges members (methods and properties) from two class declarations
 */
function mergeClassMembers(
  current: t.ClassDeclaration,
  incoming: t.ClassDeclaration
): t.ClassDeclaration {
  const membersByKey = new Map<string, t.ClassMethod | t.ClassProperty>();

  // Helper to get a unique key for a class member
  const getMemberKey = (member: t.ClassMethod | t.ClassProperty): string | null => {
    if (t.isClassMethod(member) && t.isIdentifier(member.key)) {
      return `method:${member.key.name}`;
    } else if (t.isClassProperty(member) && t.isIdentifier(member.key)) {
      return `property:${member.key.name}`;
    }
    return null;
  };

  // Collect all members from current class
  current.body.body.forEach((member) => {
    if (t.isClassMethod(member) || t.isClassProperty(member)) {
      const key = getMemberKey(member);
      if (key) {
        membersByKey.set(key, member);
      }
    }
  });

  // Add/override with members from incoming class
  incoming.body.body.forEach((member) => {
    if (t.isClassMethod(member) || t.isClassProperty(member)) {
      const key = getMemberKey(member);
      if (key) {
        const existing = membersByKey.get(key);
        if (existing) {
          // Both sides have this member - prefer the one with more complexity
          if (t.isClassMethod(existing) && t.isClassMethod(member)) {
            const existingStmts = existing.body.body.length;
            const incomingStmts = member.body.body.length;
            membersByKey.set(key, incomingStmts >= existingStmts ? member : existing);
          } else {
            // For properties, prefer incoming
            membersByKey.set(key, member);
          }
        } else {
          // Only in incoming - add it
          membersByKey.set(key, member);
        }
      }
    }
  });

  // Create merged class with all unique members
  const mergedClass: t.ClassDeclaration = {
    ...current,
    body: t.classBody(Array.from(membersByKey.values())),
  };

  return mergedClass;
}

/**
 * Extracts other top-level statements (exports, etc.)
 */
export function extractOtherStatements(currentAST: t.File, incomingAST: t.File): t.Statement[] {
  const statements: t.Statement[] = [];
  const seen = new Set<string>();

  // Helper to get statement key for deduplication
  const getStatementKey = (stmt: t.Statement): string => {
    if (t.isExportDefaultDeclaration(stmt)) {
      return 'export:default';
    } else if (t.isExportNamedDeclaration(stmt)) {
      return `export:named:${generate(stmt).code}`;
    } else if (t.isVariableDeclaration(stmt)) {
      const names = stmt.declarations.map(d =>
        t.isIdentifier(d.id) ? d.id.name : 'unknown'
      ).join(',');
      return `var:${names}`;
    }
    return `stmt:${generate(stmt).code}`;
  };

  [currentAST, incomingAST].forEach(ast => {
    ast.program.body.forEach(stmt => {
      // Skip class and function declarations (handled separately)
      if (t.isClassDeclaration(stmt) || t.isFunctionDeclaration(stmt)) {
        return;
      }

      const key = getStatementKey(stmt);
      if (!seen.has(key)) {
        seen.add(key);
        statements.push(stmt);
      }
    });
  });

  return statements;
}
