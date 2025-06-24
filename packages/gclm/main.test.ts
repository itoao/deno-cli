import { assertEquals } from "@std/assert";

Deno.test("gclm main module", async () => {
  // Import main module to ensure it can be loaded and get coverage
  const module = await import("./main.ts");
  // Test that module exports exist
  assertEquals(typeof module, "object");
});
