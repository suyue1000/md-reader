import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasHostChannel,
  requestHostWrite,
  requestWriteGrant,
  resetHostChannel,
  setHostNonce,
} from './host-write';

const NONCE = 'nonce-甲';

/** 记下阅读器发给宿主的每一条消息 */
let sent: unknown[];

/** 扮演宿主：收到请求后回一条指定的消息 */
function replyWith(message: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data: message, source: window }));
}

beforeEach(() => {
  resetHostChannel();
  sent = [];
  vi.spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    sent.push(message);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetHostChannel();
});

describe('宿主通道的握手', () => {
  it('没收到过宿主令牌时，通道不可用', () => {
    expect(hasHostChannel()).toBe(false);
  });

  it('授权请求在没有宿主时直接返回 unavailable，不发任何消息', async () => {
    await expect(requestWriteGrant()).resolves.toEqual({ kind: 'unavailable' });
    expect(sent).toHaveLength(0);
  });

  it('没有宿主时写回直接失败，且不标成 stale', async () => {
    /*
     * stale 的含义是「磁盘被别人改了」，那是要提示用户重新打开文档的。
     * 没有通道只是功能不可用，两者不能混成一条提示。
     */
    await expect(requestHostWrite('正文', 1)).resolves.toEqual({
      kind: 'failed',
      message: '没有可用的宿主通道',
      stale: false,
    });
    expect(sent).toHaveLength(0);
  });
});

describe('请求写回授权', () => {
  beforeEach(() => {
    setHostNonce(NONCE);
  });

  it('发出的请求带着宿主令牌', async () => {
    const pending = requestWriteGrant();
    replyWith({ type: 'md-reader:write-granted', content: '磁盘上的正文', lastModified: 11 });
    await pending;

    expect(sent).toEqual([{ type: 'md-reader:grant-write', nonce: NONCE }]);
  });

  it('授权通过时交出磁盘上的真实内容与时间戳', async () => {
    const pending = requestWriteGrant();
    replyWith({ type: 'md-reader:write-granted', content: '磁盘上的正文', lastModified: 11 });

    await expect(pending).resolves.toEqual({
      kind: 'granted',
      content: '磁盘上的正文',
      lastModified: 11,
    });
  });

  it('用户取消时如实报出 cancelled，调用方据此不弹提示', async () => {
    const pending = requestWriteGrant();
    replyWith({ type: 'md-reader:write-denied', reason: '已取消授权', cancelled: true });

    await expect(pending).resolves.toEqual({
      kind: 'denied',
      reason: '已取消授权',
      cancelled: true,
    });
  });

  it('选错文件被宿主挡下时，原因原样带回来', async () => {
    const pending = requestWriteGrant();
    replyWith({
      type: 'md-reader:write-denied',
      reason: '选中的是 乙.md，与当前文档 甲.md 不是同一个文件',
      cancelled: false,
    });

    const outcome = await pending;
    expect(outcome.kind).toBe('denied');
    expect(outcome).toMatchObject({ cancelled: false });
  });
});

describe('请求写回', () => {
  beforeEach(() => {
    setHostNonce(NONCE);
  });

  it('把文本与比对基线一并交给宿主', async () => {
    /*
     * `baseModified` 是这条路径上唯一的冲突闸门：接管页面的文档 source 是
     * 'url'，useAutoRefresh 不对它轮询，宿主写前那次时间戳比对之外没有任何
     * 地方能发现磁盘被别人改过。漏传它等于把闸门拆了。
     */
    const pending = requestHostWrite('新的正文', 42);
    replyWith({ type: 'md-reader:write-ok', lastModified: 99 });
    await pending;

    expect(sent).toEqual([
      { type: 'md-reader:write-file', nonce: NONCE, text: '新的正文', baseModified: 42 },
    ]);
  });

  it('写成功时带回新的磁盘时间戳', async () => {
    const pending = requestHostWrite('新的正文', 42);
    replyWith({ type: 'md-reader:write-ok', lastModified: 99 });

    await expect(pending).resolves.toEqual({ kind: 'written', lastModified: 99 });
  });

  it('磁盘已被外部改动时标成 stale——这次一个字节都没写', async () => {
    const pending = requestHostWrite('新的正文', 42);
    replyWith({
      type: 'md-reader:write-error',
      message: '磁盘上的文件已被其它程序改动',
      stale: true,
    });

    await expect(pending).resolves.toEqual({
      kind: 'failed',
      message: '磁盘上的文件已被其它程序改动',
      stale: true,
    });
  });

  it('普通写入失败不标 stale', async () => {
    const pending = requestHostWrite('新的正文', 42);
    replyWith({ type: 'md-reader:write-error', message: '磁盘已满', stale: false });

    await expect(pending).resolves.toMatchObject({ kind: 'failed', stale: false });
  });
});

describe('只认父窗口发来的回音', () => {
  beforeEach(() => {
    setHostNonce(NONCE);
  });

  it('来源不是父窗口的消息一律不落点', async () => {
    /*
     * 这条守的是通道的来源判据。伪造一条 write-ok 就能让阅读器以为
     * 「已经写进磁盘了」，进而清掉脏状态、放行关页——而用户的改动其实
     * 还悬在编辑器里。
     */
    const pending = requestHostWrite('新的正文', 42);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'md-reader:write-ok', lastModified: 1 },
        source: {} as unknown as Window,
      }),
    );

    const settled = await Promise.race([
      pending,
      new Promise<'still-waiting'>((resolve) => setTimeout(() => resolve('still-waiting'), 20)),
    ]);
    expect(settled).toBe('still-waiting');

    // 真正的父窗口回音仍然能落点
    replyWith({ type: 'md-reader:write-ok', lastModified: 7 });
    await expect(pending).resolves.toEqual({ kind: 'written', lastModified: 7 });
  });
});
