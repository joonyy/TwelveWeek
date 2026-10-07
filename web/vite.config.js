import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.TWELVE_WEB_PORT || 5178),
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${process.env.TWELVE_API_PORT || 4110}`,
      "/mcp": `http://127.0.0.1:${process.env.TWELVE_API_PORT || 4110}`,
      "/oauth": `http://127.0.0.1:${process.env.TWELVE_API_PORT || 4110}`,
      "/.well-known": `http://127.0.0.1:${process.env.TWELVE_API_PORT || 4110}`,
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
