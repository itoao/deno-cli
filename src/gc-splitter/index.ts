import { query, type SDKMessage } from "@anthropic-ai/claude-code";

interface GitFileChange {
  path: string;
  status: string;
  diff: string;
}


async function getGitStagedFiles(): Promise<GitFileChange[]> {
  const statusProcess = new Deno.Command("git", {
    args: ["diff", "--cached", "--name-status"],
    stdout: "piped",
    stderr: "piped",
  });
  
  const statusResult = await statusProcess.output();
  if (!statusResult.success) {
    throw new Error("Failed to get git diff --cached");
  }
  
  const statusOutput = new TextDecoder().decode(statusResult.stdout);
  const stagedFiles: GitFileChange[] = [];
  
  for (const line of statusOutput.split('\n').filter(l => l.trim())) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const status = parts[0];
      const path = parts[1];
      
      const diffProcess = new Deno.Command("git", {
        args: ["diff", "--cached", path],
        stdout: "piped",
        stderr: "piped",
      });
      
      const diffResult = await diffProcess.output();
      const diff = new TextDecoder().decode(diffResult.stdout);
      
      stagedFiles.push({
        path,
        status,
        diff
      });
    }
  }
  
  return stagedFiles;
}

function groupFilesByCommitLogic(files: GitFileChange[]): GitFileChange[][] {
  const groups: GitFileChange[][] = [];
  const configFiles: GitFileChange[] = [];
  const testFiles: GitFileChange[] = [];
  const docFiles: GitFileChange[] = [];
  const srcFiles: GitFileChange[] = [];
  const miscFiles: GitFileChange[] = [];
  
  for (const file of files) {
    const path = file.path.toLowerCase();
    
    if (path.includes('config') || path.endsWith('.json') || path.endsWith('.yaml') || path.endsWith('.yml') || path.endsWith('.toml')) {
      configFiles.push(file);
    } else if (path.includes('test') || path.includes('spec') || path.endsWith('.test.ts') || path.endsWith('.spec.ts')) {
      testFiles.push(file);
    } else if (path.endsWith('.md') || path.includes('doc') || path.includes('readme')) {
      docFiles.push(file);
    } else if (path.endsWith('.ts') || path.endsWith('.js') || path.endsWith('.tsx') || path.endsWith('.jsx')) {
      srcFiles.push(file);
    } else {
      miscFiles.push(file);
    }
  }
  
  if (configFiles.length > 0) groups.push(configFiles);
  if (testFiles.length > 0) groups.push(testFiles);
  if (docFiles.length > 0) groups.push(docFiles);
  if (srcFiles.length > 0) groups.push(srcFiles);
  if (miscFiles.length > 0) groups.push(miscFiles);
  
  return groups;
}

async function generateCommitTitle(files: GitFileChange[]): Promise<string> {
  const fileList = files.map(f => `${f.path} (${f.status})`).join('\n');
  const diffSample = files.map(f => f.diff.split('\n').slice(0, 10).join('\n')).join('\n---\n');
  
  const prompt = `Generate a concise commit title (max 50 characters) for the following git changes:

Files:
${fileList}

Diff sample:
${diffSample}

Rules:
- Use conventional commit format (feat:, fix:, docs:, refactor:, test:, etc.)
- Be specific about what changed
- Keep it under 50 characters
- Use present tense
- Start with lowercase after the type prefix

Return only the commit title, nothing else.`;

  const messages: SDKMessage[] = [];
  
  for await (const message of query({
    prompt,
    abortController: new AbortController(),
    options: {
      maxTurns: 1,
    },
  })) {
    messages.push(message);
  }
  
  const lastMessage = messages[messages.length - 1];
  if (lastMessage.type === 'assistant' && 'text' in lastMessage) {
    return String(lastMessage.text).trim();
  }
  return "feat: update files";
}

async function createCommit(files: GitFileChange[], title: string): Promise<void> {
  const filePaths = files.map(f => f.path);
  
  const addProcess = new Deno.Command("git", {
    args: ["add", ...filePaths],
    stdout: "piped",
    stderr: "piped",
  });
  
  const addResult = await addProcess.output();
  if (!addResult.success) {
    throw new Error("Failed to add files to git");
  }
  
  const commitProcess = new Deno.Command("git", {
    args: ["commit", "-m", title],
    stdout: "piped",
    stderr: "piped",
  });
  
  const commitResult = await commitProcess.output();
  if (!commitResult.success) {
    const error = new TextDecoder().decode(commitResult.stderr);
    throw new Error(`Failed to commit: ${error}`);
  }
  
  console.log(`✅ Committed: ${title}`);
}

async function main() {
  try {
    console.log("🔍 Analyzing staged files...");
    const stagedFiles = await getGitStagedFiles();

    if (stagedFiles.length === 0) {
      console.log("❌ No staged files found. Please stage files first with 'git add'.");
      return;
    }
    
    console.log(`📁 Found ${stagedFiles.length} staged files`);
    
    const groups = groupFilesByCommitLogic(stagedFiles);
    console.log(`📦 Split into ${groups.length} commit groups`);
    
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      console.log(`\n🤔 Generating commit title for group ${i + 1}...`);
      
      const title = await generateCommitTitle(group);
      console.log(`📝 Title: ${title}`);
      
      await createCommit(group, title);
    }
    
    console.log("\n🎉 All commits created successfully!");
    
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}