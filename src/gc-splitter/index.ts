import { query, type SDKMessage } from "@anthropic-ai/claude-code";

const messages: SDKMessage[] = [];

for await (const message of query({
  prompt: "ステージングされたファイルを適切な粒度でコミット分割し、git commit実行してください。コミットメッセージも適切な粒度で生成してください。",
  abortController: new AbortController(),
  options: {
    maxTurns: 1,
  },
})) {
  messages.push(message);
}

console.log(messages);