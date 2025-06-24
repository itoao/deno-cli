#!/usr/bin/env -S deno run --allow-run --allow-env

import { parseArgs } from "@std/cli/parse-args";

interface Args {
  _: string[];
  help?: boolean;
  version?: boolean;
}

const CLAUDE_COMMANDS = {
  orchestrator: "/orchestrator",
  git: "/git",
  help: "/help",
} as const;

type CommandKey = keyof typeof CLAUDE_COMMANDS;

function showHelp() {
  console.log(`
ccarg - Claude Code コマンド引数ラッパー

使用方法:
  ccarg [オプション] <コマンド>

オプション:
  --help, -h     このヘルプを表示
  --version, -v  バージョンを表示

利用可能なコマンド:
  orchestrator   Claude Code を /orchestrator で起動
  git           Claude Code を /git で起動
  help          Claude Code を /help で起動

例:
  ccarg orchestrator
  ccarg git
  ccarg help
`);
}

function showVersion() {
  console.log("ccarg v1.0.0");
}

async function runClaudeCode(command: string): Promise<void> {
  const claudePath = "/Users/ao_ito_/.volta/bin/claude";
  
  try {
    const process = new Deno.Command(claudePath, {
      args: [command],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });

    const { code } = await process.output();
    
    if (code !== 0) {
      console.error(`Claude Code が終了コード ${code} で終了しました`);
      Deno.exit(code);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Claude Code の実行中にエラーが発生しました: ${errorMessage}`);
    Deno.exit(1);
  }
}

function isValidCommand(cmd: string): cmd is CommandKey {
  return cmd in CLAUDE_COMMANDS;
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["help", "version"],
    alias: {
      h: "help",
      v: "version",
    },
  }) as Args;

  if (args.help) {
    showHelp();
    return;
  }

  if (args.version) {
    showVersion();
    return;
  }

  if (args._.length === 0) {
    console.error("エラー: コマンドが指定されていません");
    showHelp();
    Deno.exit(1);
  }

  const commandName = args._[0] as string;

  if (!isValidCommand(commandName)) {
    console.error(`エラー: 不明なコマンド '${commandName}'`);
    console.error("利用可能なコマンド:", Object.keys(CLAUDE_COMMANDS).join(", "));
    Deno.exit(1);
  }

  const commandArg = CLAUDE_COMMANDS[commandName];
  
  console.log(`Claude Code を '${commandArg}' で起動中...`);
  await runClaudeCode(commandArg);
}

if (import.meta.main) {
  main();
}