#!/usr/bin/env -S deno run --allow-all
import { $ } from "jsr:@david/dax@0.40.0";
import * as git from "./git.ts";
import { parseClaudeOutput } from "./metadata.ts";
import { generateCommitTitle } from "./title-generator.ts";
import { checkoutSession, startSession, listSessions } from "./history.ts";
import type { ClaudeOutput } from "./types.ts";

let taskCounter = 0;

async function checkForTaskCompletion(chunk: string): Promise<void> {
  // Patterns that indicate Claude Code completed a task
  const completionPatterns = [
    /The file .* has been updated/,
    /File created successfully/,
    /✅/,
    /Command completed successfully/,
    /Test passed/,
    /Build successful/,
    /Successfully/,
  ];
  
  const shouldCommit = completionPatterns.some(pattern => pattern.test(chunk));
  
  if (shouldCommit) {
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
      
      const title = generateCommitTitle(changedFiles, metadata);
      
      // Commit the changes
      await git.commitChanges(title, metadata);
      
      console.log(`\n🎯 Auto-committed task ${taskCounter}`);
    } catch (error) {
      console.error(`Failed to auto-commit: ${error}`);
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
    
    // For interactive mode (no args), run directly without monitoring
    if (args.length === 0) {
      const cmd = new Deno.Command("claude", { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      const status = await cmd.spawn().status;
      Deno.exit(status.code);
      return;
    }
    
    const output = await runClaudeWithMonitoring(args);
    
    // Final commit for any remaining changes
    const hasChanges = await git.hasUncommittedChanges();
    if (hasChanges) {
      const metadata = parseClaudeOutput(output, args);
      const changedFiles = await git.getStagedFiles();
      const title = generateCommitTitle(changedFiles, metadata);
      await git.commitChanges(title, metadata);
      console.log(`\n✅ Final session commit with ID: ${metadata.sessionId}`);
    }
    
    // Exit with Claude's exit code
    Deno.exit(output.exitCode);
  } finally {
    // Restore stashed changes if any
    if (hasStashed) {
      await git.popStash();
    }
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
  
  // Filter out ccgit-specific flags before passing to Claude
  const claudeArgs = args.filter(arg => arg !== '--dangerously-skip-permissions');
  
  // For interactive mode, require a prompt
  if (claudeArgs.length === 0) {
    console.log(`ccgit - Claude Chat Git Integration

Interactive mode is not currently supported. Please provide a prompt:

Examples:
  ccgit "Fix the TypeScript errors"
  ccgit "Add tests for the new feature"
  ccgit "Refactor the user authentication code"
  
For other ccgit commands:
  ccgit checkout <session-id>   # Checkout a previous session
  ccgit start <name>           # Create a new branch for a session  
  ccgit list                   # List recent Claude sessions
  ccgit --help                 # Show this help`);
    return;
  }
  
  // Pass through to Claude with git tracking
  await handleClaudeSession(claudeArgs);
}

if (import.meta.main) {
  main();
}