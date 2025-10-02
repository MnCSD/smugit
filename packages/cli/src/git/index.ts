export { GitAnalyzer } from './analyzer';
export { ConflictResolver, type ResolutionResult } from './resolver';
export {
  getConflictResolutionPlugins,
  registerConflictResolutionPlugin,
} from './plugins/registry';
export type {
  ConflictResolutionPlugin,
  ConflictResolutionContext,
} from './plugins/types';
