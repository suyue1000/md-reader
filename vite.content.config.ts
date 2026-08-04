import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * 内容脚本的独立构建。
 *
 * 单独一份配置，是因为它的输出格式与其他入口**不能相同**：
 * MV3 的 `content_scripts` 只接受普通脚本，不支持 ES 模块
 * （没有 `"type": "module"` 这个选项），而 Vite 的输出格式是整份
 * 配置级别的开关，没法只对一个入口改。
 *
 * `emptyOutDir: false` 是关键——主构建先跑并清空 dist，这一步只往里补文件。
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    target: 'chrome116',
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      formats: ['iife'],
      // manifest 里写的是静态路径，文件名必须固定
      name: 'MdReaderContent',
      fileName: () => 'content.js',
    },
  },
});
