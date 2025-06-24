import { assertEquals } from "@std/assert";

Deno.test("ccgit main module", async () => {
  // Import main module to ensure it can be loaded and get coverage
  const module = await import("./main.ts");
  // Test that module can be imported
  assertEquals(typeof module, "object");
});
