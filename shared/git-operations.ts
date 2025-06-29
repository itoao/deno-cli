import { $ } from "jsr:@david/dax@0.40.0";
import type { GitFileChange, SessionMetadata } from "./types.ts";
import { rethrowError, warn } from "./error-handler.ts";
import { logger } from "./logger.ts";

export async function getGitRoot(): Promise<string> {
  try {
    const result = await $`git rev-parse --show-toplevel`.text();
    return result.trim();
  } catch (error) {
    rethrowError(error, "Failed to get git root", "GIT_ROOT_ERROR");
  }
}

export async function executeGitCommand(args: string[]): Promise<string> {
  try {
    const gitRoot = await getGitRoot();
    const result = await $`git ${args}`.cwd(gitRoot).text();
    return result;
  } catch (error) {
    rethrowError(
      error,
      `Git command failed: git ${args.join(" ")}`,
      "GIT_COMMAND_ERROR",
    );
  }
}

export async function hasUncommittedChanges(): Promise<boolean> {
  try {
    await $`git diff --quiet`.quiet();
    await $`git diff --cached --quiet`.quiet();
    return false;
  } catch {
    return true;
  }
}

export async function stashChanges(): Promise<boolean> {
  try {
    const hasChanges = await hasUncommittedChanges();
    if (hasChanges) {
      await $`git stash push -m "ccgit: temporary stash"`.quiet();
      return true;
    }
    return false;
  } catch (error) {
    rethrowError(error, "Failed to stash changes", "GIT_STASH_ERROR");
  }
}

export async function popStash(): Promise<void> {
  try {
    await $`git stash pop`.quiet();
  } catch {
    // Ignore errors (might not have stashed)
  }
}

export async function getStagedFiles(): Promise<GitFileChange[]> {
  try {
    const statusOutput = await $`git diff --cached --name-status`.text();
    const statusLines = statusOutput.split("\n").filter((l) => l.trim());

    return statusLines.map((line) => {
      const [status, path] = line.split("\t");
      return { path, status: status as GitFileChange["status"] };
    });
  } catch (error) {
    rethrowError(error, "Failed to get staged files", "GIT_STAGED_FILES_ERROR");
  }
}

export async function getGitStagedFiles(): Promise<GitFileChange[]> {
  try {
    const statusOutput = await executeGitCommand([
      "diff",
      "--cached",
      "--name-status",
    ]);
    const statusLines = statusOutput.split("\n").filter((l) => l.trim());

    if (statusLines.length === 0) {
      return [];
    }

    const filePromises = statusLines.map(async (line) => {
      const parts = line.split("\t");
      if (parts.length < 2) return null;

      const status = parts[0] as GitFileChange["status"];
      const path = parts[1];

      try {
        let diff: string;
        if (status === "A") {
          // For new files, use git show to get the content
          diff = await executeGitCommand(["show", `--format=`, `:${path}`]);
        } else {
          // For modified/deleted files, use git diff
          diff = await executeGitCommand(["diff", "--cached", path]);
        }
        return { path, status, diff } as GitFileChange;
      } catch (error) {
        warn(
          `Failed to get diff for ${path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return { path, status, diff: "" };
      }
    });

    const results = await Promise.all(filePromises);
    return results.filter((file): file is GitFileChange => file !== null);
  } catch (error) {
    rethrowError(error, "Failed to get staged files", "GIT_STAGED_FILES_ERROR");
  }
}

export async function commitChanges(
  title: string,
  metadata: SessionMetadata,
): Promise<void> {
  try {
    // Stage all changes
    await $`git add -A`.quiet();

    // Check if there are staged changes to commit
    try {
      await $`git diff --cached --quiet`.quiet();
      // If no error, there are no staged changes
      return;
    } catch {
      // Error means there are staged changes, proceed with commit
    }

    // Build commit message with metadata
    const message = [
      title,
      "",
      `Session-ID: ${metadata.sessionId}`,
      metadata.prompt ? `Prompt: "${metadata.prompt}"` : "",
      `Time: ${metadata.timestamp}`,
      metadata.resumedFrom ? `Resumed-From: ${metadata.resumedFrom}` : "",
    ].filter(Boolean).join("\n");

    await $`git commit -m ${message}`.quiet();
  } catch (error) {
    rethrowError(error, "Failed to commit changes", "GIT_COMMIT_ERROR");
  }
}

export async function getCommitsBySessionId(
  sessionId: string,
): Promise<string[]> {
  try {
    const result = await $`git log --grep='Session-ID: ${sessionId}' --format=%H --all`
      .text();
    return result.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function checkoutCommit(commitHash: string): Promise<void> {
  try {
    // First verify the commit exists
    await $`git rev-parse --verify ${commitHash}`.quiet();
    // Then checkout
    await $`git checkout ${commitHash}`.quiet();
  } catch (error) {
    rethrowError(error, "Failed to checkout commit", "GIT_CHECKOUT_ERROR");
  }
}

export async function createBranch(name: string): Promise<void> {
  try {
    await $`git checkout -b ${name}`.quiet();
  } catch (error) {
    rethrowError(error, "Failed to create branch", "GIT_BRANCH_ERROR");
  }
}

export async function getFileContent(path: string): Promise<string> {
  try {
    const result = await $`git show :${path}`.text();
    return result;
  } catch (error) {
    rethrowError(error, "Failed to get file content", "GIT_FILE_CONTENT_ERROR");
  }
}

export async function getFileDiff(path: string): Promise<string> {
  try {
    const result = await $`git diff --cached ${path}`.text();
    return result;
  } catch (error) {
    rethrowError(error, "Failed to get file diff", "GIT_FILE_DIFF_ERROR");
  }
}

export async function hasChangesToCommit(): Promise<boolean> {
  try {
    await executeGitCommand(["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    return true;
  }
}

export async function createCommit(
  files: GitFileChange[],
  title: string,
): Promise<void> {
  const filePaths = files.map((f) => f.path);

  try {
    await executeGitCommand(["reset"]);
    await executeGitCommand(["add", ...filePaths]);

    const hasChanges = await hasChangesToCommit();
    if (!hasChanges) {
      logger.warn(`No changes to commit for: ${filePaths.join(", ")}`);
      return;
    }

    await executeGitCommand(["commit", "-m", title]);
    logger.log(`✅ ${title}`);
  } catch (error) {
    rethrowError(error, "Failed to create commit", "GIT_CREATE_COMMIT_ERROR");
  }
}
