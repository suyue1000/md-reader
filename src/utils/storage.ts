import { hasChromeStorage } from './env';
import { createLogger } from './logger';

/**
 * chrome.storage 的类型安全封装。
 *
 * 为什么要分 sync / local 两个区：
 * - `chrome.storage.sync` 单条上限 8KB、总量 102KB，适合放主题、字号这类小配置，
 *   跨设备同步是用户预期。
 * - 自定义 CSS / JS、最近打开、收藏、阅读位置这类数据可能远超 8KB，
 *   写进 sync 会直接抛 QUOTA_BYTES_PER_ITEM 错误，必须放 `local`。
 * 因此对外暴露的 API 强制要求显式声明存储区，避免调用方随手写错。
 */

const log = createLogger('storage');

/** 存储区 */
export type StorageArea = 'sync' | 'local';

/**
 * 扩展上下文已经作废。
 *
 * 扩展被重新加载、更新或禁用后，之前打开的页面仍然活着，但它们持有的
 * `chrome.*` 全部失效。开发时每改一次代码重载扩展就会遇到，
 * 用户侧则在扩展自动更新后出现。
 */
class ExtensionContextGone extends Error {
  constructor() {
    super('扩展上下文已失效');
    this.name = 'ExtensionContextGone';
  }
}

/**
 * 判断一个错误是否意味着上下文作废。
 *
 * 作废有**两种表现**，两种都要认：
 * 1. 调用抛出 `Extension context invalidated`；
 * 2. `chrome.storage` 直接变成 `undefined`，于是取 `.local` 时抛 TypeError。
 *
 * 一开始只按第一种的错误文本判断，结果第二种漏了过去，
 * 在控制台里表现为 `Cannot read properties of undefined (reading 'local')`。
 * 所以改成在驱动入口显式探测，而不是事后猜错误消息。
 *
 * 这类失败**不是故障**：页面已经是个孤儿，正确的反应是安静降级，
 * 而不是每 400ms 保存一次阅读位置就往控制台喷一条红色错误。
 */
function isContextInvalidated(error: unknown): boolean {
  if (error instanceof ExtensionContextGone) return true;
  return error instanceof Error && error.message.includes('Extension context invalidated');
}

/**
 * 上下文已失效。
 *
 * 一旦确认就换成内存驱动并记住，不再反复尝试真实存储——
 * 这个页面不可能再恢复，继续试只会让阅读位置每 400ms 抛一次异常。
 */
let contextDead = false;

/** 当前上下文的存储通道是否已经作废 */
export function isStorageUnavailable(): boolean {
  return contextDead;
}

/**
 * 记录一次存储失败；上下文失效走降级路径。
 *
 * 降级不是「什么都不做」，而是**换成内存驱动**：这一页仍然能改设置、
 * 记住滚动位置，只是关掉页面后不留痕迹。直接停掉会让用户在一个
 * 看起来正常的界面里发现所有操作都没反应，那更难理解。
 */
function reportStorageFailure(action: string, error: unknown): void {
  if (!isContextInvalidated(error)) {
    log.error(`${action}失败`, error);
    return;
  }

  // 确认是真的成了孤儿，而不是一次偶发失败。降级是**不可逆**的：
  // 一旦切到内存驱动，这一页此后所有改动都不再落盘。
  // 仅凭一次异常就永久降级，等于让一次抖动毁掉整页的持久化
  if (!isOrphaned()) {
    log.error(`${action}失败（上下文仍正常，将在下次调用时重试）`, error);
    return;
  }

  if (contextDead) return;
  contextDead = true;
  driver = new MemoryStorageDriver();
  // 序列化进消息本身：chrome://extensions 的错误列表会把对象参数
  // 拍成 [object Object]，单独传对象在那儿是看不到内容的
  log.warn(`扩展存储不可用，本页改动将不再保存，刷新即可恢复。${describeExtensionContext()}`);
}

/**
 * 当前页面是否已经与扩展脱钩。
 *
 * 判据是 `chrome.runtime.id` ——扩展被重新加载后，旧页面里的它会消失。
 * 这是「孤儿页面」与「偶发失败」之间唯一可靠的分界。
 */
