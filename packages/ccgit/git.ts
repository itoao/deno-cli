import { $ } from "jsr:@david/dax@0.40.0";
import type { GitFileChange, SessionMetadata } from "./types.ts";

export async function getGitRoot(): Promise<string> {
  try {
    const result = await $`git rev-parse --show-toplevel`.text();
    return result.trim();
  } catch (error) {
    throw new Error(`Failed to get git root: ${error}`);
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
    throw new Error(`Failed to stash changes: ${error}`);
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
    const statusLines = statusOutput.split('\n').filter(l => l.trim());
    
    return statusLines.map(line => {
      const [status, path] = line.split('\t');
      return { path, status: status as GitFileChange['status'] };
    });
  } catch (error) {
    throw new Error(`Failed to get staged files: ${error}`);
  }
}

export async function commitChanges(
  title: string,
  metadata: SessionMetadata
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
      '',
      `Session-ID: ${metadata.sessionId}`,
      metadata.prompt ? `Prompt: "${metadata.prompt}"` : '',
      `Time: ${metadata.timestamp}`,
      metadata.resumedFrom ? `Resumed-From: ${metadata.resumedFrom}` : '',
    ].filter(Boolean).join('\n');
    
    await $`git commit -m ${message}`.quiet();
  } catch (error) {
    throw new Error(`Failed to commit changes: ${error}`);
  }
}

export async function getCommitsBySessionId(sessionId: string): Promise<string[]> {
  try {
    console.log(`[DEBUG] Searching for sessionId: ${sessionId}`);
    const result = await $`git log --grep="Session-ID: ${sessionId}" --format=%H --all`.text();
    console.log(`[DEBUG] Raw git log result: "${result}"`);
    const commits = result.trim().split('\n').filter(Boolean);
    console.log(`[DEBUG] Parsed commits:`, commits);
    return commits;
  } catch (error) {
    console.log(`[DEBUG] Error in getCommitsBySessionId:`, error);
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
    throw new Error(`Failed to checkout commit: ${error}`);
  }
}

export async function createBranch(name: string): Promise<void> {
  try {
    await $`git checkout -b ${name}`.quiet();
  } catch (error) {
    throw new Error(`Failed to create branch: ${error}`);
  }
}

export async function getFileContent(path: string): Promise<string> {
  try {
    const result = await $`git show :${path}`.text();
    return result;
  } catch (error) {
    throw new Error(`Failed to get file content: ${error}`);
  }
}

export async function getFileDiff(path: string): Promise<string> {
  try {
    const result = await $`git diff --cached ${path}`.text();
    return result;
  } catch (error) {
    throw new Error(`Failed to get file diff: ${error}`);
  }
}