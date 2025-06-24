import { assertEquals, assertExists, assertRejects } from "@std/assert";
import * as path from "https://deno.land/std@0.208.0/path/mod.ts";

// Test helper to create temporary directories
async function createTempDir(): Promise<string> {
  return await Deno.makeTempDir();
}

// Test helper to cleanup temporary directories
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch {
    // ignore cleanup errors
  }
}

// Import functions to test
import {
  createFileWatcher,
  watchFileChanges,
  commitFileChanges,
} from "./main.ts";

Deno.test("createFileWatcher should return FileWatcherOptions with correct defaults", () => {
  const watcher = createFileWatcher();
  
  try {
    assertExists(watcher.watcher);
    assertEquals(watcher.watcherActive, true);
    assertEquals(watcher.commitInProgress, false);
    assertEquals(watcher.lastCommitTime, 0);
    assertEquals(watcher.changeBuffer, false);
  } finally {
    // Clean up to prevent resource leaks
    watcher.watcher.close();
  }
});

Deno.test("watchFileChanges should handle file changes with debounce", async () => {
  const tempDir = await createTempDir();
  
  try {
    // Create a mock file watcher that we can control
    const mockWatcher = {
      watcher: Deno.watchFs(tempDir),
      watcherActive: true,
      commitInProgress: false,
      lastCommitTime: Date.now() - 1000, // Set in the past to allow commits
      changeBuffer: false,
      debounceTimer: undefined,
    };

    // Start watching (this should run in background)
    const watchPromise = watchFileChanges(mockWatcher);
    
    // Create a file to trigger the watcher
    const testFile = path.join(tempDir, "test.txt");
    await Deno.writeTextFile(testFile, "test content");
    
    // Wait a bit for file system events
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify that changes were detected
    assertEquals(mockWatcher.changeBuffer, true, "Should detect file changes");
    
    // Stop the watcher early to prevent git operations
    mockWatcher.watcherActive = false;
    mockWatcher.watcher.close();
    
    await watchPromise;
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("commitFileChanges should handle no git repository gracefully", async () => {
  const tempDir = await createTempDir();
  const originalCwd = Deno.cwd();
  
  try {
    // Change to non-git directory
    Deno.chdir(tempDir);
    
    const metadata = {
      sessionId: "test-session-123",
      timestamp: new Date().toISOString(),
      prompt: "Test prompt",
      resumedFrom: undefined,
    };
    
    // This should throw an error when not in a git repository
    await assertRejects(
      async () => {
        await commitFileChanges(metadata);
      },
      Error,
      "Failed to commit file changes"
    );
  } finally {
    Deno.chdir(originalCwd);
    await cleanupTempDir(tempDir);
  }
});

Deno.test("FileWatcherOptions should handle rapid changes with proper debounce", async () => {
  const tempDir = await createTempDir();
  
  try {
    const mockWatcher = {
      watcher: Deno.watchFs(tempDir),
      watcherActive: true,
      commitInProgress: false,
      lastCommitTime: Date.now() - 1000, // Set last commit time in the past
      changeBuffer: false,
    };
    
    // Start watching in background
    const watchPromise = watchFileChanges(mockWatcher);
    
    // Create multiple files rapidly
    await Deno.writeTextFile(path.join(tempDir, "file1.txt"), "content1");
    await Deno.writeTextFile(path.join(tempDir, "file2.txt"), "content2");
    
    // Wait a bit for file system events
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify that changes were detected
    assertEquals(mockWatcher.changeBuffer, true, "Should detect file changes");
    
    // Stop the watcher early to prevent git operations
    mockWatcher.watcherActive = false;
    mockWatcher.watcher.close();
    
    await watchPromise;
  } finally {
    await cleanupTempDir(tempDir);
  }
});
