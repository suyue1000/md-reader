import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearReadingPositions,
  flushReadingPositions,
  hydrateReadingPositions,
  recallPosition,
  rememberPosition,
} from './reading-position';
import {
  STORAGE_AREAS,
  STORAGE_KEYS,
  createMemoryStorageDriver,
  setStorageDriver,
  writeValue,
} from './storage';
import type { ReadingPosition } from '@/types';

/** 构造一条位置记录 */
function makePosition(documentId: string, updatedAt = Date.now()): ReadingPosition {
  return { documentId, line: 42, offset: 8, updatedAt };
}

describe('阅读位置缓存', () => {
  beforeEach(() => {
    setStorageDriver(createMemoryStorageDriver());
    clearReadingPositions();
  });

  it('记录后可以读回', () => {
    rememberPosition(makePosition('doc:a'), false);
    expect(recallPosition('doc:a')?.line).toBe(42);
  });

  it('记录与读回行号', () => {
    rememberPosition({ documentId: 'doc:a', line: 42, offset: 8, updatedAt: Date.now() }, false);
    expect(recallPosition('doc:a')?.line).toBe(42);
  });

  it('未记录的文档返回 undefined', () => {
    expect(recallPosition('doc:missing')).toBeUndefined();
  });

  it('关闭持久化时仍然更新内存缓存', () => {
    // 自动刷新后要把用户放回原处，这与「跨会话恢复」是否开启无关
    rememberPosition(makePosition('doc:b'), false);
    expect(recallPosition('doc:b')).toBeDefined();
  });

  it('超过上限时淘汰最久未更新的记录', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 205; i++) {
      rememberPosition(makePosition(`doc:${String(i)}`, 1000 + i), false);
    }
    vi.useRealTimers();

    // 最早的 5 条应被淘汰，最新的仍在
    expect(recallPosition('doc:0')).toBeUndefined();
    expect(recallPosition('doc:4')).toBeUndefined();
    expect(recallPosition('doc:5')).toBeDefined();
    expect(recallPosition('doc:204')).toBeDefined();
  });

  it('清空后读不到任何记录', () => {
    rememberPosition(makePosition('doc:c'), false);
    clearReadingPositions();
    expect(recallPosition('doc:c')).toBeUndefined();
  });

  it('hydrate 后不覆盖本次会话中已经产生的更新', async () => {
    // 存储恢复只补空位，不能拿旧数据覆盖同一会话里更新过的记录
    rememberPosition({ documentId: 'doc:d', line: 5, offset: 0, updatedAt: Date.now() }, false);
    await hydrateReadingPositions();
    expect(recallPosition('doc:d')?.line).toBe(5);
  });

  it('flush 不抛出', () => {
    rememberPosition(makePosition('doc:e'), true);
    expect(() => flushReadingPositions()).not.toThrow();
  });
});

describe('旧版本遗留的存储记录', () => {
  beforeEach(() => {
    setStorageDriver(createMemoryStorageDriver());
    // 顺带把 hydrated 标志复位，否则第二个用例读不到自己写的数据
    clearReadingPositions();
  });

  it('丢弃缺少 line 字段的记录，而不是把 undefined 交出去', async () => {
    // 改造之前的结构：滚动比例 + 锚点，没有 line / offset
    const legacy = {
      'doc:old': { documentId: 'doc:old', ratio: 0.5, anchorId: 'x', anchorOffset: 12, updatedAt: 1 },
    };
    await writeValue(STORAGE_AREAS.readingPositions, STORAGE_KEYS.readingPositions, legacy);

    await hydrateReadingPositions();

    // 关键：不能返回一个 line 为 undefined 的对象——那会让 scrollToLine 收到 NaN
    expect(recallPosition('doc:old')).toBeUndefined();
  });

  it('结构正确的记录照常读回', async () => {
    await writeValue(STORAGE_AREAS.readingPositions, STORAGE_KEYS.readingPositions, {
      'doc:new': { documentId: 'doc:new', line: 42, offset: 8, updatedAt: 1 },
    });

    await hydrateReadingPositions();

    expect(recallPosition('doc:new')?.line).toBe(42);
  });
});
