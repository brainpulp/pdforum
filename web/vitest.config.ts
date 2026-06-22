import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../supabase/functions/_shared"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
  },
});
