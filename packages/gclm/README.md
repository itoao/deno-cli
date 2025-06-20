# Git Commit With LLM CLI

ステージングされたファイルを適切なコミット粒度に自動分割し、Claude AIが生成したタイトルでコミットを作成するCLIツールです。

## 機能

- **自動ファイル検出**: ステージングされたファイルを自動で検出
- **コミットの分割**: Claude Code SDKを使用して適切な粒度でコミットを分割
- **AI生成タイトル**: Claude Code SDKを使用して適切なコミットタイトルを自動生成
- **Conventional Commits**: `feat:`, `fix:`, `docs:`などの標準的なフォーマットに対応

## 必要な環境

- Deno
- Git
- インターネット接続 (Claude API使用のため)

## 使用方法

### 1. ファイルをステージング

```bash
# 特定のファイルをステージング
git add src/index.ts

# または全てのファイルをステージング
git add .
```

### 2. CLIを実行

```bash
deno task run
```

### 実行例

```bash
$ git add src/index.ts config/database.json tests/user.test.ts
$ deno task run

🔍 Analyzing staged files...
📁 Found 3 staged files
📦 Split into 3 commit groups

🤔 Generating commit title for group 1...
📝 Title: config: update database connection settings
✅ Committed: config: update database connection settings

🤔 Generating commit title for group 2...
📝 Title: test: add user authentication tests
✅ Committed: test: add user authentication tests

🤔 Generating commit title for group 3...
📝 Title: feat: implement user profile management
✅ Committed: feat: implement user profile management

🎉 All commits created successfully!
```

## コミット分割ロジック

ファイルは以下の優先順位でグループ化されます：

1. **設定ファイル**: `config`, `.json`, `.yaml`, `.yml`, `.toml`
2. **テストファイル**: `test`, `spec`, `.test.ts`, `.spec.ts`
3. **ドキュメント**: `.md`, `doc`, `readme`
4. **ソースコード**: `.ts`, `.js`, `.tsx`, `.jsx`
5. **その他**: 上記に該当しないファイル

## 注意事項

- ステージングされたファイルがない場合は実行されません
- Claude APIの利用にはインターネット接続が必要です
- 生成されるコミットタイトルは最大50文字に制限されています
- エラーが発生した場合、プロセスは中断されます

## エラー対処

### "No staged files found"
```bash
# ファイルをステージングしてから実行してください
git add <ファイル名>
deno task run
```

### "Failed to get git diff --cached"
- Git リポジトリ内で実行されているか確認してください
- Git がインストールされているか確認してください

## 開発

```bash
# 依存関係の更新
deno cache --reload src/index.ts

# デバッグ実行
deno run --allow-net --allow-env --allow-read --allow-run src/index.ts
```