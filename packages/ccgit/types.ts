export interface SessionMetadata {
  sessionId: string;
  prompt?: string;
  timestamp: string;
  resumedFrom?: string;
}

export interface GitCommitInfo {
  title: string;
  message: string;
  files: string[];
}

export interface ClaudeOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitFileChange {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | 'T';
  diff?: string;
}