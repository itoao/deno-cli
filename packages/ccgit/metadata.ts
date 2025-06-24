import type { ClaudeOutput, SessionMetadata } from "../../shared/types.ts";

const SESSION_ID_PATTERN = /Session ID: ([a-zA-Z0-9_-]+)/;

export function extractSessionId(output: ClaudeOutput): string | null {
  // Try to find session ID in stdout
  const match = output.stdout.match(SESSION_ID_PATTERN);
  if (match) {
    return match[1];
  }
  
  // Try stderr as fallback
  const stderrMatch = output.stderr.match(SESSION_ID_PATTERN);
  if (stderrMatch) {
    return stderrMatch[1];
  }
  
  return null;
}

export function extractResumeId(args: string[]): string | undefined {
  const resumeIndex = args.indexOf('--resume');
  if (resumeIndex !== -1 && resumeIndex < args.length - 1) {
    return args[resumeIndex + 1];
  }
  return undefined;
}

export function extractPrompt(args: string[]): string | undefined {
  // Find non-flag arguments (potential prompts)
  const prompts = args.filter(arg => !arg.startsWith('-'));
  return prompts.length > 0 ? prompts.join(' ') : undefined;
}

export function parseClaudeOutput(
  output: ClaudeOutput,
  args: string[]
): SessionMetadata {
  const sessionId = extractSessionId(output) || generateSessionId();
  const resumedFrom = extractResumeId(args);
  const prompt = extractPrompt(args);
  
  return {
    sessionId,
    prompt,
    timestamp: new Date().toISOString(),
    resumedFrom,
  };
}

function generateSessionId(): string {
  // Simple session ID generation (timestamp + random)
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 7);
  return `${timestamp}-${random}`;
}