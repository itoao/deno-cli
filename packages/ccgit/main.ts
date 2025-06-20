#!/usr/bin/env -S deno run --allow-all
import { $ } from "jsr:@david/dax@0.40.0";
import * as git from "./git.ts";
import { parseClaudeOutput } from "./metadata.ts";
// import { generateCommitTitle as generateCommitTitleWithAI, type GitFileChange as SharedGitFileChange } from "@deno-cli/shared";
import { generateCommitTitle as generateCommitTitleWithAI } from "./title-generator.ts";

type SharedGitFileChange = {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | 'T';
  diff: string;
};
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
      
      const title = generateCommitTitleWithAI(filesWithDiff, metadata);
      
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
    // Filter out --print flag if no prompt is provided and stdin is empty
    const filteredArgs = [...args];
    
    // Clear CLAUDECODE environment variable to prevent automatic --print mode
    const env = { ...Deno.env.toObject() };
    delete env.CLAUDECODE;
    
    const cmd = new Deno.Command("claude", {
      args: filteredArgs,
      stdout: "piped",
      stderr: "piped",
      stdin: "inherit", // Always inherit stdin for interactive support
      env: env,
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
    // Clear CLAUDECODE environment variable to prevent automatic --print mode
    const env = { ...Deno.env.toObject() };
    delete env.CLAUDECODE;
    
    if (args.length === 0) {
      await $`claude`.env(env).spawn();
    } else {
      await $`claude ${args}`.env(env).spawn();
    }
    return;
  }
  
  // Handle --dangerously-skip-permissions properly
  const hasDangerouslySkipOnly = args.length === 1 && args[0] === '--dangerously-skip-permissions';
  const hasOtherArgs = args.some(arg => arg !== '--dangerously-skip-permissions');
  
  // Interactive mode: no args or only --dangerously-skip-permissions
  const isInteractiveMode = !hasOtherArgs;
  
  // Prepare claude args: only add --dangerously-skip-permissions for non-interactive mode
  const claudeArgs = [...args];
  
  // For non-interactive mode (single command), add --dangerously-skip-permissions if not present
  if (!isInteractiveMode && !claudeArgs.includes('--dangerously-skip-permissions')) {
    claudeArgs.push('--dangerously-skip-permissions');
  }
  
  // Debug logging
  console.log(`🔍 Debug: isInteractiveMode=${isInteractiveMode}, claudeArgs=${JSON.stringify(claudeArgs)}`);
  
  try {
    // Run Claude with real-time monitoring
    console.log("🚀 Starting Claude session with auto-commit...");
    // isInteractiveMode is already determined above
    
    if (isInteractiveMode) {
      // Run interactive mode with monitoring
      if (hasDangerouslySkipOnly) {
        console.log(`⚠️  To enable --dangerously-skip-permissions in interactive mode:`);
        console.log(`   Type: /mode --dangerously-skip-permissions`);
        console.log(`   Or press Shift+Tab to toggle auto-accept mode`);
        console.log(``);
      }
      // For interactive mode, use monitoring instead of spawn
      try {
        const output = await runClaudeWithMonitoring(claudeArgs);
        
        // Final commit for any remaining changes
        const hasChanges = await git.hasUncommittedChanges();
        if (hasChanges) {
          const metadata = {
            sessionId: `interactive-session-${Date.now()}`,
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
              } catch {
                // Ignore diff extraction errors
              }
              return { ...file, diff };
            })
          );
          
          const title = generateCommitTitleWithAI(filesWithDiff, metadata);
          await git.commitChanges(title, metadata);
          console.log(`\n✅ Final interactive session commit with ID: ${metadata.sessionId}`);
        }
        
        // Exit with Claude's exit code
        Deno.exit(output.exitCode);
      } catch (error) {
        console.error(`❌ Claude CLI execution failed: ${error}`);
        console.log(`ℹ️  Try running 'claude doctor' to diagnose Claude CLI issues`);
        console.log(`ℹ️  Or run 'claude' directly to test Claude CLI`);
        console.log(`ℹ️  Args passed to claude: ${JSON.stringify(claudeArgs)}`);
        Deno.exit(1);
      }
    } else {
      // Run single command mode with monitoring
      const output = await runClaudeWithMonitoring(claudeArgs);
      
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
            } catch {
              // Ignore diff extraction errors
            }
            return { ...file, diff };
          })
        );
        
        const title = generateCommitTitleWithAI(filesWithDiff, metadata);
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
  // Handle interactive mode  
  if (args.length === 0) {
    console.log(`🚀 Starting Claude interactive session with auto-commit...`);
    console.log(`🎯 Interactive mode with auto-commit enabled`);
  } else if (args.length === 1 && args[0] === '--dangerously-skip-permissions') {
    console.log(`🚀 Starting Claude interactive session with auto-commit...`);
    console.log(`🎯 Interactive mode with auto-commit enabled`);
    console.log(`⚠️  --dangerously-skip-permissions enabled for this session`);
  }
  
  // Pass through to Claude with git tracking
  await handleClaudeSession(args);
}

if (import.meta.main) {
  main();
}