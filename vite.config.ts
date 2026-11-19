import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Set by `tauri android dev` / `tauri ios dev` so the phone can reach Vite.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
  },
  build: {
    target: "es2021",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        miniplayer: resolve(__dirname, "miniplayer.html"),
      },
    },
  },
});
