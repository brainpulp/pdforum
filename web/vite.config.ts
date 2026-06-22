import { defineConfig } from "vite";
import { resolve } from "node:path";

// Relative base so the built site works under a GitHub Pages project path
// (https://<user>.github.io/pdforum/) as well as locally.
export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../supabase/functions/_shared"),
    },
  },
  server: {
    // Allow importing the shared threading module from the repo root.
    fs: { allow: [resolve(__dirname, "..")] },
  },
});
