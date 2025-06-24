#!/usr/bin/env -S deno run --allow-all
import { $ } from "jsr:@david/dax@0.40.0";
import { handleError } from "../../shared/error-handler.ts";
import { logger } from "../../shared/index.ts";
import type { ClaudeOutput } from "../../shared/types.ts";
import * as git from "./git.ts";

// Constants
const DEBOUNCE_DELAY = 500;
const MIN_COMMIT_INTERVAL = 400;
const CLAUDE_ENV_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_CODE_ENTRYPOINT",
];

interface FileWatcherOptions {
  watcher: Deno.FsWatcher;
  watcherActive: boolean;
  commitInProgress: boolean;
  lastCommitTime: number;
  changeBuffer: boolean;
}

interface ClaudeProcessOptions {
  args: string[];
  isInteractive: boolean;
  env: Record<string, string>;
}

function cleanEnvironment(): Record<string, string> {
  const env = { ...Deno.env.toObject() };
  CLAUDE_ENV_VARS.forEach((varName) => delete env[varName]);
  return env;
}

function hasPromptArgument(args: string[]): boolean {
  return args.some((arg) => !arg.startsWith("-") && !arg.startsWith("/"));
}

export async function commitFileChanges(metadata: {
  sessionId: string;
  timestamp: string;
  prompt: string;
  resumedFrom: undefined;
}): Promise<void> {
  const hasChanges = await git.hasUncommittedChanges();
  if (!hasChanges) return;

  const changedFiles = await git.getStagedFiles();
  await Promise.all(
    changedFiles.map(async (file) => {
      let diff = "";
      try {
        if (file.status === "A") {
          diff = await git.getFileContent(file.path);
        } else {
          diff = await git.getFileDiff(file.path);
        }
      } catch {
        // Ignore diff read errors, use empty diff
      }
      return { ...file, diff };
    }),
  );

  const title = `Claude Chat Session: ${metadata.sessionId}`;
  await git.commitChanges(title, metadata);
  logger.log(`\n🎯 Auto-committed by fswatch`);
}

export function createFileWatcher(): FileWatcherOptions {
  return {
    watcher: Deno.watchFs("."),
    watcherActive: true,
    commitInProgress: false,
    lastCommitTime: 0,
    changeBuffer: false,
  };
}

export async function watchFileChanges(options: FileWatcherOptions): Promise<void> {
  const { watcher } = options;

  async function commitIfChanged(): Promise<void> {
    if (options.commitInProgress) return;
    options.commitInProgress = true;

    try {
      const metadata = {
        sessionId: `fswatch-${Date.now()}`,
        timestamp: new Date().toISOString(),
        prompt: "Claude code file change detected",
        resumedFrom: undefined,
      };
      await commitFileChanges(metadata);
      options.lastCommitTime = Date.now();
    } finally {
      options.commitInProgress = false;
    }
  }

  for await (const event of watcher) {
    if (!options.watcherActive) break;
    if (["modify", "create", "remove"].includes(event.kind)) {
      options.changeBuffer = true;
      setTimeout(async () => {
        if (
          options.changeBuffer &&
          Date.now() - options.lastCommitTime > MIN_COMMIT_INTERVAL
        ) {
          options.changeBuffer = false;
          await commitIfChanged();
        }
      }, DEBOUNCE_DELAY);
    }
  }
}

async function runClaudeProcess(
  options: ClaudeProcessOptions,
): Promise<ClaudeOutput> {
  const cmd = new Deno.Command("claude", {
    args: options.args,
    stdout: options.isInteractive ? "inherit" : "piped",
    stderr: options.isInteractive ? "inherit" : "piped",
    stdin: "inherit",
    env: options.env,
  });

  const process = cmd.spawn();

  if (options.isInteractive) {
    const status = await process.status;
    return {
      stdout: "",
      stderr: "",
      exitCode: status.code,
    };
  }

  // Non-interactive mode: capture output
  const [stdout, stderr] = await Promise.all([
    readStream(process.stdout, true),
    readStream(process.stderr, false),
  ]);

  const status = await process.status;

  return {
    stdout,
    stderr,
    exitCode: status.code,
  };
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  toStdout: boolean,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";

  while (true) {
    // deno-lint-ignore no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    result += chunk;

    if (toStdout) {
      Deno.stdout.write(value);
    } else {
      Deno.stderr.write(value);
    }
  }

  return result;
}

async function runClaudeWithMonitoring(args: string[]): Promise<ClaudeOutput> {
  const fileWatcher = createFileWatcher();

  // Start file watching in background
  const _watchPromise = watchFileChanges(fileWatcher);

  try {
    const env = cleanEnvironment();
    const isInteractive = !hasPromptArgument(args);

    const output = await runClaudeProcess({
      args,
      isInteractive,
      env,
    });

    // Stop file watcher
    fileWatcher.watcherActive = false;

    return output;
  } catch (error) {
    fileWatcher.watcherActive = false;
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      stdout: "",
      stderr: errorMessage,
      exitCode: 1,
    };
  }
}

