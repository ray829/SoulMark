import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 4. 拆分大型 vendor 库为独立 chunk:首屏主包瘦身 + 模块并行解析。
  //    仅拆"编辑器首屏同步链"必需的依赖(React 运行时 + Milkdown/ProseMirror/remark 解析栈),
  //    它们都是主包的同步 import,拆出后由主包同步 import 该 chunk(本地一次往返,可忽略)。
  //    shiki / katex / mermaid 的"按需动态 import"不在此函数返回名 → 保留 Vite 自动拆分,
  //    不会被并入这些 chunk(否则会把 shiki 语言 grammar 等又打回全量加载,毁掉按需优化)。
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // React 运行时:react / react-dom / scheduler
          if (
            id.includes("/react-dom/") ||
            id.includes("/scheduler/") ||
            id.includes("/react/")
          ) {
            return "react";
          }
          // 编辑器核心:ProseMirror + Milkdown + remark/micromark 解析栈(强关联,首屏同步)
          if (
            id.includes("/@milkdown/") ||
            id.includes("/prosemirror-") ||
            id.includes("/remark") ||
            id.includes("/micromark")
          ) {
            return "editor";
          }
          // 其余(shiki core、katex、mermaid、各 shiki 语言 grammar 等)→ undefined,
          // 保留 Vite 按需动态 import 的默认拆分。
          return undefined;
        },
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
