export { 
  generateCommitTitle,
  categorizeFiles,
  generateFallbackTitle
} from "./commit-title-generator.ts";

export type {
  SessionMetadata,
  GitCommitInfo,
  ClaudeOutput,
  GitFileChange
} from "./types.ts";

export {
  getGitRoot,
  executeGitCommand,
  hasUncommittedChanges,
  stashChanges,
  popStash,
  getStagedFiles,
  getGitStagedFiles,
  commitChanges,
  getCommitsBySessionId,
  checkoutCommit,
  createBranch,
  getFileContent,
  getFileDiff,
  hasChangesToCommit,
  createCommit
} from "./git-operations.ts";