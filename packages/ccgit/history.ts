import { $ } from "jsr:@david/dax@0.40.0";
import * as git from "./git.ts";

export async function checkoutSession(sessionId: string): Promise<void> {
  const commits = await git.getCommitsBySessionId(sessionId);
  
  if (commits.length === 0) {
    console.error(`❌ No commits found for session ID: ${sessionId}`);
    Deno.exit(1);
  }
  
  // Checkout the first (most recent) commit
  await git.checkoutCommit(commits[0]);
  console.log(`✅ Checked out session: ${sessionId}`);
}

export async function startSession(name: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const branchName = `claude/${name}-${timestamp}`;
  
  await git.createBranch(branchName);
  console.log(`✅ Created branch: ${branchName}`);
}

export async function listSessions(): Promise<void> {
  try {
    const result = await $`git log --grep="Session-ID:" --format="%H|%s|%ai" --reverse`.text();
    const lines = result.trim().split('\n').filter(Boolean);
    
    if (lines.length === 0) {
      console.log("No Claude sessions found.");
      return;
    }
    
    console.log("Recent Claude sessions:");
    console.log("─".repeat(60));
    
    for (const line of lines.slice(-10)) { // Show last 10 sessions
      const [hash, subject, date] = line.split('|');
      const sessionIdMatch = subject.match(/Session-ID: ([^\s]+)/);
      const sessionId = sessionIdMatch ? sessionIdMatch[1] : 'unknown';
      const shortHash = hash.substring(0, 7);
      const formattedDate = new Date(date).toLocaleString();
      
      console.log(`${shortHash} ${sessionId.padEnd(20)} ${formattedDate}`);
    }
  } catch (error) {
    console.error(`Failed to list sessions: ${error}`);
  }
}