import { query, type SDKMessage } from "npm:@anthropic-ai/claude-code";

interface GitFileChange {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | 'T';
  diff: string;
}

interface FileGroup {
  files: GitFileChange[];
  title?: string;
}

const MAX_DIFF_PREVIEW_LINES = 5;
const MAX_COMMIT_TITLE_LENGTH = 50;
const QUERY_OPTIONS = {
  maxTurns: 2,
} as const;

async function executeGitCommand(args: string[]): Promise<string> {
  const process = new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  
  const result = await process.output();
  if (!result.success) {
    const error = new TextDecoder().decode(result.stderr);
    throw new Error(`Git command failed: ${args.join(' ')} - ${error}`);
  }
  
  return new TextDecoder().decode(result.stdout);
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
        const diff = await executeGitCommand(["diff", "--cached", path]);
        return { path, status, diff };
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
  const diffLines = file.diff.split('\n');
  const preview = diffLines.slice(0, MAX_DIFF_PREVIEW_LINES).join('\n');
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
      options: QUERY_OPTIONS,
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
    } catch (parseError) {
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

const FILE_TYPE_PATTERNS = {
  config: (path: string) => path.endsWith('.json') || path.includes('config') || path.endsWith('.toml') || path.endsWith('.yaml') || path.endsWith('.yml'),
  test: (path: string) => path.includes('test') || path.includes('spec') || path.endsWith('.test.ts') || path.endsWith('.spec.ts'),
  docs: (path: string) => path.endsWith('.md') || path.endsWith('.rst') || path.includes('docs/'),
  build: (path: string) => path.includes('build') || path.includes('dist') || path.endsWith('.lock'),
} as const;

function categorizeFiles(files: GitFileChange[]) {
  const categories = {
    config: [] as GitFileChange[],
    test: [] as GitFileChange[],
    docs: [] as GitFileChange[],
    build: [] as GitFileChange[],
    other: [] as GitFileChange[],
  };
  
  for (const file of files) {
    let categorized = false;
    
    for (const [category, matcher] of Object.entries(FILE_TYPE_PATTERNS)) {
      if (matcher(file.path)) {
        categories[category as keyof typeof categories].push(file);
        categorized = true;
        break;
      }
    }
    
    if (!categorized) {
      categories.other.push(file);
    }
  }
  
  return categories;
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

function createCommitPrompt(files: GitFileChange[]): string {
  const fileList = files.map(f => `${f.path} (${f.status})`).join('\n');
  const diffSample = files
    .map(f => f.diff.split('\n').slice(0, 10).join('\n'))
    .join('\n---\n');
  
  return `Generate a concise commit title for these changes:

Files:
${fileList}

Diff:
${diffSample}

Rules:
- Use conventional commit format (feat:, fix:, docs:, refactor:, test:, config:, chore:)
- Be specific about what changed
- Max ${MAX_COMMIT_TITLE_LENGTH} characters
- No quotes
- IMPORTANT: Return ONLY the commit title, no explanations or additional text

Example output:
feat: add user authentication
fix: resolve memory leak in parser
chore: update dependencies

Return only the title:`;
}

function extractTitleFromMessages(messages: SDKMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    
    if (message.type === 'result' && 'result' in message && message.result) {
      const title = String(message.result).trim();
      // Extract only the commit title, remove any extra explanatory text
      const lines = title.split('\n');
      return lines[0].trim();
    }
    
    if (message.type === 'assistant' && 'message' in message && message.message?.content) {
      for (const content of message.message.content) {
        if (content.type === 'text' && content.text) {
          const title = String(content.text).trim();
          // Extract only the commit title, remove any extra explanatory text
          const lines = title.split('\n');
          return lines[0].trim();
        }
      }
    }
  }
  
  return null;
}

function generateFallbackTitle(files: GitFileChange[]): string {
  const categories = categorizeFiles(files);
  
  if (categories.test.length > 0) return "test: update tests";
  if (categories.docs.length > 0) return "docs: update documentation";
  if (categories.config.length > 0) return "config: update configuration";
  if (categories.build.length > 0) return "build: update build files";
  if (files.some(f => f.status === 'A')) return "feat: add new files";
  if (files.some(f => f.status === 'D')) return "chore: remove files";
  return "refactor: update code";
}

async function generateCommitTitle(files: GitFileChange[]): Promise<string> {
  const prompt = createCommitPrompt(files);

  try {
    const messages: SDKMessage[] = [];
    const abortController = new AbortController();
    
    for await (const message of query({
      prompt,
      abortController,
      options: QUERY_OPTIONS,
    })) {
      messages.push(message);
    }
    
    const title = extractTitleFromMessages(messages);
    if (!title) {
      throw new Error("No valid title found in messages");
    }
    
    return title.length > MAX_COMMIT_TITLE_LENGTH 
      ? title.substring(0, MAX_COMMIT_TITLE_LENGTH - 3) + '...'
      : title;
  } catch (error) {
    console.warn("⚠️ Failed to generate title, using fallback:", error instanceof Error ? error.message : String(error));
    return generateFallbackTitle(files);
  }
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
  
  const title = await generateCommitTitle(group);
  await createCommit(group, title);
}

async function main() {
  try {
    console.log("🔍 Analyzing staged files...");
    const stagedFiles = await getGitStagedFiles();
    
    if (stagedFiles.length === 0) {
      console.log("❌ No staged files found. Use 'git add' first.");
      return;
    }
    
    console.log(`📁 Found ${stagedFiles.length} staged files`);
    
    console.log("🧠 Using AI to group files into logical commits...");
    const groups = await groupFilesByLLM(stagedFiles);
    console.log(`📦 AI suggested ${groups.length} logical commits`);
    
    for (let i = 0; i < groups.length; i++) {
      await processCommitGroup(groups[i], i, groups.length);
    }
    
    console.log("\n🎉 All commits created!");
    
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}