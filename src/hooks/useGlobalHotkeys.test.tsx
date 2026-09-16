import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useUiStore } from '@/stores/ui.store';
import type { MarkdownDocument } from '@/types';
import { setCurrentFileHandle } from '@/utils/file-open';
import { isMacPlatform } from '@/utils/hotkeys';
import { useAutoSave } from './useAutoSave';
import { useGlobalHotkeys } from './useGlobalHotkeys';

const DOC: MarkdownDocument = {
  id: 'doc:hotkeys.md',
  name: 'hotkeys.md',
  path: 'hotkeys.md',
  content: '# 标题\n\n正文。',
  size: 12,
  lastModified: 0,
  source: 'fs-handle',
};

function Probe(): React.JSX.Element {
  useGlobalHotkeys();
  return <div />;
}

/**
 * 复刻真实的组合：`ReaderPage` 挂 `useAutoSave`（它持有编辑器里的正文），
 * `App` 挂 `useGlobalHotkeys`（⌘S 的 handler 从这里来）。
 *
 * 两者必须同时在场，这条链路才是完整的——快捷键那一侧拿不到编辑器实例
 * （`useGlobalHotkeys` 在 provider 之外，见 `useAutoSave` 顶部的说明），
 * 它要存的文本正是 `useAutoSave` 交出来的那一份。
 */
function SaveProbe({ text }: { text: string }): React.JSX.Element {
  useAutoSave(text);
  useGlobalHotkeys();
  return <div />;
}

/** 写盘会被记下来的句柄替身（同 `editor/save.test.ts` 的形状） */
function fakeHandle(): { handle: FileSystemFileHandle; writes: string[] } {
  const writes: string[] = [];
  let pending = '';
  const handle = {
    name: 'hotkeys.md',
    queryPermission: () => Promise.resolve('granted' as PermissionState),
    requestPermission: () => Promise.resolve('granted' as PermissionState),
    createWritable: () =>
      Promise.resolve({
        write: (text: string) => {
          pending = text;
          return Promise.resolve();
        },
        close: () => {
          writes.push(pending);
          return Promise.resolve();
        },
      }),
    getFile: () => Promise.resolve({ lastModified: 2000 } as File),
  };
  return { handle: handle as unknown as FileSystemFileHandle, writes };
}

/**
 * 在指定元素上按一次组合键。
 *
 * `target` 是这组用例的全部重点：`useHotkeys` 按 `event.target` 是否可编辑
 * 决定要不要跳过绑定，而编辑态的正文（CodeMirror 的 `.cm-content`）正是
 * 一个 contenteditable 元素。
 */
