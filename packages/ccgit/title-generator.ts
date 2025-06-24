import type { GitFileChange, SessionMetadata } from "../../shared/types.ts";
import { generateCommitTitle as generateTitleWithLLM } from "../../shared/commit-title-generator.ts";

// Simplified version of gclm's title generation
// Integrated with LLM for smarter titles with fallback

const FILE_TYPE_PATTERNS = {
  config: (path: string) => path.endsWith('.json') || path.includes('config') || path.endsWith('.toml') || path.endsWith('.yaml') || path.endsWith('.yml'),
  test: (path: string) => path.includes('test') || path.includes('spec') || path.endsWith('.test.ts') || path.endsWith('.spec.ts'),
  docs: (path: string) => path.endsWith('.md') || path.endsWith('.rst') || path.includes('docs/'),
  build: (path: string) => path.includes('build') || path.includes('dist') || path.endsWith('.lock'),
} as const;

export function generateCommitTitle(
  files: GitFileChange[],
  metadata: SessionMetadata
): string {
  // If we have a prompt, try to generate title from it
  if (metadata.prompt) {
    const shortPrompt = metadata.prompt.slice(0, 40).toLowerCase();
    
    // Common patterns
    if (shortPrompt.includes('fix')) return 'fix: ' + summarizePrompt(metadata.prompt);
    if (shortPrompt.includes('add')) return 'feat: ' + summarizePrompt(metadata.prompt);
    if (shortPrompt.includes('update')) return 'chore: ' + summarizePrompt(metadata.prompt);
    if (shortPrompt.includes('refactor')) return 'refactor: ' + summarizePrompt(metadata.prompt);
    if (shortPrompt.includes('test')) return 'test: ' + summarizePrompt(metadata.prompt);
    if (shortPrompt.includes('doc')) return 'docs: ' + summarizePrompt(metadata.prompt);
  }
  
  // Fallback to file-based detection
  const categories = categorizeFiles(files);
  
  if (categories.test.length > 0) return "test: update tests via Claude";
  if (categories.docs.length > 0) return "docs: update documentation via Claude";
  if (categories.config.length > 0) return "config: update configuration via Claude";
  if (categories.build.length > 0) return "build: update build files via Claude";
  if (files.some(f => f.status === 'A')) return "feat: add new files via Claude";
  if (files.some(f => f.status === 'D')) return "chore: remove files via Claude";
  
  return "feat: Claude chat session";
}

function summarizePrompt(prompt: string): string {
  // Simple prompt summarization
  const cleaned = prompt
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  
  // Take first 40 chars or until first punctuation
  const summary = cleaned.slice(0, 40);
  const punctIndex = summary.search(/[.!?]/);
  
  if (punctIndex > 0) {
    return summary.slice(0, punctIndex);
  }
  
  return summary.length === 40 ? summary + '...' : summary;
}

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