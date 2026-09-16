/**
 * Vitest 全局初始化。
 *
 * 这里补的都是 jsdom 缺失的浏览器能力，集中放在一处，
 * 避免每个测试文件各自 mock 出不一致的替身。
 */

/**
 * jsdom 没有实现 `Blob.prototype.text()`（File 继承自 Blob），
 * 而文件读取路径依赖它。用 FileReader 补一个等价实现。
 */
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function readAsText(this: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      // readAsText 的结果一定是 string，但类型上是 string | ArrayBuffer | null
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('读取 Blob 失败'));
      reader.readAsText(this);
    });
  };
}
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}

/**
 * jsdom 没有实现 `ResizeObserver`。
 *
 * 目录滚动同步用它感知「上方内容因为块渲染/代码上色变高了」——jsdom 里
 * 本来也没有真实布局，观察不到任何变化，所以补一个不回调的空壳就够：
 * 它的存在只是为了让挂载了该 hook 的组件不至于在测试里直接抛
 * `ResizeObserver is not defined`。CodeMirror 自己也用 ResizeObserver，
 * 不过它内部做了存在性判断，不依赖这个替身。
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserverStub implements ResizeObserver {
    observe(): void {
      // 没有布局，也就没有尺寸变化可报
    }
    unobserve(): void {
      // 同上
    }
    disconnect(): void {
      // 同上
    }
  };
}

/**
 * jsdom 没有实现 `CSS.escape`。
 *
 * 目录面板用它把标题 id 拼进属性选择器（中文标题、带标点的标题都要转义），
 * 缺了它组件一挂载就抛 `Cannot read properties of undefined`。
 *
 * 这里不追求与规范逐字一致：把「肯定安全」的字符（字母、数字、`-`、`_`
 * 以及非 ASCII）之外的一律加反斜杠。CSS 允许过度转义，所以这个更保守的
 * 版本对属性选择器是等效的。
 */
if (typeof globalThis.CSS === 'undefined') {
  globalThis.CSS = {
    escape: (value: string): string =>
      String(value).replace(/[^\w\-\u0080-\uffff]/g, (char) => `\\${char}`),
  } as typeof globalThis.CSS;
}

/**
 * jsdom 没有实现 `Range.prototype.getClientRects`。
 *
 * CodeMirror 在文档变化后会量一次字体尺寸（`DocView.measureTextSize`），
 * 那条路径直接调 `textRange(...).getClientRects()`。缺了它不会让某条用例变红，
 * 而是在 rAF 回调里抛一个**未捕获异常**——Vitest 把它记成 unhandled error，
 * 整次运行以非零码退出，但失败列表是空的，看上去像是随机挂掉。
 *
 * 只有真的 `dispatch` 过文档改动的用例才会触发（渲染出来就不动的不会），
 * 所以补在这里而不是让每个碰到它的用例各打一次补丁。
 * 返回空列表是安全的：jsdom 本来就没有布局，CodeMirror 对量不到尺寸有兜底。
 */
if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = function getClientRects(this: Range): DOMRectList {
    const list = [] as unknown as DOMRectList;
    return list;
  };
}
