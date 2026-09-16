/**
 * 保存前版本的环形缓冲。
 *
 * 自动保存写的是用户磁盘上的真实文件，没有回收站——撤销栈也救不了
 * 「保存后关掉标签页才发现改错了」。每次写盘前留一份上一版，是这个功能
 * 唯一的后悔药。
 *
 * 只存在内存里，页面刷新即失。这是刻意的：把用户文档的历史副本悄悄写进
 * chrome.storage 或 IndexedDB，是一种没有被请求的数据留存——这个扩展
 * 「不联网、数据只在你自己机器上」的承诺不包括「悄悄多存一份你没要求
 * 保留的历史」，所以宁可缓冲随刷新丢失，也不做持久化。
 */
export interface VersionBuffer {
  push(content: string): void;
  /** 弹出最近一版；没有则返回 null */
  pop(): string | null;
  readonly size: number;
  clear(): void;
}

export function createVersionBuffer(capacity: number): VersionBuffer {
  const stack: string[] = [];

  return {
    push(content) {
      // 内容没变就不占一格：连续保存同一份内容会把有用的历史挤出去
      if (stack[stack.length - 1] === content) return;
      stack.push(content);
      if (stack.length > capacity) stack.shift();
    },

    pop() {
      return stack.pop() ?? null;
    },

    get size() {
      return stack.length;
    },

    clear() {
      stack.length = 0;
    },
  };
}
