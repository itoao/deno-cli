#!/usr/bin/env -S deno run --allow-all
import { $ } from "jsr:@david/dax@0.40.0";
import * as git from "./git.ts";
import { checkoutSession, startSession, listSessions } from "./history.ts";
import type { ClaudeOutput } from "./types.ts";


async function runClaudeWithMonitoring(args: string[]): Promise<ClaudeOutput> {
  // Claudeプロセス実行中にファイル変更を監視し、変更があれば即コミット
  const watcher = Deno.watchFs(".");
  let watcherActive = true;
  let commitInProgress = false;
  let lastCommitTime = 0;
  let changeBuffer = false;

  // コミット処理
  async function commitIfChanged() {
    if (commitInProgress) return;
    commitInProgress = true;
    try {
      const hasChanges = await git.hasUncommittedChanges();
      if (!hasChanges) return;
      const changedFiles = await git.getStagedFiles();
      const metadata = {
        sessionId: `fswatch-${Date.now()}`,
        timestamp: new Date().toISOString(),
        prompt: "Claude code file change detected",
        resumedFrom: undefined,
      };
      await Promise.all(
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
      const title = `Claude Chat Session: ${metadata.sessionId}`;
      await git.commitChanges(title, metadata);
      lastCommitTime = Date.now();
      console.log(`\n🎯 Auto-committed by fswatch`);
    } finally {
      commitInProgress = false;
    }
  }

  // ファイル監視ループ（デバウンス付き）
  (async () => {
    for await (const event of watcher) {
      if (!watcherActive) break;
      if (["modify", "create", "remove"].includes(event.kind)) {
        changeBuffer = true;
        // 500msデバウンス
        setTimeout(async () => {
          if (changeBuffer && Date.now() - lastCommitTime > 400) {
            changeBuffer = false;
            await commitIfChanged();
          }
        }, 500);
      }
    }
  })();

  try {
    // Filter out --print flag if no prompt is provided and stdin is empty
    const filteredArgs = [...args];
    
    // Clear Claude Code specific environment variables to prevent automatic --print mode
    const env = { ...Deno.env.toObject() };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_SSE_PORT;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    
    // For interactive mode (no prompt provided), don't use --print mode
    const hasPromptArg = filteredArgs.some(arg => !arg.startsWith('-'));
    const isInteractiveCall = !hasPromptArg;
    
    const cmd = new Deno.Command("claude", {
      args: filteredArgs,
      stdout: isInteractiveCall ? "inherit" : "piped",
      stderr: isInteractiveCall ? "inherit" : "piped", 
      stdin: "inherit", // Always inherit stdin for interactive support
      env: env,
    });
    
    const process = cmd.spawn();
    
    let stdout = "";
    let stderr = "";
    
    if (isInteractiveCall) {
      // For interactive mode, just wait for completion without monitoring
      const status = await process.status;
      return {
        stdout: "",
        stderr: "",
        exitCode: status.code,
      };
    } else {
      // For non-interactive mode, monitor output for auto-commit
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
      
      // Claudeプロセス終了時にwatcherを停止
      watcherActive = false;
      
      return {
        stdout,
        stderr,
        exitCode: status.code,
      };
    }
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
    // Clear Claude Code specific environment variables to prevent automatic --print mode
    const env = { ...Deno.env.toObject() };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_SSE_PORT;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    
    if (args.length === 0) {
      await $`claude`.env(env).spawn();
    } else {
      await $`claude ${args}`.env(env).spawn();
    }
    return;
  }
  
  // Handle --dangerously-skip-permissions properly
  const hasDangerouslySkipOnly = args.length === 1 && args[0] === '--dangerously-skip-permissions';
  
  // Check if we have a prompt argument (non-option argument)
  const hasPromptArg = args.some(arg => !arg.startsWith('-'));
  
  // Interactive mode: no prompt argument provided
  // Examples of interactive mode:
  // - ccgit
  // - ccgit --dangerously-skip-permissions
  // - ccgit -c
  // - ccgit --continue
  // - ccgit --model opus
  // Examples of non-interactive mode:
  // - ccgit "Fix the bug"
  // - ccgit -c "Continue fixing"
  const isInteractiveMode = !hasPromptArg;
  
  // Pass through all arguments as-is to claude
  const claudeArgs = [...args];
  
  try {
    // Run Claude with real-time monitoring
    console.log("🚀 Starting Claude session with auto-commit...");
    // isInteractiveMode is already determined above
    
    if (isInteractiveMode) {
      // Run interactive mode with monitoring
      // For interactive mode, use monitoring instead of spawn
      try {
        const output = await runClaudeWithMonitoring(claudeArgs);
        
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
  
Claude options (passed through):
  --dangerously-skip-permissions  Skip all permission checks
  -c, --continue                  Continue last conversation
  -r, --resume [sessionId]        Resume a specific session
  --print                         Non-interactive mode
  --model <model>                 Specify model to use
  
Examples:
  ccgit                        Start interactive Claude session
  ccgit "Fix the bug"          Single prompt to Claude
  ccgit -c                     Continue last Claude conversation
  ccgit --resume abc123        Resume a Claude session
  ccgit --dangerously-skip-permissions  Start with permissions bypassed
  ccgit checkout abc123        Restore code from session abc123
  ccgit start feature-auth     Create branch claude/feature-auth-<timestamp>
  ccgit list                   Show recent sessions
`);
    return;
  }
  // Handle interactive mode
  const hasPromptArg = args.some(arg => !arg.startsWith('-'));
  if (!hasPromptArg) {
    console.log(`🚀 Starting Claude interactive session with auto-commit...`);
    console.log(`🎯 Interactive mode with auto-commit enabled`);
    
    // Show specific options being passed
    if (args.includes('--dangerously-skip-permissions')) {
      console.log(`⚠️  --dangerously-skip-permissions enabled for this session`);
    }
    if (args.includes('-c') || args.includes('--continue')) {
      console.log(`↩️  Continuing last Claude conversation`);
    }
    if (args.includes('-r') || args.includes('--resume')) {
      const resumeIndex = Math.max(args.indexOf('-r'), args.indexOf('--resume'));
      const sessionId = args[resumeIndex + 1];
      if (sessionId) {
        console.log(`📂 Resuming Claude session: ${sessionId}`);
      }
    }
    if (args.includes('--model')) {
      const modelIndex = args.indexOf('--model');
      const model = args[modelIndex + 1];
      if (model) {
        console.log(`🤖 Using model: ${model}`);
      }
    }
  }
  
  // Pass through ALL arguments to Claude CLI transparently
  // This includes: -c, --continue, -r, --resume, --model, --dangerously-skip-permissions, etc.
  await handleClaudeSession(args);
}

if (import.meta.main) {
  main();
}