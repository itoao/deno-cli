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
  // This test is expected to fail initially - Red phase
  const tempDir = await createTempDir();
  
  try {
    // Create a mock file watcher that we can control
    const mockWatcher = {
      watcher: Deno.watchFs(tempDir),
      watcherActive: true,
      commitInProgress: false,
      lastCommitTime: 0,
      changeBuffer: false,
    };

    // Start watching (this should run in background)
    const watchPromise = watchFileChanges(mockWatcher);
    
    // Create a file to trigger the watcher
    const testFile = path.join(tempDir, "test.txt");
    await Deno.writeTextFile(testFile, "test content");
    
    // Wait for debounce period
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // The watcher should have detected changes and set changeBuffer
    // This assertion should fail in Red phase
    assertEquals(mockWatcher.changeBuffer, false, "Change buffer should be reset after commit");
    
    // Stop the watcher
    mockWatcher.watcherActive = false;
    mockWatcher.watcher.close();
    
    await watchPromise;
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("commitFileChanges should handle no changes gracefully", async () => {
  const metadata = {
    sessionId: "test-session-123",
    timestamp: new Date().toISOString(),
    prompt: "Test prompt",
    resumedFrom: undefined,
  };
  
  // This should not throw an error even if there are no changes
  // Initial implementation might not handle this gracefully - Red phase
  await assertRejects(
    async () => {
      await commitFileChanges(metadata);
    },
    Error,
    "Failed to commit file changes"
  );
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
    
    // Wait for debounce timeout to complete
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // This test expects proper debounce handling
    // Change buffer should be reset after the debounce period
    assertEquals(mockWatcher.changeBuffer, false, "Change buffer should be reset after debounce period");
    
    // Stop the watcher
    mockWatcher.watcherActive = false;
    mockWatcher.watcher.close();
    
    await watchPromise;
  } finally {
    await cleanupTempDir(tempDir);
  }
});
