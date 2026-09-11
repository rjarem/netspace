import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/colyseus": {
        target: "ws://localhost:2567",
        ws: true,
        rewrite: (p) => p.replace(/^\/colyseus/, ""),
      },
    },
  },
  build: { outDir: "dist" },
});