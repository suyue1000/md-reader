/**
 * 自己写盘的登记表。
 *
 * 自动刷新靠轮询 `lastModified` 发现文件变化（见 `file-open.ts` 的
 * `probeCurrentFile`）。自动保存一开，我们自己每次写盘都会让时间戳变，
 * 轮询于是判定「文件被外部改了」，把内容原样灌回来——光标跳走，
 * 正在打的字被打断。
 *
 * `decideRefreshAction` 里「内容相同就只对时」那条分支能挡住大部分情况，
 * 但那是巧合而非保证：写盘与下一次轮询之间用户完全可能又敲了几个字，
 * 此时磁盘内容与编辑器内容确实不同，那条分支就失效了。显式登记才可靠。
 */

/** 保留多少条登记。轮询间隔 1.5s，十来条足够覆盖连续保存的窗口 */
const MAX_ENTRIES = 12;

/** 「时间戳 + 内容」的组合键，按写入顺序排列 */
const entries: string[] = [];

function keyOf(content: string, lastModified: number): string {
  return `${String(lastModified)}:${String(content.length)}:${content}`;
}

/** 登记一次自己发起的写盘 */
export function recordSelfWrite(content: string, lastModified: number): void {
  entries.push(keyOf(content, lastModified));
  if (entries.length > MAX_ENTRIES) entries.shift();
}

/** 这份内容与时间戳是不是我们刚写下去的 */
export function isSelfWrite(content: string, lastModified: number): boolean {
  return entries.includes(keyOf(content, lastModified));
}

/**
 * 排空登记表。
 *
 * **生产代码没有调用点，只有测试在用**（用来构造「登记已经滚过去了」这一
 * 情形、以及避免用例之间互相污染）。这里如实记下来，是因为这个函数原先的
 * 注释写的是「换文档时清空」——那是一句没有兑现的承诺，照着它读代码的人
 * 会以为换文档这件事已经有人管了。
 *
 * 换文档时**不需要**清：登记的键是「时间戳 + 长度 + 内容」三者的组合
 * （见 `keyOf`），跨文档误命中要求乙的磁盘内容与甲刚写下去的那一份逐字节
 * 相同、且 mtime 也恰好相同。而条目只留最近 12 条，滚动很快。
 * 与版本缓冲（`editor/save.ts`，那里按「这一次打开」清）不同：那边存的是
 * 会被**灌回编辑器**的正文，认错文档就是把甲的正文写进乙的文件；
 * 这边存的只是「要不要跳过一次重渲染」的线索，认错的后果是少刷新一次。
 */
export function clearSelfWrites(): void {
  entries.length = 0;
}
