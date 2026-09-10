import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false, // integration tests share one database
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      { find: /^next\/server$/, replacement: path.resolve(__dirname, "node_modules/next/server.js") },
      { find: /^next\/headers$/, replacement: path.resolve(__dirname, "node_modules/next/headers.js") },
      { find: /^next\/cache$/, replacement: path.resolve(__dirname, "node_modules/next/cache.js") },
      { find: /^next\/navigation$/, replacement: path.resolve(__dirname, "node_modules/next/navigation.js") },
    ],
  },
});
