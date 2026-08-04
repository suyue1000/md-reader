import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite 构建配置。
 *
 * 设计要点：
 * 1. 不使用 CRXJS 之类的“魔法”插件——manifest.json 由 public/ 原样拷贝，
 *    产物路径完全可控、可预测，避免插件与 Vite 大版本升级时的兼容性风险。
 * 2. 多入口：三个扩展页面（viewer / popup / options）+ 一个 Service Worker。
 * 3. Service Worker 必须输出为固定文件名（background.js）且不能被拆包，
 *    因为 manifest 中的路径是静态字符串。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      /**
       * Shiki 把 Oniguruma（WASM）引擎写成了 `createHighlighter` 的默认参数。
       * 我们每次都显式传 JS 正则引擎，那个默认值永远不会被求值——但那行
       * `import('shiki/wasm')` 仍在代码里，打包器照样会产出一个 600KB 的分包，
       * 白白躺在扩展包里。换成一个会抛错的替身，既踢掉了体积，
       * 又保证真有代码绕过显式配置时能立刻发现。
       */
      'shiki/wasm': resolve(__dirname, 'src/markdown/shiki-wasm-stub.ts'),
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 扩展页面全部本地加载，sourcemap 便于调试，体积不敏感
    sourcemap: true,
    target: 'chrome116',
    /**
     * 提高「分包过大」的警告阈值。
     *
     * 超过 500KB 的都是第三方的**懒加载**负载：Shiki 的单个语言语法
     * （emacs-lisp、cpp、wolfram）、Mermaid 的图表引擎与 cytoscape 布局。
     * 它们各自独立成块，只有文档里真的出现对应语言或图表时才会被请求，
     * 完全不在首屏关键路径上——viewer 入口只有 84KB。
     * 默认阈值在这里给出的是误报，把它调到实际的量级，
     * 让警告重新变成「有东西不对」的信号。
     */
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        viewer: resolve(__dirname, 'viewer.html'),
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        // Service Worker 与 content script 需要稳定文件名
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? '[name].js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
