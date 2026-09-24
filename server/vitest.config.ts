import { defineConfig } from "vitest/config";

// A new game builds the whole town (about 1.5 s alone). Under a busy machine that
// passed the default 5 s, and the test failed with no bug behind it.
export default defineConfig({
  test: { testTimeout: 20_000 },
});
