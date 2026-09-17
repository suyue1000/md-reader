import { describe, expect, it } from 'vitest';
import { isHostMessage, isLoadMessage, isViewerMessage } from './protocol';

/**
 * 协议的三个运行时守卫。
 *
 * 它们是这条跨源通道上唯一的类型防线：两端分属不同的源，只能用 postMessage
 * 通信，收到的东西在 TypeScript 眼里永远是 `unknown`。守卫漏认一种消息，
 * 对应的功能就静默失灵——不报错，只是什么都不发生。
 */

/** 一条字段齐全的 load 消息 */
const LOAD = {
  type: 'md-reader:load',
  name: '甲.md',
  url: 'file:///甲.md',
  content: '正文',
  hash: '',
  nonce: 'nonce-甲',
};

describe('isLoadMessage', () => {
  it('字段齐全时认', () => {
    expect(isLoadMessage(LOAD)).toBe(true);
  });

  it('缺令牌不认', () => {
    /*
     * 令牌是之后请宿主代劳写回的唯一凭证。漏了这道校验，`setHostNonce` 会
     * 拿到 undefined，而通道判据会把它当成「已握手」——请求发出去后宿主
     * 核对不通过、静默不回，promise 永远挂着，用户按 ⌘S 毫无反应。
     */
    const { nonce: _nonce, ...withoutNonce } = LOAD;
    expect(isLoadMessage(withoutNonce)).toBe(false);
  });

  it('令牌是空串也不认', () => {
    expect(isLoadMessage({ ...LOAD, nonce: '' })).toBe(false);
  });

  it('令牌不是字符串不认', () => {
    expect(isLoadMessage({ ...LOAD, nonce: 123 })).toBe(false);
  });

  it('缺正文 / 地址 / 文件名都不认', () => {
    for (const key of ['content', 'url', 'name'] as const) {
      const broken: Record<string, unknown> = { ...LOAD };
      delete broken[key];
      expect(isLoadMessage(broken)).toBe(false);
    }
  });

  it('别的消息类型不认', () => {
    expect(isLoadMessage({ ...LOAD, type: 'md-reader:hash' })).toBe(false);
  });

  it('null 与非对象不认', () => {
    expect(isLoadMessage(null)).toBe(false);
    expect(isLoadMessage('md-reader:load')).toBe(false);
  });
});

describe('isHostMessage：宿主发给阅读器的消息', () => {
  it.each([
    'md-reader:load',
    'md-reader:folder',
    'md-reader:folder-error',
    'md-reader:file',
    'md-reader:file-error',
    'md-reader:write-granted',
    'md-reader:write-denied',
    'md-reader:write-ok',
    'md-reader:write-error',
  ])('认得 %s', (type) => {
    expect(isHostMessage({ type })).toBe(true);
  });

  it('不认阅读器方向的消息——方向弄反会让两端互相当作对方', () => {
    expect(isHostMessage({ type: 'md-reader:grant-write' })).toBe(false);
    expect(isHostMessage({ type: 'md-reader:write-file' })).toBe(false);
  });

  it('不认未知类型与非对象', () => {
    expect(isHostMessage({ type: 'md-reader:不存在' })).toBe(false);
    expect(isHostMessage(null)).toBe(false);
    expect(isHostMessage({})).toBe(false);
  });
});

describe('isViewerMessage：阅读器发给宿主的消息', () => {
  it.each([
    'md-reader:ready',
    'md-reader:hash',
    'md-reader:pick-folder',
    'md-reader:read-file',
    'md-reader:grant-write',
    'md-reader:write-file',
  ])('认得 %s', (type) => {
    expect(isViewerMessage({ type })).toBe(true);
  });

  it('不认宿主方向的消息', () => {
    expect(isViewerMessage({ type: 'md-reader:write-ok' })).toBe(false);
    expect(isViewerMessage({ type: 'md-reader:load' })).toBe(false);
  });

  it('不认未知类型与非对象', () => {
    expect(isViewerMessage({ type: 'md-reader:不存在' })).toBe(false);
    expect(isViewerMessage(undefined)).toBe(false);
  });
});
