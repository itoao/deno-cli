import { $ } from "jsr:@david/dax@0.40.0";
import { parseArgs } from "node:util";
import { query, type SDKMessage } from "npm:@anthropic-ai/claude-code";
import { generateCommitTitle, categorizeFiles, type GitFileChange } from "../../shared/commit-title-generator.ts";


interface Config {
  maxDiffPreviewLines: number;
  maxCommitTitleLength: number;
  queryOptions: {
    maxTurns: number;
  };
}

const CONFIG: Config = {
  maxDiffPreviewLines: 5,
  maxCommitTitleLength: 50,
  queryOptions: {
    maxTurns: 2,
  },
};

async function getGitRoot(): Promise<string> {
  try {
    const result = await $`git rev-parse --show-toplevel`.text();
    return result.trim();
  } catch (error) {
    throw new Error(`Failed to get git root: ${error}`);
  }
}

async function executeGitCommand(args: string[]): Promise<string> {
  try {
    const gitRoot = await getGitRoot();
    const result = await $`git ${args}`.cwd(gitRoot).text();
    return result;
  } catch (error) {
    throw new Error(`Git command failed: git ${args.join(' ')} - ${error}`);
  }
}

async function getGitStagedFiles(): Promise<GitFileChange[]> {
  try {
    const statusOutput = await executeGitCommand(["diff", "--cached", "--name-status"]);
    const statusLines = statusOutput.split('\n').filter(l => l.trim());
    
    if (statusLines.length === 0) {
      return [];
    }
    
    const filePromises = statusLines.map(async (line) => {
      const parts = line.split('\t');
      if (parts.length < 2) return null;
      
      const status = parts[0] as GitFileChange['status'];
      const path = parts[1];
      
      try {
        let diff: string;
        if (status === 'A') {
          // For new files, use git show to get the content
          diff = await executeGitCommand(["show", `--format=`, `:${path}`]);
        } else {
          // For modified/deleted files, use git diff
          diff = await executeGitCommand(["diff", "--cached", path]);
        }
        return { path, status, diff } as GitFileChange;
      } catch (error) {
        console.warn(`⚠️ Failed to get diff for ${path}:`, error);
        return { path, status, diff: '' };
      }
    });
    
    const results = await Promise.all(filePromises);
    return results.filter((file): file is GitFileChange => file !== null);
  } catch (error) {
    throw new Error(`Failed to get staged files: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function createFilePreview(file: GitFileChange): string {
  const diffLines = file.diff ? file.diff.split('\n') : [];
  const preview = diffLines.slice(0, CONFIG.maxDiffPreviewLines).join('\n');
  return `- ${file.path} (${file.status})\n  Changes: ${preview}`;
}

async function groupFilesByLLM(files: GitFileChange[]): Promise<GitFileChange[][]> {
  if (files.length === 0) {
    return [];
  }
  
  const fileList = files.map(createFilePreview).join('\n\n');
  
  const prompt = `Analyze these staged git files and group them into logical commits. Each group should be a cohesive set of changes.

Files:
${fileList}

Rules:
- Group related functionality together
- Separate configuration from code changes  
- Keep tests with related code OR separate if testing multiple features
- Documentation changes should be separate unless directly related
- Bug fixes separate from new features
- Don't create too many tiny commits - combine related changes

Return a JSON array where each element is an array of file paths to commit together:
[
  ["file1.ts", "file2.ts"],
  ["config.json"], 
  ["README.md"]
]

Return ONLY the JSON array, no other text.`;

  try {
    const messages: SDKMessage[] = [];
    const abortController = new AbortController();
    
    for await (const message of query({
      prompt,
      abortController,
      options: CONFIG.queryOptions,
    })) {
      messages.push(message);
    }
    
    const groupPaths = extractGroupPathsFromMessages(messages);
    if (!groupPaths) {
      throw new Error("No valid response found in messages");
    }
    
    return convertPathsToFileGroups(groupPaths, files);
  } catch (error) {
    console.warn("⚠️ LLM grouping failed, using simple fallback:", error instanceof Error ? error.message : String(error));
    return fallbackGrouping(files);
  }
}

/**
 * AIから受信したメッセージ群からファイルパスのグループ化情報を抽出する関数
 * 
 * 処理内容:
 * 1. メッセージを逆順で検索 - 最新のメッセージから順にチェック（最後の応答が最も重要）
 * 2. メッセージタイプ別の処理
 *    - message.type === 'result': 直接的な結果メッセージ
 *    - message.type === 'assistant': アシスタントからの通常応答
 * 3. JSON抽出とパース
 *    - 正規表現で[...]形式のJSON配列を検索
 *    - 余分なテキストがあってもJSON部分だけを抽出
 * 
 * 期待する返り値:
 * [
 *   ["file1.ts", "file2.ts"],    // グループ1
 *   ["config.json"],             // グループ2
 *   ["README.md"]                // グループ3
 * ]
 * 
 * つまり、AIが「どのファイルを一緒にコミットすべきか」を判断した結果を、
 * プログラムが使える配列形式に変換する処理
 */
function extractGroupPathsFromMessages(messages: SDKMessage[]): string[][] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    
    try {
      if (message.type === 'result' && 'result' in message && message.result) {
        const groupsText = String(message.result).trim();
        // Try to extract JSON from the text if it contains extra content
        const jsonMatch = groupsText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        return JSON.parse(groupsText);
      }
      
      if (message.type === 'assistant' && 'message' in message && message.message?.content) {
        for (const content of message.message.content) {
          if (content.type === 'text' && content.text) {
            const groupsText = String(content.text).trim();
            // Try to extract JSON from the text if it contains extra content
            const jsonMatch = groupsText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              return JSON.parse(jsonMatch[0]);
            }
            return JSON.parse(groupsText);
          }
        }
      }
    } catch {
      // Don't log parse errors to reduce noise
      continue;
    }
  }
  
  return null;
}

function convertPathsToFileGroups(groupPaths: string[][], files: GitFileChange[]): GitFileChange[][] {
  const fileMap = new Map(files.map(f => [f.path, f]));
  const groups: GitFileChange[][] = [];
  
  for (const pathGroup of groupPaths) {
    const group: GitFileChange[] = [];
    for (const path of pathGroup) {
      const file = fileMap.get(path);
      if (file) {
        group.push(file);
      }
    }
    if (group.length > 0) {
      groups.push(group);
    }
  }
  
  const groupedPaths = new Set(groupPaths.flat());
  const ungroupedFiles = files.filter(f => !groupedPaths.has(f.path));
  if (ungroupedFiles.length > 0) {
    groups.push(ungroupedFiles);
  }
  
  return groups;
}


function fallbackGrouping(files: GitFileChange[]): GitFileChange[][] {
  const categories = categorizeFiles(files);
  const groups: GitFileChange[][] = [];
  
  const order = ['config', 'docs', 'other', 'test', 'build'] as const;
  for (const category of order) {
    if (categories[category].length > 0) {
      groups.push(categories[category]);
    }
  }
  
  return groups.length > 0 ? groups : [files];
}


async function hasChangesToCommit(): Promise<boolean> {
  try {
    await executeGitCommand(["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    return true;
  }
}

async function createCommit(files: GitFileChange[], title: string): Promise<void> {
  const filePaths = files.map(f => f.path);
  
  try {
    await executeGitCommand(["reset"]);
    await executeGitCommand(["add", ...filePaths]);
    
    const hasChanges = await hasChangesToCommit();
    if (!hasChanges) {
      console.log(`⚠️ No changes to commit for: ${filePaths.join(', ')}`);
      return;
    }
    
    await executeGitCommand(["commit", "-m", title]);
    console.log(`✅ ${title}`);
  } catch (error) {
    throw new Error(`Failed to create commit: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function processCommitGroup(group: GitFileChange[], index: number, total: number): Promise<void> {
  console.log(`\n📝 Commit ${index + 1}/${total}:`);
  console.log(`   Files: ${group.map(f => f.path).join(', ')}`);
  
  const title = await generateCommitTitle(group, {
    maxCommitTitleLength: CONFIG.maxCommitTitleLength,
    maxDiffPreviewLines: CONFIG.maxDiffPreviewLines,
    queryOptions: CONFIG.queryOptions,
  });
  await createCommit(group, title);
}

async function main() {
  const parsed = parseArgs({
    options: {
      help: {
        type: "boolean",
        short: "h",
      },
      version: {
        type: "boolean",
        short: "v",
      },
      verbose: {
        type: "boolean",
        default: false,
      },
    },
    allowPositionals: true,
  });

  if (parsed.values.help) {
    console.log(`Git Commit LLM (gclm) - AI-powered git commit tool

Usage: gclm [options]

Options:
  -h, --help      Show this help message
  -v, --version   Show version
  --verbose       Enable verbose output

This tool analyzes staged git files and creates logical commits with AI-generated messages.
Make sure to stage your files with 'git add' before running gclm.
`);
    return;
  }

  if (parsed.values.version) {
    console.log("gclm version 1.0.0");
    return;
  }

  try {
    if (parsed.values.verbose) {
      console.log("🔍 Analyzing staged files...");
    }
    const stagedFiles = await getGitStagedFiles();
    
    if (stagedFiles.length === 0) {
      console.log("❌ No staged files found. Use 'git add' first.");
      return;
    }
    
    if (parsed.values.verbose) {
      console.log(`📁 Found ${stagedFiles.length} staged files`);
    }
    
    if (stagedFiles.length === 1) {
      if (parsed.values.verbose) {
        console.log("📝 Single file found, creating single commit...");
      }
      const title = await generateCommitTitle(stagedFiles, {
        maxCommitTitleLength: CONFIG.maxCommitTitleLength,
        maxDiffPreviewLines: CONFIG.maxDiffPreviewLines,
        queryOptions: CONFIG.queryOptions,
      });
      await createCommit(stagedFiles, title);
      console.log("\n🎉 Commit created!");
      return;
    }
    
    if (parsed.values.verbose) {
      console.log("🧠 Using AI to group files into logical commits...");
    }
    const groups = await groupFilesByLLM(stagedFiles);
    if (parsed.values.verbose) {
      console.log(`📦 AI suggested ${groups.length} logical commits`);
    }
    
    for (let i = 0; i < groups.length; i++) {
      await processCommitGroup(groups[i], i, groups.length);
    }
    
    console.log("\n🎉 All commits created!");
    
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

Deno.test("JSONレスポンスからファイルグループを抽出する", () => {
  const messages = [
    { type: 'result', result: '[["file1.ts", "file2.ts"], ["config.json"]]' }
  ] as SDKMessage[];
  
  const result = extractGroupPathsFromMessages(messages);
  const expected = [["file1.ts", "file2.ts"], ["config.json"]];
  
  if (JSON.stringify(result) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
  }
});


if (import.meta.main) {
  main();
}