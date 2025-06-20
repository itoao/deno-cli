#!/usr/bin/env -S deno run --allow-all
import { $ } from "jsr:@david/dax@0.40.0";
import * as git from "./git.ts";
import { parseClaudeOutput } from "./metadata.ts";
import { generateCommitTitle as generateCommitTitleWithAI, type GitFileChange as SharedGitFileChange } from "@deno-cli/shared";
import { checkoutSession, startSession, listSessions } from "./history.ts";
import type { ClaudeOutput } from "./types.ts";

let taskCounter = 0;
let lastCommitTime = 0;

async function checkForTaskCompletion(chunk: string): Promise<void> {
  // Patterns that indicate Claude Code completed a task
  const completionPatterns = [
    // File operations
    /The file .* has been updated/,
    /File created successfully/,
    /has been updated\. Here's the result/,
    /The .* file .* has been updated/,
    
    // Tool usage completions
    /✅/,
    /Command completed successfully/,
    /Test passed/,
    /Build successful/,
    /Successfully/,
    /completed successfully/i,
    
    // Edit tool specific patterns
    /Here's the result of running.*on.*snippet.*of the edited file/,
    /The.*has been updated/,
    
    // Common completion indicators
    /\n\n/,  // Double newline often indicates completion
    /Check /,  // TypeScript check completion
    /\[0m\[32mCheck\[0m/,  // Deno check success pattern
  ];
  
  // Debug logging (disabled for cleaner output)
  // if (chunk.trim()) {
  //   console.log(`[DEBUG] Chunk: ${JSON.stringify(chunk.substring(0, 100))}`);
  // }
  
  const shouldCommit = completionPatterns.some(pattern => pattern.test(chunk));
  
  if (shouldCommit) {
    // Add debouncing to prevent too many commits
    const now = Date.now();
    if (taskCounter === 0 || (now - lastCommitTime) > 5000) {
      lastCommitTime = now;
      try {
        taskCounter++;
      
      // Check if there are changes to commit
      const hasChanges = await git.hasUncommittedChanges();
      if (!hasChanges) return;
      
      // Generate commit message
      const changedFiles = await git.getStagedFiles();
      const sessionId = `task-${Date.now()}-${taskCounter}`;
      const metadata = {
        sessionId,
        timestamp: new Date().toISOString(),
        prompt: `Task ${taskCounter} completion`,
        resumedFrom: undefined,
      };
      
      // Convert to shared GitFileChange type and add diff information
      const filesWithDiff: SharedGitFileChange[] = await Promise.all(
        changedFiles.map(async (file) => {
          let diff = '';
          try {
            if (file.status === 'A') {
              diff = await git.getFileContent(file.path);
            } else {
              diff = await git.getFileDiff(file.path);
            }
          } catch {}
          return { ...file, diff };
        })
      );
      
      const title = await generateCommitTitleWithAI(filesWithDiff);
      
      // Commit the changes
      await git.commitChanges(title, metadata);
      
      console.log(`\n🎯 Auto-committed task ${taskCounter}`);
      } catch (error) {
        console.error(`Failed to auto-commit: ${error}`);
      }
    }
  }
}

async function runClaudeWithMonitoring(args: string[]): Promise<ClaudeOutput> {
  try {
    const cmd = new Deno.Command("claude", {
      args: args,
      stdout: "piped",
      stderr: "piped",
      stdin: "inherit",
    });
    
    const process = cmd.spawn();
    
    let stdout = "";
    let stderr = "";
    
    // Monitor stdout for task completion patterns
    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();
    
    const decoder = new TextDecoder();
    
    // Read stdout chunks
    const readStdout = async () => {
      while (true) {
        const { done, value } = await stdoutReader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        stdout += chunk;
        Deno.stdout.write(value); // Pass through to terminal
        
        // Check for task completion indicators
        await checkForTaskCompletion(chunk);
      }
    };
    
    // Read stderr chunks  
    const readStderr = async () => {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        stderr += chunk;
        Deno.stderr.write(value); // Pass through to terminal
      }
    };
    
    // Run both readers concurrently
    await Promise.all([readStdout(), readStderr()]);
    
    const status = await process.status;
    
    return {
      stdout,
      stderr,
      exitCode: status.code,
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
  }
}

async function runInteractiveClaudeWithMonitoring(args: string[]): Promise<void> {
  try {
    const cmd = new Deno.Command("claude", {
      args: args,
      stdout: "piped",
      stderr: "piped", 
      stdin: "inherit",
    });
    
    const process = cmd.spawn();
    
    const decoder = new TextDecoder();
    
    // Monitor stdout for task completion patterns
    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();
    
    // Read stdout chunks
    const readStdout = async () => {
      while (true) {
        const { done, value } = await stdoutReader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        Deno.stdout.write(value); // Pass through to terminal
        
        // Check for task completion indicators
        await checkForTaskCompletion(chunk);
      }
    };
    
    // Read stderr chunks  
    const readStderr = async () => {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        Deno.stderr.write(value); // Pass through to terminal
      }
    };
    
    // Run both readers concurrently
    await Promise.all([readStdout(), readStderr()]);
    
    const status = await process.status;
    
    // Final commit for any remaining changes in interactive mode
    const hasChanges = await git.hasUncommittedChanges();
    if (hasChanges) {
      const sessionId = `interactive-session-${Date.now()}`;
      const metadata = {
        sessionId,
        timestamp: new Date().toISOString(),
        prompt: "Interactive session completion",
        resumedFrom: undefined,
      };
      
      const changedFiles = await git.getStagedFiles();
      
      // Convert to shared GitFileChange type and add diff information
      const filesWithDiff: SharedGitFileChange[] = await Promise.all(
        changedFiles.map(async (file) => {
          let diff = '';
          try {
            if (file.status === 'A') {
              diff = await git.getFileContent(file.path);
            } else {
              diff = await git.getFileDiff(file.path);
            }
          } catch {}
          return { ...file, diff };
        })
      );
      
      const title = await generateCommitTitleWithAI(filesWithDiff);
      await git.commitChanges(title, metadata);
      console.log(`\n✅ Final interactive session commit with ID: ${metadata.sessionId}`);
    }
    
    // Exit with Claude's exit code
    Deno.exit(status.code);
  } catch (error) {
    console.error('Error running interactive Claude session:', error);
    Deno.exit(1);
  }
}

async function handleClaudeSession(args: string[]): Promise<void> {
  // Check if we're in a git repo
  try {
    await git.getGitRoot();
  } catch {
    // Not a git repo, just run claude normally  
    if (args.length === 0) {
      await $`claude`.spawn();
    } else {
      await $`claude ${args}`.spawn();
    }
    return;
  }
  
  
  try {
    // Run Claude with real-time monitoring
    console.log("🚀 Starting Claude session with auto-commit...");
    
    // Check if this is truly interactive mode
    // For Claude CLI: only no arguments = interactive mode
    // All other cases (including flags only) are non-interactive
    const isInteractiveMode = args.length === 0;
    
    if (isInteractiveMode) {
      // Run interactive mode with monitoring
      await runInteractiveClaudeWithMonitoring(args);
    } else {
      // Run single command mode with monitoring
      const output = await runClaudeWithMonitoring(args);
      
      // Final commit for any remaining changes
      const hasChanges = await git.hasUncommittedChanges();
      if (hasChanges) {
        const metadata = parseClaudeOutput(output, args);
        const changedFiles = await git.getStagedFiles();
        
        // Convert to shared GitFileChange type and add diff information
        const filesWithDiff: SharedGitFileChange[] = await Promise.all(
          changedFiles.map(async (file) => {
            let diff = '';
            try {
              if (file.status === 'A') {
                diff = await git.getFileContent(file.path);
              } else {
                diff = await git.getFileDiff(file.path);
              }
            } catch {}
            return { ...file, diff };
          })
        );
        
        const title = await generateCommitTitleWithAI(filesWithDiff);
        await git.commitChanges(title, metadata);
        console.log(`\n✅ Final session commit with ID: ${metadata.sessionId}`);
      }
      
      // Exit with Claude's exit code
      Deno.exit(output.exitCode);
    }
  } catch (error) {
    console.error('Error running Claude session:', error);
    Deno.exit(1);
  }
}


async function main() {
  const args = Deno.args;
  
  // Handle ccgit-specific commands
  if (args[0] === 'checkout' && args[1]) {
    await checkoutSession(args[1]);
    return;
  }
  
  if (args[0] === 'start' && args[1]) {
    await startSession(args[1]);
    return;
  }
  
  if (args[0] === 'list') {
    await listSessions();
    return;
  }
  
  // Handle help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`ccgit - Claude Chat Git Integration

Usage:
  ccgit [claude options]        Run Claude with automatic git tracking
  ccgit checkout <session-id>   Checkout a previous session
  ccgit start <name>           Create a new branch for a session
  ccgit list                   List recent Claude sessions
  
Examples:
  ccgit                        Start interactive Claude session
  ccgit "Fix the bug"          Single prompt to Claude
  ccgit --resume abc123        Resume a Claude session
  ccgit checkout abc123        Restore code from session abc123
  ccgit start feature-auth     Create branch claude/feature-auth-<timestamp>
  ccgit list                   Show recent sessions
`);
    return;
  }
  
  // Pass all arguments to Claude (no filtering needed)
  const claudeArgs = args;
  
  // Handle interactive mode
  if (claudeArgs.length === 0) {
    console.log(`🚀 Starting Claude interactive session with auto-commit...`);
    console.log(`🎯 Interactive mode with auto-commit enabled`);
  }
  
  // Pass through to Claude with git tracking
  await handleClaudeSession(claudeArgs);
}

if (import.meta.main) {
  main();
}