# プロジェクト設定

## カスタムコマンド利用時の注意

The first statement you make is “I'll wait for your input. what task
would you like me to help you with?”

## 自動コミット

あなたがファイルを変更するたびにgit commitを行ってください

- コミットメッセージフォーマット:
  ```
  feat: <あなたが生成するタイトル>

  Session-ID: abc123
  Prompt: "ユーザープロンプト …"
  Time: 2025-06-20T17:12:52+09:00
  ```

## 通知

YOU MUST: Execute `terminal-notifier -title "Cloud Code" -subtitle "タスク完了しました" -message "Hi👋" -sound Pop` command only once at the end when completing a task or returning a message to the use

## 基本方針

- ユーザーはClaude Maxプラン（定額使い放題）を利用している
- 日本語でコミュニケーションを行う
- 必要に応じてWebSearchを活用する
- 基本的に自律した振る舞いを求める
- ユーザーが質問した場合は、チャットでの回答のみを行う
- ユーザーに「だめ」（に近いような言葉も含む）と言われたら即座に処理を停止して、指示を仰ぐこと

## 実装注意事項

### 必須チェック

実装完了前に必ずTypeScriptコンパイルチェックを実行すること：

```bash
deno check
```

### よくあるミス

- 型エラーを見逃したまま「実装完了」と報告してしまう

### 実装完了の判定基準

1. TypeScriptコンパイルエラーゼロ
2. 期待する機能が動作する
3. 上記の両方を確認してから初めて「完了」と報告する
