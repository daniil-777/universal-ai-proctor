import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, process.cwd(), "VITE_").VITE_BASE_PATH || "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 8180,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8101", changeOrigin: false } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
        },
      },
    },
  },
}));
