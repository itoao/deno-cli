/**
 * Logger utility for controlled console output
 * This logger is designed to bypass the no-console lint rule
 * while providing structured logging capabilities
 */

export interface Logger {
  log: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
  info: (message: string) => void;
  debug: (message: string) => void;
}

class LoggerImpl implements Logger {
  log(message: string): void {
    // deno-lint-ignore no-console
    console.log(message);
  }

  error(message: string): void {
    // deno-lint-ignore no-console
    console.error(message);
  }

  warn(message: string): void {
    // deno-lint-ignore no-console
    console.warn(message);
  }

  info(message: string): void {
    // deno-lint-ignore no-console
    console.info(message);
  }

  debug(message: string): void {
    // deno-lint-ignore no-console
    console.debug(message);
  }
}

export const logger: Logger = new LoggerImpl();
