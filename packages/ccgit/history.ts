import { $ } from "jsr:@david/dax@0.40.0";
import * as git from "./git.ts";

export async function checkoutSession(sessionIdOrHash: string): Promise<void> {
  // First try as a commit hash
  try {
    await git.checkoutCommit(sessionIdOrHash);
    console.log(`✅ Checked out commit: ${sessionIdOrHash}`);
    return;
  } catch {
    // If that fails, try as a session ID
    const commits = await git.getCommitsBySessionId(sessionIdOrHash);
    
    if (commits.length === 0) {
      console.error(`❌ No commits found for session ID or hash: ${sessionIdOrHash}`);
      Deno.exit(1);
    }
    
    // Checkout the first (most recent) commit
    await git.checkoutCommit(commits[0]);
    console.log(`✅ Checked out session: ${sessionIdOrHash}`);
  }
}

export async function startSession(name: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const branchName = `claude/${name}-${timestamp}`;
  
  await git.createBranch(branchName);
  console.log(`✅ Created branch: ${branchName}`);
}

export async function listSessions(): Promise<void> {
  try {
    const result = await $`git log --grep="Session-ID:" --format="%H|%B|%ai" --reverse`.text();
    const commits = result.trim().split('\n\n').filter(Boolean);
    
    if (commits.length === 0) {
      console.log("No Claude sessions found.");
      return;
    }
    
    console.log("Recent Claude sessions:");
    console.log("─".repeat(60));
    
    for (const commit of commits.slice(-10)) { // Show last 10 sessions
      const lines = commit.split('\n');
      const [hash, , date] = lines[0].split('|');
      const body = lines.slice(1).join('\n');
      const sessionIdMatch = body.match(/Session-ID: ([^\s\n]+)/);
      const sessionId = sessionIdMatch ? sessionIdMatch[1] : 'unknown';
      const shortHash = hash.substring(0, 7);
      const formattedDate = new Date(date).toLocaleString();
      
      console.log(`${shortHash} ${sessionId.padEnd(20)} ${formattedDate}`);
    }
  } catch (error) {
    console.error(`Failed to list sessions: ${error}`);
  }
}