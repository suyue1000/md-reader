/**
 * 通用函数工具。
 */

/** 带 cancel / flush 的防抖函数 */
export interface Debounced<TArgs extends readonly unknown[]> {
  (...args: TArgs): void;
  cancel(): void;
  flush(): void;
}

/**
 * 防抖：在最后一次调用后 `wait` 毫秒执行。
 * 用于设置写盘、滚动位置持久化等高频写场景。
 */
export function debounce<TArgs extends readonly unknown[]>(
  fn: (...args: TArgs) => void,
  wait: number,
): Debounced<TArgs> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: TArgs | null = null;

  const debounced = (...args: TArgs): void => {
    lastArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const argsToUse = lastArgs;
      lastArgs = null;
      if (argsToUse) fn(...argsToUse);
    }, wait);
  };

  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  debounced.flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const argsToUse = lastArgs;
    lastArgs = null;
    if (argsToUse) fn(...argsToUse);
  };

  return debounced;
}

/**
 * 节流：保证 `wait` 毫秒内最多执行一次，用于滚动监听等 60FPS 敏感路径。
 * 采用 leading + trailing 语义。
 */
export function throttle<TArgs extends readonly unknown[]>(
  fn: (...args: TArgs) => void,
  wait: number,
): Debounced<TArgs> {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: TArgs | null = null;

  const invoke = (args: TArgs): void => {
    lastCall = Date.now();
    fn(...args);
  };

  const throttled = (...args: TArgs): void => {
    const now = Date.now();
    const remaining = wait - (now - lastCall);
    lastArgs = args;
    if (remaining <= 0) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      invoke(args);
      lastArgs = null;
    } else if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        if (lastArgs) {
          invoke(lastArgs);
          lastArgs = null;
        }
      }, remaining);
    }
  };

  throttled.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  throttled.flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastArgs) {
      invoke(lastArgs);
      lastArgs = null;
    }
  };

  return throttled;
}

/** 生成短随机 id（非加密用途） */
export function createId(prefix = 'id'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

/** 判断是否为普通对象（用于深合并） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 深合并：以 `base` 为骨架，用 `patch` 覆盖。
 * 只递归普通对象，数组直接整体替换——设置项里没有需要合并的数组语义。
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T));
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) continue;
    const baseValue = result[key];
    result[key] = isPlainObject(baseValue) ? deepMerge(baseValue, patchValue) : patchValue;
  }
  return result as T;
}

/** 数值裁剪到区间内 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
