import { ConflictResolutionPlugin } from './types';

const registry = new Map<string, ConflictResolutionPlugin>();

export function registerConflictResolutionPlugin(plugin: ConflictResolutionPlugin): void {
  registry.set(plugin.name, plugin);
}

export function getConflictResolutionPlugins(): ConflictResolutionPlugin[] {
  return Array.from(registry.values()).sort((a, b) => {
    const priorityA = a.priority ?? 100;
    const priorityB = b.priority ?? 100;
    return priorityA - priorityB;
  });
}