function press(target: Element, key: string): void {
  const isMac = isMacPlatform();
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        metaKey: isMac,
        ctrlKey: !isMac,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/** 复刻编辑态正文的关键属性：contenteditable */
function editableTarget(): HTMLElement {
  const host = document.createElement('div');
  host.contentEditable = 'true';
  /*
   * jsdom 不根据 contenteditable 属性推导 `isContentEditable`（它始终是
   * undefined），而 `isEditableTarget` 判的就是这个属性。真实浏览器里
   * CodeMirror 的 `.cm-content` 两者都为真，所以这里手工补上，
   * 否则这组用例会因为「根本没走到可编辑分支」而假绿。
   */
  Object.defineProperty(host, 'isContentEditable', { value: true, configurable: true });
  document.body.appendChild(host);
  return host;
}

describe('useGlobalHotkeys', () => {
  beforeEach(() => {
    setCurrentFileHandle(null);
    act(() => {
      useDocumentStore.getState().setDocument(DOC);
    });
  });

  afterEach(() => {
    act(() => {
      useDocumentStore.getState().reset();
      useUiStore.getState().setSearchOpen(false);
    });
    document.body.innerHTML = '';
  });

  it('阅读态按 mod+e 进入编辑态', async () => {
    render(<Probe />);

    press(document.body, 'e');
    // enterEdit 是 async，没有句柄时不会真的等待，但仍要让微任务跑完
    await act(() => Promise.resolve());

    expect(useDocumentStore.getState().mode).toBe('edit');
  });

  it('编辑态下在可编辑正文里按 mod+e 仍能退回阅读态', async () => {
    render(<Probe />);
    press(document.body, 'e');
    await act(() => Promise.resolve());
    expect(useDocumentStore.getState().mode).toBe('edit');

    /*
     * 这一条是本文件存在的理由。编辑态一开，焦点就在 contenteditable 的正文上，
     * `useHotkeys` 默认会跳过所有绑定——「编辑」动作不声明 allowInInput 的话，
     * 用户进得去、出不来，而快捷键失灵在测试里是完全静默的。
     */
    press(editableTarget(), 'e');
    await act(() => Promise.resolve());

    expect(useDocumentStore.getState().mode).toBe('read');
  });

  it('编辑态正文里按 mod+f 打开自研查找', () => {
    /*
     * 本任务把查找也开进了编辑态：「在自己正在写的长文里找一处」正是最需要
     * 它的时候。让位给浏览器原生查找在这里没有意义——正文是按视口逐块渲染
     * 的，原生查找只找得到屏幕上那几块（理由详见 `useToolbarActions`）。
     */
    render(<Probe />);

    press(editableTarget(), 'f');

    expect(useUiStore.getState().searchOpen).toBe(true);
  });

  it('没有声明 allowInInput 的动作在可编辑区域里照旧让位（对照组）', () => {
    render(<Probe />);
    const target = editableTarget();

    /*
     * 对照组用「设置」（mod+,）：它与正在写的内容无关，编辑态里不必抢这一下。
     * 这一条证明上面几条能生效是因为那些动作**各自声明了** allowInInput，
     * 而不是因为 `useHotkeys` 把可编辑判断整个丢了。
     *
     * 原先这里用的是 mod+f，本任务把查找开进编辑态之后它不再是对照组。
     */
    press(target, ',');
    expect(useUiStore.getState().settingsOpen).toBe(false);

    // 同一个组合键在非可编辑区域是生效的，证明上一行不是因为绑定压根没注册
    press(document.body, ',');
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });

  it('编辑态下在可编辑正文里按 mod+s 真的写盘', async () => {
    /*
     * ⌘S 是整个编辑功能里最需要 allowInInput 的一个：它的用武之地几乎全在
     * 编辑态，而编辑态的正文是 contenteditable——不声明这一项，`useHotkeys`
     * 会跳过这条绑定，按下去只会弹出浏览器自己的「保存网页」，而用户以为
     * 自己已经存好了。这种失灵在测试里是完全静默的，所以必须有这一条。
     *
     * 关掉自动保存，确保这次写盘只可能是这次按键带来的。
     */
    act(() => {
      useSettingsStore.getState().setEditor({ autoSave: false });
    });
    const { handle, writes } = fakeHandle();
    setCurrentFileHandle(handle);
    act(() => {
      // setDocument 会把 writable 清成 false，所以顺序不能反
      useDocumentStore.getState().setDocument(DOC);
      useDocumentStore.getState().setWritable(true);
      useDocumentStore.getState().setMode('edit');
    });
    render(<SaveProbe text="我在编辑态里改的内容" />);

    press(editableTarget(), 's');

    await waitFor(() => {
      expect(writes).toEqual(['我在编辑态里改的内容']);
    });
    expect(useDocumentStore.getState().document?.content).toBe('我在编辑态里改的内容');
  });

  it('没有打开文档时 mod+e 不生效', async () => {
    act(() => {
      useDocumentStore.getState().reset();
    });
    render(<Probe />);

    press(document.body, 'e');
    await act(() => Promise.resolve());

    expect(useDocumentStore.getState().mode).toBe('read');
  });
});
