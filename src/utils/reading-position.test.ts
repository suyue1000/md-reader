import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearReadingPositions,
  computeRestoreTarget,
  findAnchorIndex,
  recallPosition,
  rememberPosition,
} from './reading-position';
import { createMemoryStorageDriver, setStorageDriver } from './storage';
import type { ReadingPosition } from '@/types';

/** 构造一条位置记录 */
function makePosition(documentId: string, updatedAt = Date.now()): ReadingPosition {
  return { documentId, ratio: 0.5, anchorId: 'h1', anchorOffset: 20, updatedAt };
}

describe('findAnchorIndex', () => {
  const offsets = [0, 100, 250, 900, 1500];

  it('返回最后一个不超过滚动位置的下标', () => {
    expect(findAnchorIndex(offsets, 260)).toBe(2);
    expect(findAnchorIndex(offsets, 900)).toBe(3);
    expect(findAnchorIndex(offsets, 99999)).toBe(4);
  });

  it('正好落在某个标题上时命中该标题', () => {
    expect(findAnchorIndex(offsets, 250)).toBe(2);
  });

  it('滚动位置在第一个标题之上时返回 -1', () => {
    expect(findAnchorIndex([100, 200], 50)).toBe(-1);
  });

  it('空数组返回 -1', () => {
    expect(findAnchorIndex([], 100)).toBe(-1);
  });

  it('与线性扫描的结果一致（随机对照）', () => {
    // 二分容易在边界上写错，用朴素实现做交叉验证
    const random = Array.from({ length: 200 }, (_, i) => i * 37);
    for (const probe of [0, 1, 36, 37, 3699, 7400, 99999]) {
      const linear = random.reduce((acc, offset, index) => (offset <= probe ? index : acc), -1);
      expect(findAnchorIndex(random, probe)).toBe(linear);
    }
  });
});

describe('computeRestoreTarget', () => {
  /** 三个标题的文档 */
  const anchors = { ids: ['intro', 'usage', 'api'], offsets: [0, 800, 1600] };

  it('锚点未移动时回到原位', () => {
    const position: ReadingPosition = {
      documentId: 'doc',
      ratio: 0.5,
      anchorId: 'usage',
      anchorOffset: 120,
      updatedAt: 0,
    };
    expect(computeRestoreTarget(position, anchors, 3000)).toBe(920);
  });

  it('锚点上方新增内容后跟着锚点走', () => {
    // 自动刷新最常见的情形：文档上方被追加了内容，所有锚点整体下移
    const position: ReadingPosition = {
      documentId: 'doc',
      ratio: 0.26,
      anchorId: 'usage',
      anchorOffset: 120,
      updatedAt: 0,
    };
    const shifted = { ids: ['intro', 'usage', 'api'], offsets: [0, 2000, 2800] };

    // 若按比例定位会落在 ~1100，只有按锚点才能回到用户原来读的那一段
    expect(computeRestoreTarget(position, shifted, 4200)).toBe(2120);
  });

  it('锚点上方内容被删除后同样跟随', () => {
    const position: ReadingPosition = {
      documentId: 'doc',
      ratio: 0.5,
      anchorId: 'api',
      anchorOffset: 50,
      updatedAt: 0,
    };
    const shrunk = { ids: ['intro', 'usage', 'api'], offsets: [0, 300, 700] };
    expect(computeRestoreTarget(position, shrunk, 2000)).toBe(750);
  });

  it('锚点已消失时回落到比例定位', () => {
    const position: ReadingPosition = {
      documentId: 'doc',
      ratio: 0.5,
      anchorId: 'removed-heading',
      anchorOffset: 120,
      updatedAt: 0,
    };
    expect(computeRestoreTarget(position, anchors, 3000)).toBe(1500);
  });

  it('保存时就在首个标题之上时按比例定位', () => {
    const position: ReadingPosition = {
      documentId: 'doc',
      ratio: 0.1,
      anchorId: null,
      anchorOffset: 0,
      updatedAt: 0,
    };
    expect(computeRestoreTarget(position, anchors, 2000)).toBe(200);
  });

  it('结果不会为负', () => {
    const position: ReadingPosition = {
      documentId: 'doc',
      ratio: 0.5,
      anchorId: 'intro',
      anchorOffset: -500,
      updatedAt: 0,
    };
    expect(computeRestoreTarget(position, anchors, 1000)).toBe(0);
  });

  it('文档变得不可滚动时回到顶部', () => {
    const position: ReadingPosition = {
      documentId: 'doc',
      ratio: 0.8,
      anchorId: null,
      anchorOffset: 0,
      updatedAt: 0,
    };
    expect(computeRestoreTarget(position, { ids: [], offsets: [] }, -10)).toBe(0);
  });
});

describe('阅读位置缓存', () => {
  beforeEach(() => {
    setStorageDriver(createMemoryStorageDriver());
    clearReadingPositions();
  });

  it('记录后可以读回', () => {
    rememberPosition(makePosition('doc:a'), false);
    expect(recallPosition('doc:a')?.anchorId).toBe('h1');
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
});
