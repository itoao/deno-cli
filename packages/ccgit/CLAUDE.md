# ccgit - Claude Chat Git Integration

Claude CLIの実行と同時にGitでコード変更を自動管理するツール

## アーキテクチャ概要

```
┌──────────────┐     ┌───────────┐
│ ccgit (Deno) │──▶│  Claude   │───┐
└──────────────┘     │   CLI    │   │
        │            └───────────┘   │stdout / stderr
        │env / argv                  ▼
        ▼                       ┌──────────────┐
┌──────────────────────┐        │  Parser &    │
│ pre-/post hooks     │◀────────┤  Metadata    │
└──────────────────────┘        │  Extractor   │
        │ git add -A / commit   └─────┬────────┘
        ▼                             │
┌──────────────────────┐              ▼
│ Git repo (コード+log)│◀────────git commit
└──────────────────────┘
```

## 主要コンポーネント

### 1. ccgit CLIラッパー (main.ts)
- Claude CLIのすべてのコマンドを透過的にラップ
- 実行前: 現在の変更をstashまたはcommit
- 実行後: git add -A → commit でセッションを記録
- --resumeオプションもそのまま透過

### 2. メタデータ抽出器 (metadata.ts)
- Claude CLIの標準出力からセッションIDを抽出
- 例: "claude --resume abc123" のようなログから "abc123" を取得
- タイムスタンプ、プロンプト内容も記録

### 3. Git自動化エンジン (git.ts)
- コミットメッセージフォーマット:
  ```
  feat: Claude chat
  
  Session-ID: abc123
  Prompt: "ユーザープロンプト …"
  Time: 2025-06-20T17:12:52+09:00
  ```
- git trailers形式で後から検索可能

### 4. 履歴管理機能 (history.ts)
- `ccgit checkout abc123`: セッションIDでリポジトリを復元
- `ccgit start foo`: セッション別ブランチ作成 (claude/foo-<timestamp>)
- `--squash`: セッション終了時に履歴をまとめる

## 実装優先順位

1. **高優先度**
   - ccgit エントリーポイント実装
   - git自動化（stash → claude実行 → commit）
   - セッションID抽出とメタデータ埋め込み

2. **中優先度**
   - ccgit checkout（履歴復元）
   - ccgit start（ブランチ管理）

3. **低優先度**
   - --squashオプション
   - 詳細なテストとドキュメント

## 使用例

```bash
#（Claude CLIと同じ、対話モードになる）
ccgit
ccgit "TypeScriptの型エラーを修正して"

# セッションを再開（--resumeオプションを透過）
ccgit --resume abc123

# 過去のセッションに戻る（ccgit独自コマンド）
ccgit checkout abc123

# セッション別ブランチで作業（ccgit独自コマンド）
ccgit start feature-auth
```

## 動作モード

### 対話モード（デフォルト）
- `ccgit` を実行すると、Claude CLIの対話モードが起動
- ユーザーは複数の質問や指示を連続して実行可能
- 各応答の後に自動的にgit add -A → commit
- exitやCtrl+Cで終了


### 実行フロー
1. `ccgit` 実行
2. 現在の変更をstash（または初回commit）
3. Claude CLI起動（`claude` コマンド）
4. 対話モード開始
5. ユーザー入力 → Claude応答 → 自動commit（繰り返し）
6. 終了時に最終commit

## ディレクトリ構成

```
packages/ccgit/
├── main.ts          # エントリーポイント
├── git.ts           # Git操作ユーティリティ
├── metadata.ts      # メタデータ抽出
├── history.ts       # 履歴管理
├── types.ts         # 型定義
├── CLAUDE.md        # このファイル
└── deno.json        # 設定
```

## 実装メモ

- Denoのsubprocess APIを使用してClaude CLIを実行
- 標準出力/エラー出力をパイプして解析
- git操作は `jsr:@david/dax` を使用
- セッションIDは一意性を保つためUUID v4形式を想定