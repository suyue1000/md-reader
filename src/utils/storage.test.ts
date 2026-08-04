import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorageDriver } from './storage';

/**
 * 每个用例都重新 import 一次模块。
 *
 * 「上下文已失效」是模块级的一次性闩锁，跨用例共享会让先跑的用例
 * 决定后跑的用例的结果。
 */
async function freshStorage() {
  vi.resetModules();
  return import('./storage');
}

/** 造一个总是抛「上下文失效」的驱动 */
function brokenDriver(): StorageDriver {
  const fail = (): never => {
    throw new Error('Extension context invalidated.');
  };
  return {
    get: fail,
    set: fail,
    remove: fail,
    subscribe: () => () => undefined,
  };
}

/** 设定 chrome.runtime.id 是否存在 */
function setRuntimeId(id: string | undefined): void {
  const scope = globalThis as { chrome?: { runtime?: { id?: string } } };
  scope.chrome = id === undefined ? { runtime: {} } : { runtime: { id } };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('存储的上下文失效处理', () => {
  /**
   * 守的是一次真实事故的反面：降级到内存驱动是**不可逆**的，
   * 一旦切过去，这一页此后所有改动都不再落盘。仅凭一次异常就永久降级，
   * 等于让一次偶发抖动毁掉整页的持久化。
   */
  it('上下文仍正常时，一次失败不会永久降级', async () => {
    setRuntimeId('abc123');
    const storage = await freshStorage();

    storage.setStorageDriver(brokenDriver());
    expect(await storage.writeValue('local', 'k', 1)).toBe(false);
    expect(storage.isStorageUnavailable()).toBe(false);

    // 换回可用驱动后应当立刻恢复，而不是继续走内存
    const memory = storage.createMemoryStorageDriver();
    storage.setStorageDriver(memory);
    expect(await storage.writeValue('local', 'k', 2)).toBe(true);
    expect(await storage.readValue('local', 'k', 0)).toBe(2);
  });

  it('页面成为孤儿时降级到内存驱动', async () => {
    // chrome.runtime.id 消失是「扩展已重新加载」唯一可靠的判据
    setRuntimeId(undefined);
    const storage = await freshStorage();

    storage.setStorageDriver(brokenDriver());
    await storage.writeValue('local', 'k', 1);

    expect(storage.isStorageUnavailable()).toBe(true);
  });

  it('降级后本页仍能读写，只是不落盘', async () => {
    // 直接停掉会让用户在一个看起来正常的界面里发现所有操作都没反应
    setRuntimeId(undefined);
    const storage = await freshStorage();

    storage.setStorageDriver(brokenDriver());
    await storage.writeValue('local', 'k', 1);

    expect(await storage.writeValue('local', 'k', 42)).toBe(true);
    expect(await storage.readValue('local', 'k', 0)).toBe(42);
  });

  it('普通失败不会被误判为上下文失效', async () => {
    setRuntimeId('abc123');
    const storage = await freshStorage();

    storage.setStorageDriver({
      get: () => Promise.reject(new Error('QUOTA_BYTES_PER_ITEM quota exceeded')),
      set: () => Promise.reject(new Error('QUOTA_BYTES_PER_ITEM quota exceeded')),
      remove: () => Promise.resolve(),
      subscribe: () => () => undefined,
    });

    expect(await storage.writeValue('sync', 'k', 'x')).toBe(false);
    expect(storage.isStorageUnavailable()).toBe(false);
  });
});
