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

/**
 * 存储里读回来的一条记录是不是当前结构。
 *
 * 必须校验，不能直接断言类型。这个结构**改过一次**：早期版本存的是
 * 「滚动比例 + 锚点 id + 锚点内偏移」，改用编辑器之后换成了「行号 + 行内偏移」。
 * 老版本留在 chrome.storage 里的记录没有 `line` 字段，直接当新结构用，
 * `position.line` 就是 `undefined`——它会一路传到 `scrollToLine`，
 * `undefined + 1` 得到 `NaN`，而 CodeMirror 的边界检查
 * （`n < 1 || n > lines`）对 NaN 两侧都为假、**恰好放行**，最终在它内部
 * 抛出一个与真正原因毫无关系的 TypeError，整个阅读器白屏。
 *
 * 结构不认识就丢掉，不做转换：比例换行号需要知道文档有多少行，而这里
 * 只有存储数据、没有文档。丢掉的代价是升级后第一次打开老文档会从头开始，
 * 用户滚一下就重新存上了；而留着一条会让阅读器崩溃的记录，代价是整页打不开。
 */
function isCurrentShape(value: unknown): value is ReadingPosition {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<ReadingPosition>;
  return Number.isFinite(record.line) && Number.isFinite(record.offset);
}

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
    // 结构对不上的（上一个版本留下的记录）直接丢弃，理由见 isCurrentShape
    if (!isCurrentShape(position)) continue;
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

/** 清空全部记录（测试与「恢复默认」用） */
export function clearReadingPositions(): void {
  cache.clear();
  hydrated = false;
  persist.cancel();
  void writeValue(STORAGE_AREAS.readingPositions, STORAGE_KEYS.readingPositions, {});
}