async function runClaudeDirectly(args: string[]): Promise<void> {
  const env = cleanEnvironment();

  if (args.length === 0) {
    await $`claude`.env(env).spawn();
  } else {
    await $`claude ${args}`.env(env).spawn();
  }
}

async function handleClaudeSession(args: string[]): Promise<void> {
  // Check if we're in a git repo
  try {
    await git.getGitRoot();
  } catch {
    // Not a git repo, just run claude normally
    await runClaudeDirectly(args);
    return;
  }

  const isInteractiveMode = !hasPromptArgument(args);

  try {
    logger.log("🚀 Starting Claude session with auto-commit...");
    const output = await runClaudeWithMonitoring(args);
    Deno.exit(output.exitCode);
  } catch (error) {
    if (isInteractiveMode) {
      logger.error(`❌ Claude CLI execution failed: ${error}`);
      logger.log(
        `ℹ️  Try running 'claude doctor' to diagnose Claude CLI issues`,
      );
      logger.log(`ℹ️  Or run 'claude' directly to test Claude CLI`);
      logger.log(`ℹ️  Args passed to claude: ${JSON.stringify(args)}`);
    } else {
      handleError(error, {
        prefix: "Error running Claude session",
        exitCode: 1,
      });
    }
    Deno.exit(1);
  }
}

async function showHelp(): Promise<void> {
  logger.log(`ccgit - Claude Chat Git Integration

Usage:
  ccgit [claude options]        Run Claude with automatic git tracking
  
Examples:
  ccgit                        Start interactive Claude session
  ccgit "Fix the bug"          Single prompt to Claude
  ccgit -c                     Continue last Claude conversation
  ccgit --resume abc123        Resume a Claude session
  ccgit /orchestrator          Start with orchestrator mode
  ccgit --dangerously-skip-permissions  Start with permissions bypassed

Claude CLI Options (all passed through transparently):
`);

  // Show Claude's help by running claude --help
  try {
    const cmd = new Deno.Command("claude", {
      args: ["--help"],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();
    const claudeHelp = new TextDecoder().decode(output.stdout);

    // Extract and display the options section from Claude's help
    const lines = claudeHelp.split("\n");
    let inOptionsSection = false;
    let optionsFound = false;

    for (const line of lines) {
      // Detect start of options section
      if (
        line.toLowerCase().includes("options:") ||
        line.toLowerCase().includes("flags:")
      ) {
        inOptionsSection = true;
        optionsFound = true;
        continue;
      }

      if (inOptionsSection) {
        // Stop at next major section (non-indented line that's not empty)
        if (line.trim() && !line.startsWith(" ") && !line.startsWith("\t")) {
          break;
        }

        // Show option lines, replacing 'claude' with 'ccgit' in examples
        if (line.trim()) {
          let modifiedLine = line.replace(/claude\s+/g, "ccgit ");

          // Add extra spacing between option and description for better readability
          // Match pattern like "  -c, --continue                  Continue..."
          modifiedLine = modifiedLine.replace(
            /^(\s*)(-[^A-Z]*?)(\s{2,})([A-Z])/g,
            "$1  $2$3      $4",
          );

          logger.log(`  ${modifiedLine.trim()}`);
        }
      }
    }

    if (!optionsFound) {
      logger.log("  (Run 'claude --help' for complete Claude CLI options)");
    }
  } catch (_error) {
    logger.log("  (Run 'claude --help' for complete Claude CLI options)");
  }
}

function showInteractiveInfo(args: string[]): void {
  logger.log(`🚀 Starting Claude interactive session with auto-commit...`);
  logger.log(`🎯 Interactive mode with auto-commit enabled`);

  // Show specific options being passed
  if (args.includes("--dangerously-skip-permissions")) {
    logger.log(`⚠️  --dangerously-skip-permissions enabled for this session`);
  }

  if (args.includes("-c") || args.includes("--continue")) {
    logger.log(`↩️  Continuing last Claude conversation`);
  }

  if (args.includes("-r") || args.includes("--resume")) {
    const resumeIndex = Math.max(args.indexOf("-r"), args.indexOf("--resume"));
    const sessionId = args[resumeIndex + 1];
    if (sessionId) {
      logger.log(`📂 Resuming Claude session: ${sessionId}`);
    }
  }

  if (args.includes("--model")) {
    const modelIndex = args.indexOf("--model");
    const model = args[modelIndex + 1];
    if (model) {
      logger.log(`🤖 Using model: ${model}`);
    }
  }

  if (args.includes("/orchestrator")) {
    logger.log(`🎼 Orchestrator mode enabled`);
  }
}

async function main(): Promise<void> {
  const args = Deno.args;

  // Handle help
  if (args.includes("--help") || args.includes("-h")) {
    await showHelp();
    return;
  }

  // Show interactive mode info
  if (!hasPromptArgument(args)) {
    showInteractiveInfo(args);
  }

  // Pass through to Claude
  await handleClaudeSession(args);
}

if (import.meta.main) {
  main();
}
