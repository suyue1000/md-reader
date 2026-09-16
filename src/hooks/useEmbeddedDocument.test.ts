import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncAnchorHash } from './useEmbeddedDocument';

/**
 * 每个用例都把地址恢复成一个干净的、不带 hash 的路径。
 *
 * jsdom 里 `history.replaceState` 是真实实现，改动会留到下一个用例。
 */
function resetLocation(search = ''): void {
  history.replaceState(null, '', `/viewer.html${search}`);
}

beforeEach(() => {
  resetLocation();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetLocation();
});

describe('syncAnchorHash', () => {
  it('把锚点写进地址栏', () => {
    // 这条正是「地址栏保持 file:// 且可分享」那条承诺的落地点：
    // 跳到某一节之后复制地址栏，对方打开应当落在同一节
    syncAnchorHash('第-8-章');
    expect(decodeURIComponent(window.location.hash)).toBe('#第-8-章');
  });

  it('中文锚点做百分号编码，读回来能还原', () => {
    syncAnchorHash('一、简介');
    expect(window.location.hash).toBe(`#${encodeURIComponent('一、简介')}`);
  });

  it('不新增历史记录', () => {
    /*
     * 用 replaceState 而不是 pushState / `location.hash = x`：读一篇长文点
     * 十次目录，返回键不该要按十次。
     */
    const push = vi.spyOn(history, 'pushState');
    const replace = vi.spyOn(history, 'replaceState');
    syncAnchorHash('甲');
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('已经是这个锚点时不再写一次', () => {
    syncAnchorHash('甲');
    const replace = vi.spyOn(history, 'replaceState');
    syncAnchorHash('甲');
    expect(replace).not.toHaveBeenCalled();
  });

  it('保留路径与查询串，只换 hash', () => {
    resetLocation('?embed=1');
    syncAnchorHash('甲');
    expect(window.location.pathname).toBe('/viewer.html');
    expect(window.location.search).toBe('?embed=1');
  });

  it('斜杠开头的标题不会被当成一次路由跳转', () => {
    // 极简路由（viewer/router.tsx）把 `#/xxx` 当路由，编码之后 `/` 变成 %2F
    syncAnchorHash('/settings');
    expect(window.location.hash.startsWith('#/')).toBe(false);
  });

  it('空锚点什么都不做', () => {
    const replace = vi.spyOn(history, 'replaceState');
    syncAnchorHash('');
    expect(replace).not.toHaveBeenCalled();
  });

  it('非嵌入模式下不向父窗口发消息', () => {
    const post = vi.spyOn(window.parent, 'postMessage');
    syncAnchorHash('甲');
    expect(post).not.toHaveBeenCalled();
  });

  it('嵌入模式下把锚点同步给宿主页面', () => {
    /*
     * 嵌入模式下用户看到的地址栏是**宿主**的（`file:///…/xxx.md`），
     * iframe 自己的地址栏根本不可见。`replaceState` 不派发 `hashchange`，
     * 宿主那个转发监听器收不到，所以必须直接发一条消息过去。
     */
    resetLocation('?embed=1');
    const post = vi.fn();
    // isEmbedded 要求 window.parent !== window，jsdom 里两者本来相等
    const fakeParent = { postMessage: post } as unknown as Window;
    vi.spyOn(window, 'parent', 'get').mockReturnValue(fakeParent);

    syncAnchorHash('第-8-章');

    expect(post).toHaveBeenCalledWith(
      { type: 'md-reader:hash', hash: `#${encodeURIComponent('第-8-章')}` },
      '*',
    );
  });
});
