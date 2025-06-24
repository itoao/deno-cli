import { query, type SDKMessage } from "npm:@anthropic-ai/claude-code";
import type { GitFileChange } from "./types.ts";
import { warn } from "./error-handler.ts";

interface CommitTitleConfig {
  maxCommitTitleLength: number;
  maxDiffPreviewLines: number;
  queryOptions: {
    maxTurns: number;
  };
}

const DEFAULT_CONFIG: CommitTitleConfig = {
  maxCommitTitleLength: 50,
  maxDiffPreviewLines: 10,
  queryOptions: {
    maxTurns: 2,
  },
};

const FILE_TYPE_PATTERNS = {
  config: (path: string) =>
    path.endsWith(".json") || path.includes("config") ||
    path.endsWith(".toml") || path.endsWith(".yaml") || path.endsWith(".yml"),
  test: (path: string) =>
    path.includes("test") || path.includes("spec") ||
    path.endsWith(".test.ts") || path.endsWith(".spec.ts"),
  docs: (path: string) => path.endsWith(".md") || path.endsWith(".rst") || path.includes("docs/"),
  build: (path: string) =>
    path.includes("build") || path.includes("dist") || path.endsWith(".lock"),
} as const;

function categorizeFiles(files: GitFileChange[]): {
  config: GitFileChange[];
  test: GitFileChange[];
  docs: GitFileChange[];
  build: GitFileChange[];
  other: GitFileChange[];
} {
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

function generateFallbackTitle(files: GitFileChange[]): string {
  const categories = categorizeFiles(files);

  if (categories.test.length > 0) return "test: update tests";
  if (categories.docs.length > 0) return "docs: update documentation";
  if (categories.config.length > 0) return "config: update configuration";
  if (categories.build.length > 0) return "build: update build files";
  if (files.some((f) => f.status === "A")) return "feat: add new files";
  if (files.some((f) => f.status === "D")) return "chore: remove files";
  return "refactor: update code";
}

function createCommitPrompt(
  files: GitFileChange[],
  config: CommitTitleConfig,
): string {
  const fileList = files.map((f) => `${f.path} (${f.status})`).join("\n");
  const diffSample = files
    .filter((f) => f.diff)
    .map((f) => (f.diff ?? "").replace(/\0/g, '').split("\n").slice(0, config.maxDiffPreviewLines).join("\n"))
    .join("\n---\n");

  return `Generate a concise commit title for these changes:

Files:
${fileList}

${diffSample ? `Diff:\n${diffSample}\n` : ""}
Rules:
- Use conventional commit format (feat:, fix:, docs:, refactor:, test:, config:, chore:)
- Be specific about what changed
- Max ${config.maxCommitTitleLength} characters
- No quotes
- IMPORTANT: Return ONLY the commit title, no explanations or additional text

Example output:
feat: add user authentication
fix: resolve memory leak in parser
chore: update dependencies

Return only the title:`.replace(/\0/g, '');
}

function isValidCommitTitle(text: string): boolean {
  if (!text || text.length === 0) return false;
  
  // Check if it starts with conventional commit prefix
  const conventionalPrefixes = [
    'feat:', 'fix:', 'docs:', 'refactor:', 'test:', 'config:', 'chore:', 
    'style:', 'perf:', 'build:', 'ci:', 'revert:', 'wip:'
  ];
  
  const hasValidPrefix = conventionalPrefixes.some(prefix => 
    text.toLowerCase().startsWith(prefix.toLowerCase())
  );
  
  // Check if it looks like explanatory text (contains common conversational phrases)
  const conversationalPhrases = [
    "i'll", "looking at", "based on", "here", "this", "the code", 
    "let me", "i can see", "it appears", "from the diff", "appears to",
    "wait for your input", "what task would you", "help you with"
  ];
  
  const hasConversationalPhrase = conversationalPhrases.some(phrase =>
    text.toLowerCase().includes(phrase.toLowerCase())
  );
  
  // Valid if has prefix and doesn't contain conversational phrases
  return hasValidPrefix && !hasConversationalPhrase;
}

function extractTitleFromMessages(messages: SDKMessage[]): string | null {
  // Check if messages is null or empty
  if (!messages || messages.length === 0) {
    return null;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    
    // Null check for message
    if (!message) {
      continue;
    }

    if (message.type === "result" && "result" in message && message.result) {
      const title = String(message.result).trim();
      const lines = title.split("\n");
      
      // Try each line to find a valid commit title
      for (const line of lines) {
        const cleanLine = line.trim();
        if (isValidCommitTitle(cleanLine)) {
          return cleanLine;
        }
      }
    }

    if (
      message.type === "assistant" && "message" in message &&
      message.message?.content
    ) {
      for (const content of message.message.content) {
        if (content?.type === "text" && content.text) {
          const title = String(content.text).trim();
          const lines = title.split("\n");
          
          // Try each line to find a valid commit title
          for (const line of lines) {
            const cleanLine = line.trim();
            if (isValidCommitTitle(cleanLine)) {
              return cleanLine;
            }
          }
        }
      }
    }
  }

  return null;
}

export async function generateCommitTitle(
  files: GitFileChange[],
  config: Partial<CommitTitleConfig> = {},
): Promise<string> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const prompt = createCommitPrompt(files, mergedConfig);

  try {
    const messages: SDKMessage[] = [];
    const abortController = new AbortController();

    for await (
      const message of query({
        prompt,
        abortController,
        options: mergedConfig.queryOptions,
      })
    ) {
      if (message) { // Add null check
        messages.push(message);
      }
    }

    const title = extractTitleFromMessages(messages);
    if (!title) {
      throw new Error("No valid title found in messages");
    }

    return title.length > mergedConfig.maxCommitTitleLength
      ? title.substring(0, mergedConfig.maxCommitTitleLength - 3) + "..."
      : title;
  } catch (error) {
    warn(
      `Failed to generate title, using fallback: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return generateFallbackTitle(files);
  }
}

export { categorizeFiles, generateFallbackTitle };
