/**
 * `shiki/wasm` 的替身。
 *
 * Shiki 的 `createHighlighter` 把 Oniguruma（WASM）引擎写成了默认参数：
 * `engine = createOnigurumaEngine(import('shiki/wasm'))`。我们每次都显式传入
 * JS 正则引擎，那个默认值永远不会被求值——但那行 `import()` 仍在代码里，
 * 打包器照样会为它产出一个 600KB 的分包，白白躺在扩展包里。
 *
 * 用别名把它换成这个替身（见 vite.config.ts）。真的有人走到这条路上时
 * 会立刻抛错，而不是悄悄退化成一个不工作的引擎——MV3 的 CSP
 * （`script-src 'self'`）本来也不允许实例化 WASM。
 */

/** 被调用即说明有代码绕过了显式引擎配置 */
function refuse(): never {
  throw new Error(
    'Shiki 的 WASM 引擎在 MV3 的 CSP 下不可用，请确认 createHighlighter 传入了 JS 正则引擎',
  );
}

export default refuse;
export const loadWasm = refuse;
export const getDefaultWasmLoader = refuse;
