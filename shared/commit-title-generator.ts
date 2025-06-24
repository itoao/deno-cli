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
    .map((f) => (f.diff ?? "").split("\n").slice(0, config.maxDiffPreviewLines).join("\n"))
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

Return only the title:`;
}

function extractTitleFromMessages(messages: SDKMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    if (message.type === "result" && "result" in message && message.result) {
      const title = String(message.result).trim();
      // Extract only the commit title, remove any extra explanatory text
      const lines = title.split("\n");
      return lines[0].trim();
    }

    if (
      message.type === "assistant" && "message" in message &&
      message.message?.content
    ) {
      for (const content of message.message.content) {
        if (content.type === "text" && content.text) {
          const title = String(content.text).trim();
          // Extract only the commit title, remove any extra explanatory text
          const lines = title.split("\n");
          return lines[0].trim();
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
      messages.push(message);
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
