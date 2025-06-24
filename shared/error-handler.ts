/**
 * 統一されたエラーハンドリングパターンを提供するモジュール
 */

export interface ErrorHandlerOptions {
  /** エラーメッセージのプレフィックス */
  prefix?: string;
  /** 詳細なエラー情報を表示するかどうか */
  verbose?: boolean;
  /** エラー発生時の終了コード */
  exitCode?: number;
  /** エラーログを出力するかどうか */
  logError?: boolean;
}

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "UNKNOWN_ERROR",
    public readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * 統一されたエラーハンドリング関数
 */
export function handleError(
  error: unknown,
  options: ErrorHandlerOptions = {},
): void {
  const {
    prefix = "❌ Error",
    verbose = false,
    exitCode = 1,
    logError = true,
  } = options;

  let message: string;
  let shouldExit = false;

  if (error instanceof AppError) {
    message = error.message;
    shouldExit = true;
  } else if (error instanceof Error) {
    message = verbose ? `${error.message}\n${error.stack}` : error.message;
  } else {
    message = String(error);
  }

  if (logError) {
    console.error(`${prefix}: ${message}`);
  }

  if (shouldExit) {
    Deno.exit(exitCode);
  }
}

/**
 * 非同期関数のエラーハンドリングを統一するラッパー
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  options: ErrorHandlerOptions = {},
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    handleError(error, options);
    return undefined;
  }
}

/**
 * 同期関数のエラーハンドリングを統一するラッパー
 */
export function withSyncErrorHandling<T>(
  fn: () => T,
  options: ErrorHandlerOptions = {},
): T | undefined {
  try {
    return fn();
  } catch (error) {
    handleError(error, options);
    return undefined;
  }
}

/**
 * Gitコマンド用の特殊なエラーハンドリング
 */
export function handleGitError(
  error: unknown,
  command: string,
  options: Partial<ErrorHandlerOptions> = {},
): void {
  const gitOptions: ErrorHandlerOptions = {
    prefix: `❌ Git command failed: ${command}`,
    ...options,
  };

  handleError(error, gitOptions);
}

/**
 * 警告メッセージを表示する関数
 */
export function warn(message: string, prefix = "⚠️"): void {
  console.warn(`${prefix} ${message}`);
}

/**
 * エラーを再スローする際の統一パターン
 */
export function rethrowError(
  error: unknown,
  context: string,
  code?: string,
): never {
  if (error instanceof Error) {
    throw new AppError(`${context}: ${error.message}`, code);
  }
  throw new AppError(`${context}: ${String(error)}`, code);
}
