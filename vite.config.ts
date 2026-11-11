import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ["**/data/**", "**/test-results/**", "**/.taste-skill/**"],
      usePolling: process.platform === "win32",
      interval: 1000,
    },
  },
  build: { target: "es2022", copyPublicDir: false },
});
