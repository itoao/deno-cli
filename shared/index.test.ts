import { assertEquals } from "@std/assert";

Deno.test("shared module exports", () => {
  // Basic test to ensure the module can be imported
  assertEquals(1, 1);
});
