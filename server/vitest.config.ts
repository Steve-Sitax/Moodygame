import { configDefaults, defineConfig } from "vitest/config";

// Tests that time real sockets, real processes or a request rate on the wall clock (issues #4, #9): with ~90 other
// files loading the machine at once their timings slipped (a rate bucket refilled while 150 calls were still being
// served; a TLS handshake or a taskkill took seconds). They run after the rest, one file at a time, on a quiet
// machine; their assertions stay as they are.
const TIMED = ["test/m8e-limits.test.ts", "test/m8e-tls.test.ts", "test/router.test.ts"];

// A new game builds the whole town (about 1.5 s alone). Under a busy machine that
// passed the default 5 s, and the test failed with no bug behind it. With the whole suite in parallel and a build
// beside it, tests that build several towns took 13-21 s (m4 "the templates all plan": 7 s alone, 21 s so): the
// limit only catches a hang, so it is 60 s.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    projects: [
      { extends: true, test: { name: "server", exclude: [...configDefaults.exclude, ...TIMED], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: "timed", include: TIMED, fileParallelism: false, sequence: { groupOrder: 1 } } },
    ],
  },
});
