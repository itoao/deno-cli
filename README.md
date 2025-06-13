# AI Git Commit Splitter

ステージングされたファイルをAIが分析し、論理的なコミット単位に自動分割してコミットを作成するCLIツールです。

## 特徴

- **🧠 AI分析**: Claude AIがファイルの変更内容を分析し、論理的なコミットグループを提案
- **📝 自動タイトル生成**: 各コミットに対してConventional Commitsフォーマットの適切なタイトルを生成
- **🔍 コンテキスト理解**: diffの内容を分析して関連する変更をグループ化
- **⚡ シンプル操作**: `git add` → `deno task run` の2ステップで完了

## インストール・セットアップ

### 必要な環境
- Deno
- Git
- インターネット接続（Claude API使用）

### 使用方法

1. **ファイルをステージング**
   ```bash
   git add .
   # または特定のファイルを指定
   git add src/feature.ts config/settings.json
   ```

2. **CLIを実行**
   ```bash
   deno task run
   ```

## 実行例

```bash
$ git add src/user.ts src/auth.ts config/database.json README.md
$ deno task run

🔍 Analyzing staged files...
📁 Found 4 staged files
🧠 Using AI to group files into logical commits...
📦 AI suggested 3 logical commits

📝 Commit 1/3:
   Files: src/user.ts, src/auth.ts
✅ feat: add user authentication system

📝 Commit 2/3:
   Files: config/database.json
✅ config: update database connection settings

📝 Commit 3/3:
   Files: README.md
✅ docs: update user authentication guide

🎉 All commits created!
```

## AI分析のルール

AIは以下のルールに基づいてファイルをグループ化します：

### グループ化の基準
1. **関連機能**: 同じ機能に関連するファイルをまとめる
2. **設定分離**: 設定ファイルはコード変更から分離
3. **テスト戦略**: テストは関連コードと一緒、または複数機能のテストは分離
4. **ドキュメント**: 特定機能に直接関連しない限り分離
5. **変更タイプ**: バグ修正と新機能を分離
6. **適切な粒度**: 細かすぎるコミットを避け、関連する変更を統合

### タイトル生成ルール
- Conventional Commitフォーマット（`type: description`）
- 最大50文字
- 具体的で分かりやすい説明
- 対応するタイプ：`feat`, `fix`, `docs`, `refactor`, `test`, `config`, `chore`

## エラー処理

### AI分析が失敗した場合
```bash
⚠️ LLM grouping failed, using simple fallback
```
→ シンプルなファイルタイプ別グループ化にフォールバック

### タイトル生成が失敗した場合
```bash
⚠️ Failed to generate title, using fallback
```
→ ファイルタイプと変更ステータスに基づくフォールバックタイトルを使用

### よくあるエラー

**「No staged files found」**
```bash
❌ No staged files found. Use 'git add' first.
```
→ `git add` でファイルをステージングしてから実行

**「Failed to commit」**
- pre-commitフックが失敗している可能性
- コミットメッセージの形式が無効
- マージコンフリクト等のGitエラー

## 高度な使用例

### 大きな機能開発
```bash
# 複数のファイルを含む大きな変更
git add src/api/ src/models/ src/utils/ config/ tests/ docs/
deno task run
# → AIが機能別、層別に適切に分割
```

### 設定とコードの混在
```bash
# 設定変更とコード変更が混在
git add .env.example config/app.json src/config.ts src/main.ts
deno task run
# → 設定ファイルとコード変更を自動で分離
```

## 技術仕様

- **言語**: TypeScript (Deno)
- **AI**: Claude API (@anthropic-ai/claude-code)
- **Git操作**: Deno.Command APIを使用
- **エラーハンドリング**: 多段階フォールバック

## 開発

```bash
# 直接実行
deno run --allow-net --allow-env --allow-read --allow-run src/gclm/index.ts

# 依存関係の更新
deno cache --reload src/gclm/index.ts
```

## 注意事項

- Claude APIの利用にはインターネット接続が必要
- 大量のファイル変更時はAPI利用料金が発生する可能性
- プライベートな情報を含むdiffがAPIに送信されるため、機密プロジェクトでは注意
- ステージングエリアは各コミット作成時にリセットされます