function isOrphaned(): boolean {
  const api = (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome;
  return typeof api?.runtime?.id !== 'string';
}

/**
 * 描述当前上下文里扩展 API 的实际状态。
 *
 * 「存储不可用」有好几种成因，光看错误消息分不清是哪一种：
 * 扩展被重新加载（`chrome` 还在但 API 全废）、页面根本不是扩展上下文、
 * 或者某个 API 在嵌入场景下被限制。把真实状态打出来，
 * 一眼就能定位，不必靠猜。
 */
function describeExtensionContext(): string {
  const api = (globalThis as { chrome?: Record<string, unknown> }).chrome;
  const runtime = api?.['runtime'] as { id?: string } | undefined;
  const storage = api?.['storage'] as Record<string, unknown> | undefined;

  return JSON.stringify({
    hasChrome: api !== undefined,
    chromeKeys: api ? Object.keys(api).slice(0, 12) : [],
    runtimeId: runtime?.id ?? null,
    hasStorage: storage !== undefined,
    storageKeys: storage ? Object.keys(storage) : [],
    embedded: typeof window !== 'undefined' && window.top !== window.self,
  });
}

/** 存储变更回调 */
export type StorageChangeListener = (
  changes: Readonly<Record<string, unknown>>,
  area: StorageArea,
) => void;

/** 存储驱动接口，便于在测试与非扩展环境下替换实现 */
export interface StorageDriver {
  get(area: StorageArea, keys: readonly string[]): Promise<Record<string, unknown>>;
  set(area: StorageArea, items: Record<string, unknown>): Promise<void>;
  remove(area: StorageArea, keys: readonly string[]): Promise<void>;
  subscribe(listener: StorageChangeListener): () => void;
}

/** 基于 chrome.storage 的真实驱动 */
class ChromeStorageDriver implements StorageDriver {
  /**
   * 取得存储区，顺带确认上下文还活着。
   *
   * 每次都重新取而不是在构造时缓存：扩展重载后 `chrome.storage` 会变成
   * `undefined`，缓存下来的引用只会让调用点抛出一个看不出所以然的 TypeError。
   */
  private static areaOf(area: StorageArea): chrome.storage.StorageArea {
    const storage = chrome.storage as typeof chrome.storage | undefined;
    const target = storage?.[area];
    if (!target) throw new ExtensionContextGone();
    return target;
  }

  /** 读取指定 key */
  async get(area: StorageArea, keys: readonly string[]): Promise<Record<string, unknown>> {
    return await ChromeStorageDriver.areaOf(area).get([...keys]);
  }

  /** 写入 */
  async set(area: StorageArea, items: Record<string, unknown>): Promise<void> {
    await ChromeStorageDriver.areaOf(area).set(items);
  }

  /** 删除 */
  async remove(area: StorageArea, keys: readonly string[]): Promise<void> {
    await ChromeStorageDriver.areaOf(area).remove([...keys]);
  }

  /** 订阅跨上下文（popup / options / viewer）的变更 */
  subscribe(listener: StorageChangeListener): () => void {
    const handler = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName !== 'sync' && areaName !== 'local') return;
      const mapped: Record<string, unknown> = {};
      for (const [key, change] of Object.entries(changes)) {
        mapped[key] = change.newValue;
      }
      listener(mapped, areaName);
    };
    // 上下文可能已经作废，此时 chrome.storage 整个是 undefined
    const changed = (chrome.storage as typeof chrome.storage | undefined)?.onChanged;
    if (!changed) return () => undefined;

    changed.addListener(handler);
    return () => {
      changed.removeListener(handler);
    };
  }
}

/**
 * 内存驱动：单元测试与「在普通页面里预览扩展 UI」时使用。
 * 行为与 chrome.storage 一致（含变更广播），保证同一套业务代码两边都能跑。
 */
class MemoryStorageDriver implements StorageDriver {
  private readonly data: Record<StorageArea, Map<string, unknown>> = {
    sync: new Map(),
    local: new Map(),
  };
  private readonly listeners = new Set<StorageChangeListener>();

