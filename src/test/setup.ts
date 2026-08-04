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
