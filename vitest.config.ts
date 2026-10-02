import { defineConfig } from "vitest/config";

// Unit tests for the pure / server-side helpers. Kept apart from vite.config.ts
// so the React Router plugin is not loaded for tests.
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
  },
});
