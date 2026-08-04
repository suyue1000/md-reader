import type { ReadingPosition } from '@/types';
import { debounce } from './fn';
import { STORAGE_AREAS, STORAGE_KEYS, readValue, writeValue } from './storage';

/**
 * 阅读位置的内存缓存 + 持久化。
 *
 * 为什么内存与存储要分开：
 * - **内存缓存始终维护**。自动刷新后必须把用户放回原处，这与「是否开启
 *   跨会话恢复」无关——哪怕用户关掉了恢复功能，刷新时跳回顶部也是 bug。
 * - **持久化受设置控制**。跨会话恢复是用户可以关掉的偏好。
 */

/** 最多保留多少条记录，超出后淘汰最久未更新的 */
const MAX_ENTRIES = 200;

/** documentId -> 位置 */
const cache = new Map<string, ReadingPosition>();

/** 是否已从存储恢复过 */
let hydrated = false;

/** 写盘（防抖）——滚动时高频触发，不能每次都写 */
const persist = debounce(() => {
  const record: Record<string, ReadingPosition> = {};
  for (const [id, position] of cache) record[id] = position;
  void writeValue(STORAGE_AREAS.readingPositions, STORAGE_KEYS.readingPositions, record);
}, 800);

/** 淘汰最久未更新的记录，避免存储无限增长 */
function prune(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const excess = cache.size - MAX_ENTRIES;
  for (let i = 0; i < excess; i++) {
    const entry = sorted[i];
    if (entry) cache.delete(entry[0]);
  }
}

/** 从存储恢复全部记录（幂等，首次调用时才真正读盘） */
export async function hydrateReadingPositions(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const stored = await readValue<Record<string, ReadingPosition>>(
    STORAGE_AREAS.readingPositions,
    STORAGE_KEYS.readingPositions,
    {},
  );
  for (const [id, position] of Object.entries(stored)) {
    // 存储里的记录不覆盖本次会话中已经产生的更新
    if (!cache.has(id)) cache.set(id, position);
  }
}

/**
 * 记录位置。
 *
 * @param position 新位置
 * @param shouldPersist 是否写盘；false 时只更新内存缓存
 */
export function rememberPosition(position: ReadingPosition, shouldPersist: boolean): void {
  cache.set(position.documentId, position);
  prune();
  if (shouldPersist) persist();
}

/** 读取位置 */
export function recallPosition(documentId: string): ReadingPosition | undefined {
  return cache.get(documentId);
}

/**
 * 立即把挂起的写入落盘。
 *
 * 写盘本身是防抖的（800ms），页面关闭时那 800ms 等不到——
 * 必须在 `pagehide` 之类的时机手动催一次。
 */
export function flushReadingPositions(): void {
  persist.flush();
}

/**
 * 在有序的标题偏移量数组里，找出最后一个不超过当前滚动位置的标题下标。
 *
 * 用二分而不是线性扫描：保存位置是滚动过程中的高频操作，几百个标题时
 * 线性扫描累加起来会吃掉可观的主线程时间。标题的 `offsetTop` 天然按
 * 文档顺序递增，正好满足二分的前提。
 *
 * @returns 命中的下标；滚动位置在第一个标题之上时返回 -1
 */
export function findAnchorIndex(offsets: readonly number[], scrollTop: number): number {
  let low = 0;
  let high = offsets.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const offset = offsets[mid];
    if (offset === undefined) break;
    if (offset <= scrollTop) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

/** 一份文档的标题锚点索引 */
export interface AnchorIndex {
  /** 标题 id，按文档顺序 */
  ids: readonly string[];
  /** 对应的 offsetTop，与 ids 一一对应且递增 */
  offsets: readonly number[];
}

/**
 * 计算应该滚动到的位置。
 *
 * 这是整个阅读位置功能的核心判断，也是唯一容易出错的地方，所以抽成纯函数：
 * - **锚点仍在**：用「锚点当前的 offsetTop + 保存时的相对偏移」。
 *   这样即使锚点上方新增或删除了内容（自动刷新最常见的情形），
 *   用户看到的仍然是原来那一段文字；
 * - **锚点已消失**（标题被删或改名）：回落到比例定位，虽不精确但不会跳到顶部；
 * - **保存时就在首个标题之上**：按比例定位。
 *
 * @param position 保存的位置
 * @param anchors 当前文档的锚点索引
 * @param scrollable 可滚动高度（scrollHeight - clientHeight）
 * @returns 目标 scrollTop，已裁剪为非负
 */
export function computeRestoreTarget(
  position: ReadingPosition,
  anchors: AnchorIndex,
  scrollable: number,
): number {
  const anchorIndex = position.anchorId ? anchors.ids.indexOf(position.anchorId) : -1;

  const target =
    anchorIndex >= 0
      ? (anchors.offsets[anchorIndex] ?? 0) + position.anchorOffset
      : position.ratio * Math.max(0, scrollable);

  return Math.max(0, target);
}

/** 清空全部记录（测试与「恢复默认」用） */
export function clearReadingPositions(): void {
  cache.clear();
  hydrated = false;
  persist.cancel();
  void writeValue(STORAGE_AREAS.readingPositions, STORAGE_KEYS.readingPositions, {});
}
