#!/usr/bin/env -S deno run --allow-all
import { $ } from "jsr:@david/dax@0.40.0";
import * as git from "./git.ts";
import { parseClaudeOutput } from "./metadata.ts";
import { generateCommitTitle } from "./title-generator.ts";
import type { ClaudeOutput } from "./types.ts";

async function runClaude(args: string[]): Promise<ClaudeOutput> {
  try {
    const result = await $`claude ${args}`;
    
    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.code,
    };
  } catch (error) {
    // If claude command fails, return error info
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
    await $`claude ${args}`.spawn();
    return;
  }
  
  // Stash any uncommitted changes
  const hasStashed = await git.stashChanges();
  
  try {
    // Run Claude
    console.log("🚀 Starting Claude session...");
    const output = await runClaude(args);
    
    // Extract metadata
    const metadata = parseClaudeOutput(output, args);
    
    // Generate commit title based on changes
    const changedFiles = await git.getStagedFiles();
    const title = generateCommitTitle(changedFiles, metadata);
    
    // Commit changes
    await git.commitChanges(title, metadata);
    
    console.log(`\n✅ Session saved with ID: ${metadata.sessionId}`);
    
    // Exit with Claude's exit code
    Deno.exit(output.exitCode);
  } finally {
    // Restore stashed changes if any
    if (hasStashed) {
      await git.popStash();
    }
  }
}

async function handleCheckout(sessionId: string): Promise<void> {
  const commits = await git.getCommitsBySessionId(sessionId);
  
  if (commits.length === 0) {
    console.error(`❌ No commits found for session ID: ${sessionId}`);
    Deno.exit(1);
  }
  
  // Checkout the first (most recent) commit
  await git.checkoutCommit(commits[0]);
  console.log(`✅ Checked out session: ${sessionId}`);
}

async function handleStart(name: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const branchName = `claude/${name}-${timestamp}`;
  
  await git.createBranch(branchName);
  console.log(`✅ Created branch: ${branchName}`);
}

async function main() {
  const args = Deno.args;
  
  // Handle ccgit-specific commands
  if (args[0] === 'checkout' && args[1]) {
    await handleCheckout(args[1]);
    return;
  }
  
  if (args[0] === 'start' && args[1]) {
    await handleStart(args[1]);
    return;
  }
  
  // Handle help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`ccgit - Claude Chat Git Integration

Usage:
  ccgit [claude options]        Run Claude with automatic git tracking
  ccgit checkout <session-id>   Checkout a previous session
  ccgit start <name>           Create a new branch for a session
  
Examples:
  ccgit                        Start interactive Claude session
  ccgit "Fix the bug"          Single prompt to Claude
  ccgit --resume abc123        Resume a Claude session
  ccgit checkout abc123        Restore code from session abc123
  ccgit start feature-auth     Create branch claude/feature-auth-<timestamp>
`);
    return;
  }
  
  // Pass through to Claude with git tracking
  await handleClaudeSession(args);
}

if (import.meta.main) {
  main();
}