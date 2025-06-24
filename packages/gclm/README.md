# GCLM (Git Commit with LLM)

An intelligent CLI tool that analyzes staged git files and automatically creates logical commits with AI-generated commit messages using Claude AI.

## Features

- **🧠 AI-Powered Grouping**: Uses Claude AI to intelligently group staged files into logical commits
- **📝 Smart Commit Messages**: Generates meaningful commit titles following Conventional Commits format
- **⚡ Automatic Detection**: Automatically detects and analyzes staged git files
- **🔄 Fallback Strategy**: Falls back to rule-based grouping if AI analysis fails
- **📊 Verbose Mode**: Optional detailed logging for debugging and transparency

## Prerequisites

- [Deno](https://deno.land/) runtime
- Git repository
- Internet connection (for Claude API)
- Anthropic API key (via `ANTHROPIC_API_KEY` environment variable)

## Installation

### From JSR (Recommended)

```bash
# Install globally
deno install -g --allow-net --allow-env --allow-read --allow-run -n gclm jsr:@uchay/gclm
```

### From Source

```bash
# Clone and install locally
git clone <repository>
cd gclm
deno task install
```

## Usage

### Basic Usage

1. **Stage your files**:
   ```bash
   git add .
   # or stage specific files
   git add src/feature.ts tests/feature.test.ts
   ```

2. **Run GCLM**:
   ```bash
   gclm
   ```

### Command Line Options

```bash
gclm [options]

Options:
  -h, --help      Show help message
  -v, --version   Show version
  --verbose       Enable detailed output
```

### Example Session

```bash
$ git add src/auth.ts src/database.ts tests/auth.test.ts config/database.json
$ gclm --verbose

🔍 Analyzing staged files...
📁 Found 4 staged files
🧠 AI is analyzing files for logical grouping...
✅ AI analysis completed
📦 AI suggested 3 logical commits

📝 Commit 1/3:
   Files: config/database.json
📝 Generating commit title for 1 files...
✅ Title generated: "config: update database connection settings"

📝 Commit 2/3:
   Files: src/auth.ts, tests/auth.test.ts
📝 Generating commit title for 2 files...
✅ Title generated: "feat: implement user authentication system"

📝 Commit 3/3:
   Files: src/database.ts
📝 Generating commit title for 1 files...
✅ Title generated: "feat: add database connection utilities"

🎉 All commits created!
```

## How It Works

### 1. File Analysis
GCLM analyzes staged files using Claude AI to understand:
- File relationships and dependencies
- Logical groupings of changes
- Appropriate commit boundaries

### 2. Intelligent Grouping
The AI considers:
- **Related functionality** - Groups files that implement the same feature
- **Configuration separation** - Keeps config changes separate from code
- **Test relationships** - Groups tests with related code when appropriate
- **Documentation** - Handles docs separately unless directly related
- **Bug fixes vs features** - Separates different types of changes

### 3. Fallback Strategy
If AI analysis fails, GCLM uses rule-based categorization:
1. **Configuration files**: `.json`, `.yaml`, `.yml`, `.toml`
2. **Documentation**: `.md`, `README`, `doc` files
3. **Test files**: `.test.ts`, `.spec.ts`, test directories
4. **Build files**: Build configs and scripts
5. **Source code**: All other code files

### 4. Commit Message Generation
Each group gets an AI-generated commit message following:
- **Conventional Commits** format (`feat:`, `fix:`, `docs:`, etc.)
- **50 character limit** for commit titles
- **Descriptive and meaningful** messages based on actual changes

## Configuration

GCLM uses the `@deno-cli/shared` library for core git operations and includes built-in configuration:

```typescript
const CONFIG = {
  maxDiffPreviewLines: 5,      // Lines of diff shown to AI
  maxCommitTitleLength: 50,    // Maximum commit title length
  queryOptions: {
    maxTurns: 2                // AI conversation turns
  }
};
```

## Error Handling

### Common Issues

**"No staged files found"**
```bash
# Stage files first
git add <files>
gclm
```

**"Failed to get git diff --cached"**
- Ensure you're in a git repository
- Verify git is installed and accessible

**API Connection Issues**
- Check internet connection
- Verify `ANTHROPIC_API_KEY` environment variable is set
- Ensure API key has sufficient credits

## Development

### Setup
```bash
# Clone repository
git clone <repository>
cd gclm

# Run tests
deno task test

# Run with development permissions
deno task run
```

### Project Structure
```
gclm/
├── main.ts           # Main CLI application
├── main.test.ts      # Unit tests
├── deno.json         # Deno configuration
└── README.md         # This file
```

### Dependencies
- `jsr:@deno-cli/shared` - Shared utilities for git operations
- `npm:@anthropic-ai/claude-code` - Claude AI SDK
- `npm:ora` - Terminal spinners
- `node:util` - Argument parsing

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Changelog

### v0.0.3
- Current version with AI-powered file grouping
- Improved error handling and fallback strategies
- Added verbose mode for debugging

---

**Note**: This tool requires an Anthropic API key and makes API calls to Claude AI. Usage may incur costs based on your Anthropic plan.
