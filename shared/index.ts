export {
  categorizeFiles,
  generateCommitTitle,
  generateFallbackTitle,
} from "./commit-title-generator.ts";

export type {
  ClaudeOutput,
  GitCommitInfo,
  GitFileChange,
  SessionMetadata,
} from "./types.ts";

export {
  checkoutCommit,
  commitChanges,
  createBranch,
  createCommit,
  executeGitCommand,
  getCommitsBySessionId,
  getFileContent,
  getFileDiff,
  getGitRoot,
  getGitStagedFiles,
  getStagedFiles,
  hasChangesToCommit,
  hasUncommittedChanges,
  popStash,
  stashChanges,
} from "./git-operations.ts";

export {
  AppError,
  type ErrorHandlerOptions,
  handleError,
  handleGitError,
  rethrowError,
  warn,
  withErrorHandling,
  withSyncErrorHandling,
} from "./error-handler.ts";

export { type Logger, logger } from "./logger.ts";