  /** 读取指定 key */
  get(area: StorageArea, keys: readonly string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (this.data[area].has(key)) result[key] = this.data[area].get(key);
    }
    return Promise.resolve(result);
  }

  /** 写入并广播 */
  set(area: StorageArea, items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.data[area].set(key, value);
    this.emit(items, area);
    return Promise.resolve();
  }

  /** 删除并广播 */
  remove(area: StorageArea, keys: readonly string[]): Promise<void> {
    const changes: Record<string, unknown> = {};
    for (const key of keys) {
      this.data[area].delete(key);
      changes[key] = undefined;
    }
    this.emit(changes, area);
    return Promise.resolve();
  }

  /** 订阅变更 */
  subscribe(listener: StorageChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 广播变更给所有订阅者 */
  private emit(changes: Record<string, unknown>, area: StorageArea): void {
    for (const listener of this.listeners) listener(changes, area);
  }

  /** 测试辅助：清空全部数据 */
  reset(): void {
    this.data.sync.clear();
    this.data.local.clear();
  }
}

let driver: StorageDriver = hasChromeStorage()
  ? new ChromeStorageDriver()
  : new MemoryStorageDriver();

/** 覆盖存储驱动（仅供测试使用） */
export function setStorageDriver(next: StorageDriver): void {
  driver = next;
}

/** 创建一份全新的内存驱动，供测试隔离用 */
export function createMemoryStorageDriver(): StorageDriver {
  return new MemoryStorageDriver();
}

/**
 * 读取单个 key，失败时返回 fallback 而不是抛错。
 * 存储读取失败（配额、损坏）不应该让整个阅读器打不开。
 */
export async function readValue<T>(
  area: StorageArea,
  key: string,
  fallback: T,
): Promise<T> {
  try {
    const record = await driver.get(area, [key]);
    const value = record[key];
    return value === undefined ? fallback : (value as T);
  } catch (error) {
    reportStorageFailure(`读取 ${area}.${key}`, error);
    return fallback;
  }
}

/** 写入单个 key；写失败时返回 false，由调用方决定是否提示用户 */
export async function writeValue(
  area: StorageArea,
  key: string,
  value: unknown,
): Promise<boolean> {
  try {
    await driver.set(area, { [key]: value });
    return true;
  } catch (error) {
    reportStorageFailure(`写入 ${area}.${key}`, error);
    return false;
  }
}

/** 删除若干 key */
export async function removeValues(area: StorageArea, keys: readonly string[]): Promise<void> {
  try {
    await driver.remove(area, keys);
  } catch (error) {
    reportStorageFailure(`删除 ${area}.${keys.join(',')}`, error);
  }
}

/** 订阅存储变更，返回取消订阅函数 */
export function subscribeStorage(listener: StorageChangeListener): () => void {
  return driver.subscribe(listener);
}

/** 全局存储 key 常量，集中管理避免拼写漂移 */
export const STORAGE_KEYS = {
  /** 可跨设备同步的设置（外观 / Markdown / 阅读） */
  settings: 'settings',
  /** 高级设置：自定义 CSS / JS，体积可能超过 sync 单条上限，放 local */
  advanced: 'advanced',
  /** 最近打开 */
  recentFiles: 'recentFiles',
  /** 收藏 */
  favorites: 'favorites',
  /** 阅读位置表 */
  readingPositions: 'readingPositions',
  /** UI 布局状态（侧栏宽度、是否折叠） */
  layout: 'layout',
  /**
   * 工作区变更信号（一个递增的时间戳）。
   *
   * 目录句柄本身存在 IndexedDB 里，而 IndexedDB 没有跨页面的变更通知。
   * 用 chrome.storage 打一个招呼：任何页面选完文件夹就写一次，
   * 其它扩展页面（包括嵌在 .md 页面里的阅读器）据此重新恢复工作区。
   */
  workspaceSignal: 'workspaceSignal',
} as const;

/** 每个 key 归属的存储区 */
export const STORAGE_AREAS: Record<keyof typeof STORAGE_KEYS, StorageArea> = {
  settings: 'sync',
  advanced: 'local',
  recentFiles: 'local',
  favorites: 'local',
  readingPositions: 'local',
  layout: 'sync',
  workspaceSignal: 'local',
};
