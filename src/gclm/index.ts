import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.54.0";

interface GitFileChange {
  path: string;
  status: string;
  diff: string;
}

async function getGitStagedFiles(): Promise<GitFileChange[]> {
  const statusProcess = Deno.run({
    cmd: ["git", "diff", "--cached", "--name-status"],
    stdout: "piped",
    stderr: "piped",
  });
  
  const statusResult = await statusProcess.status();
  if (!statusResult.success) {
    throw new Error("Failed to get git diff --cached");
  }
  
  const rawOutput = await statusProcess.output();
  const statusOutput = new TextDecoder().decode(rawOutput);
  statusProcess.close();
  const stagedFiles: GitFileChange[] = [];
  
  for (const line of statusOutput.split('\n').filter(l => l.trim())) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const status = parts[0];
      const path = parts[1];
      
      const diffProcess = Deno.run({
        cmd: ["git", "diff", "--cached", path],
        stdout: "piped",
        stderr: "piped",
      });
      
      const rawDiff = await diffProcess.output();
      const diff = new TextDecoder().decode(rawDiff);
      diffProcess.close();
      
      stagedFiles.push({
        path,
        status,
        diff
      });
    }
  }
  
  return stagedFiles;
}

async function groupFilesByLLM(files: GitFileChange[]): Promise<GitFileChange[][]> {
  const fileList = files.map(f => ({
    path: f.path,
    status: f.status,
    diffPreview: f.diff.split('\n').slice(0, 5).join('\n')
  }));
  
  const prompt = `Analyze these staged git files and group them into logical commits. Each group should be a cohesive set of changes.

Files:
${fileList.map(f => `- ${f.path} (${f.status})
  Changes: ${f.diffPreview}`).join('\n\n')}

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
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY'),
    });
    
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });
    
    const content = response.content[0];
    if (content.type === 'text') {
      const groupsText = content.text.trim();
      const groupPaths: string[][] = JSON.parse(groupsText);
      return convertPathsToFileGroups(groupPaths, files);
    }
    
    throw new Error("No valid response found");
  } catch (_error) {
    console.warn("⚠️ LLM grouping failed, using simple fallback");
    return fallbackGrouping(files);
  }
}

function convertPathsToFileGroups(groupPaths: string[][], files: GitFileChange[]): GitFileChange[][] {
  const groups: GitFileChange[][] = [];
  
  for (const pathGroup of groupPaths) {
    const group: GitFileChange[] = [];
    for (const path of pathGroup) {
      const file = files.find(f => f.path === path);
      if (file) {
        group.push(file);
      }
    }
    if (group.length > 0) {
      groups.push(group);
    }
  }
  
  // Add any files that weren't included in the LLM response
  const groupedPaths = new Set(groupPaths.flat());
  const ungroupedFiles = files.filter(f => !groupedPaths.has(f.path));
  if (ungroupedFiles.length > 0) {
    groups.push(ungroupedFiles);
  }
  
  return groups;
}

function fallbackGrouping(files: GitFileChange[]): GitFileChange[][] {
  // Simple fallback: group by file type
  const configFiles = files.filter(f => f.path.endsWith('.json') || f.path.includes('config'));
  const testFiles = files.filter(f => f.path.includes('test') || f.path.includes('spec'));
  const docFiles = files.filter(f => f.path.endsWith('.md'));
  const otherFiles = files.filter(f => !configFiles.includes(f) && !testFiles.includes(f) && !docFiles.includes(f));
  
  const groups: GitFileChange[][] = [];
  if (configFiles.length > 0) groups.push(configFiles);
  if (docFiles.length > 0) groups.push(docFiles);
  if (otherFiles.length > 0) groups.push(otherFiles);
  if (testFiles.length > 0) groups.push(testFiles);
  
  return groups;
}

async function generateCommitTitle(files: GitFileChange[]): Promise<string> {
  const fileList = files.map(f => `${f.path} (${f.status})`).join('\n');
  const diffSample = files.map(f => f.diff.split('\n').slice(0, 10).join('\n')).join('\n---\n');
  
  const prompt = `Generate a concise commit title for these changes:

Files:
${fileList}

Diff:
${diffSample}

Rules:
- Use conventional commit format (feat:, fix:, docs:, refactor:, test:, config:, chore:)
- Be specific about what changed
- Max 50 characters
- No quotes

Return only the title.`;

  try {
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY'),
    });
    
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });
    
    const content = response.content[0];
    if (content.type === 'text') {
      return content.text.trim();
    }
    
    throw new Error("No valid response found");
  } catch (_error) {
    console.warn("⚠️ Failed to generate title, using fallback");
    
    // Simple fallback based on file types
    const paths = files.map(f => f.path);
    if (paths.some(p => p.includes('test'))) return "test: update tests";
    if (paths.some(p => p.endsWith('.md'))) return "docs: update documentation";
    if (paths.some(p => p.endsWith('.json'))) return "config: update configuration";
    if (files.some(f => f.status === 'A')) return "feat: add new files";
    if (files.some(f => f.status === 'D')) return "chore: remove files";
    return "refactor: update code";
  }
}

async function createCommit(files: GitFileChange[], title: string): Promise<void> {
  const filePaths = files.map(f => f.path);
  
  // Reset staging area
  const resetProcess = Deno.run({
    cmd: ["git", "reset"],
    stdout: "piped",
    stderr: "piped",
  });
  await resetProcess.status();
  resetProcess.close();
  
  // Add only files for this commit
  const addProcess = Deno.run({
    cmd: ["git", "add", ...filePaths],
    stdout: "piped",
    stderr: "piped",
  });
  
  const addResult = await addProcess.status();
  if (!addResult.success) {
    const error = new TextDecoder().decode(await addProcess.stderrOutput());
    throw new Error(`Failed to add files: ${error}`);
  }
  addProcess.close();
  
  // Check if there are changes to commit
  const statusProcess = Deno.run({
    cmd: ["git", "diff", "--cached", "--quiet"],
    stdout: "piped",
    stderr: "piped",
  });
  
  const statusResult = await statusProcess.status();
  statusProcess.close();
  if (statusResult.success) {
    console.log(`⚠️ No changes to commit for: ${filePaths.join(', ')}`);
    return;
  }
  
  // Create commit
  const commitProcess = Deno.run({
    cmd: ["git", "commit", "-m", title],
    stdout: "piped",
    stderr: "piped",
  });
  
  const commitResult = await commitProcess.status();
  if (!commitResult.success) {
    const error = new TextDecoder().decode(await commitProcess.stderrOutput());
    throw new Error(`Failed to commit: ${error}`);
  }
  commitProcess.close();
  
  console.log(`✅ ${title}`);
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
      const group = groups[i];
      console.log(`\n📝 Commit ${i + 1}/${groups.length}:`);
      console.log(`   Files: ${group.map(f => f.path).join(', ')}`);
      
      const title = await generateCommitTitle(group);
      
      await createCommit(group, title);
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
