export { 
  generateCommitTitle,
  categorizeFiles,
  generateFallbackTitle,
  type GitFileChange
} from "./commit-title-generator.ts";

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