import { assertEquals } from "@std/assert";
import { logger, generateFallbackTitle, type GitFileChange } from "./index.ts";

Deno.test("shared module exports", () => {
  // Test that logger is defined
  assertEquals(typeof logger, "object");
  assertEquals(typeof logger.info, "function");
});

Deno.test("generateFallbackTitle function", () => {
  // Test fallback title generation with empty file list
  const files: GitFileChange[] = [];
  const title = generateFallbackTitle(files);
  assertEquals(typeof title, "string");
  assertEquals(title.length > 0, true);
});
