import { createLogger } from './logger';

/**
 * 目录句柄的持久化。
 *
 * `FileSystemDirectoryHandle` 是可结构化克隆的，能直接存进 IndexedDB——
 * 这是唯一能让「打开的文件夹」跨会话保留的办法：chrome.storage 只接受
 * JSON，句柄放进去会变成一个空对象。
 *
 * 存下来只是记住了「是哪个目录」，**不等于还有权限**。Chrome 在会话结束后
 * 会把授权降回 `prompt`，恢复时必须先 `queryPermission` 问一次，
 * 需要重新授权时还得由用户手势触发 `requestPermission`。
 */

const log = createLogger('handle-store');

const DB_NAME = 'md-reader-handles';
const DB_VERSION = 1;
const STORE = 'handles';
/** 当前工作区根目录的键 */
const ROOT_KEY = 'workspace-root';

/** 打开（或创建）数据库 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB 打开失败'));
    };
  });
}

/** 在一个事务里跑一段操作 */
async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB 操作失败'));
      };
    });
  } finally {
    db.close();
  }
}

/** 记住当前工作区的根目录 */
export async function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.put(handle, ROOT_KEY));
  } catch (error) {
    // 记不住只是下次要重新选一次，不该让「打开文件夹」这个动作失败
    log.warn('保存目录句柄失败', error);
  }
}

/** 取回上次的根目录句柄；没有或读取失败时返回 null */
export async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await withStore<unknown>('readonly', (store) => store.get(ROOT_KEY));
    // 存进去的可能是旧版本结构，用 kind 做一次实打实的校验
    if (handle && typeof handle === 'object' && 'kind' in handle) {
      const directory = handle as FileSystemDirectoryHandle;
      if (directory.kind === 'directory') return directory;
    }
    return null;
  } catch (error) {
    log.warn('读取目录句柄失败', error);
    return null;
  }
}

/** 忘掉记住的根目录 */
export async function clearRootHandle(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(ROOT_KEY));
  } catch (error) {
    log.warn('清除目录句柄失败', error);
  }
}

/** 恢复权限的结果 */
export type PermissionOutcome =
  /** 仍然有权限，可以直接用 */
  | 'granted'
  /** 需要用户手势重新授权 */
  | 'prompt'
  /** 已被拒绝 */
  | 'denied';

/**
 * 查询目录句柄当前的读权限。
 *
 * @param interactive 为 true 时会弹出授权提示，**必须在用户手势的调用栈内**
 */
export async function ensureReadPermission(
  handle: FileSystemDirectoryHandle,
  interactive: boolean,
): Promise<PermissionOutcome> {
  const descriptor = { mode: 'read' } as const;
  try {
    const current = await handle.queryPermission?.(descriptor);
    if (current === 'granted') return 'granted';
    if (!interactive) return current === 'denied' ? 'denied' : 'prompt';

    const next = await handle.requestPermission?.(descriptor);
    return next === 'granted' ? 'granted' : next === 'denied' ? 'denied' : 'prompt';
  } catch (error) {
    log.warn('查询目录权限失败', error);
    return 'denied';
  }
}
