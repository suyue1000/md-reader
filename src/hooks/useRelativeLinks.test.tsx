import { act, render } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ScrollContainerProvider } from '@/components/layout/ScrollContainerContext';
import { buildTocTree } from '@/markdown/toc';
import { useDocumentStore } from '@/stores/document.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { MarkdownDocument } from '@/types';
import type * as FileOpenModule from '@/utils/file-open';
import { useRelativeLinks } from './useRelativeLinks';

/** 只替换 scrollToLine：跳没跳、跳到第几行，是锚点这条路径的全部可观察行为 */
const scrollToLine = vi.fn();
vi.mock('@/editor/MarkdownEditor', () => ({
  scrollToLine: (view: EditorView, line: number): void => {
    scrollToLine(view, line);
  },
}));

/**
 * 工作区整个换成替身。
 *
 * 真实的 `openPath` 会去读文件、写 store、登记句柄，而本文件要验证的只是
 * 「这次点击有没有被交给它」。
 */
const openPath = vi.fn();
vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    openPath,
    openFolder: vi.fn(),
    restoreFolder: vi.fn(),
    closeFolder: vi.fn(),
  }),
}));

/** 相对链接分支要问「这个路径在工作区里吗」，只放行我们准备好的那一个 */
vi.mock('@/utils/file-open', async (importOriginal) => ({
  ...(await importOriginal<typeof FileOpenModule>()),
  getFileHandleByPath: (path: string): unknown =>
    path === 'docs/install.md' ? { kind: 'file' } : undefined,
}));

const TOC = buildTocTree([
  { id: '开篇', text: '开篇', level: 1, line: 0 },
  { id: '第二节', text: '第二节', level: 2, line: 37 },
  { id: '第二节-1', text: '第二节', level: 3, line: 96 },
]);

function doc(path: string): MarkdownDocument {
  return {
    id: path,
    name: 'readme.md',
    path,
    content: '',
    size: 0,
    lastModified: 0,
    source: 'url',
  };
}

let container: HTMLElement;
let view: EditorView | null;
/** 拦下 log.warn，避免「找不到锚点」那一条刷进测试输出 */
let warn: MockInstance;

function Probe(): null {
  useRelativeLinks(view);
  return null;
}

function mount(): void {
  render(
    <ScrollContainerProvider value={container}>
      <Probe />
    </ScrollContainerProvider>,
  );
}

/** 在正文容器里放一个链接并点它 */
function clickLink(href: string, init: MouseEventInit = {}): { defaultPrevented: boolean } {
  const link = document.createElement('a');
  link.setAttribute('href', href);
  link.textContent = '去那一节';
  container.append(link);

  /*
   * 在 document 上补一道兜底：被测 hook 放行的点击会一路冒泡到 jsdom 的
   * 链接默认行为，而 jsdom 没有实现导航，会往测试输出里吐一大段
   * 「Not implemented: navigation」。这道监听器排在容器监听器之后（冒泡到
   * document 才轮到它），先如实记下此刻的 defaultPrevented——那正是被测
   * 代码的判定结果——再把默认行为拦掉。
   */
  const observed = { defaultPrevented: false };
  const guard = (event: Event): void => {
    observed.defaultPrevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener('click', guard);
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  document.removeEventListener('click', guard);

  return observed;
}

beforeEach(() => {
  scrollToLine.mockClear();
  openPath.mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  container = document.createElement('div');
  document.body.append(container);
  // hook 只把 view 当作 scrollToLine 的实参传出去，这里不需要真的编辑器
  view = { dom: container } as unknown as EditorView;

  useDocumentStore.getState().reset();
  useWorkspaceStore.getState().clearWorkspace();
});

afterEach(() => {
  container.remove();
  warn.mockRestore();
});

describe('正文里的站内锚点链接', () => {
  it('目标标题不在 DOM 里也能跳——按目录里的行号滚过去', () => {
    /*
     * 缺口一的核心。虚拟化之后视口外的标题根本不在 DOM 里，交给浏览器原生
     * 处理的话点击**毫无反应**。这里刻意不往 DOM 里放任何 id 为「第二节」
     * 的元素，模拟的就是这个场景。
     */
    useDocumentStore.getState().setToc(TOC);
    mount();

    const { defaultPrevented } = clickLink('#第二节');

    expect(scrollToLine).toHaveBeenCalledWith(view, 37);
    expect(defaultPrevented).toBe(true);
  });

  it('跳转同时记一次显式导航', () => {
    /*
     * 与目录点击同属显式导航。不记的话，刚恢复过阅读位置的文档里点一个
     * `[见下文](#某节)`，增强完成后的校正会把用户拽回记录位置——那次校正
     * 认不出这是程序化滚动，见 `useReadingPosition` 的 `isDisarmed`。
     */
    useDocumentStore.getState().setToc(TOC);
    const before = useDocumentStore.getState().navigationEpoch;
    mount();

    clickLink('#第二节');

    expect(useDocumentStore.getState().navigationEpoch).toBe(before + 1);
  });

  it('不是标题的锚点不记导航', () => {
    // 这一条放行给浏览器（脚注之类），我们没跳，撤防会白白吃掉一次恢复
    useDocumentStore.getState().setToc(TOC);
    const target = document.createElement('div');
    target.id = 'fn1';
    container.append(target);
    const before = useDocumentStore.getState().navigationEpoch;
    mount();

    clickLink('#fn1');

    expect(useDocumentStore.getState().navigationEpoch).toBe(before);
  });

  it('百分号编码的中文锚点同样命中', () => {
    // markdown-it 渲染出来的 href 是编码过的，目录里的 id 是原文
    useDocumentStore.getState().setToc(TOC);
    mount();

    clickLink(`#${encodeURIComponent('第二节')}`);

    expect(scrollToLine).toHaveBeenCalledWith(view, 37);
  });

  it('重复标题的去重后缀不会被当成另一个标题', () => {
    useDocumentStore.getState().setToc(TOC);
    mount();

    clickLink('#第二节-1');

    expect(scrollToLine).toHaveBeenCalledWith(view, 96);
  });

  it('没打开文件夹时照样能跳', () => {
    /*
     * 单独打开一个 .md 文件是最常见的用法，此时 rootName 为 null。
     * 原实现把「打开过文件夹」当成整个监听器的前提，锚点会一起被挡掉。
     */
    useDocumentStore.getState().setToc(TOC);
    expect(useWorkspaceStore.getState().rootName).toBeNull();
    mount();

    clickLink('#第二节');

    expect(scrollToLine).toHaveBeenCalledWith(view, 37);
  });

  it('目标不是标题、但就在 DOM 里时放行给浏览器', () => {
    // 脚注引用（#fn1）走的就是这条路，浏览器自己跳得了，不该抢
    const footnote = document.createElement('li');
    footnote.id = 'fn1';
    container.append(footnote);
    useDocumentStore.getState().setToc(TOC);
    mount();

    const { defaultPrevented } = clickLink('#fn1');

    expect(scrollToLine).not.toHaveBeenCalled();
    expect(defaultPrevented).toBe(false);
  });

  it('目录与页面里都不存在的锚点：原地不动，并且不静默', () => {
    // 有意选择：既不放行（会改地址栏 hash 却跳不动），也不兜底跳文档顶部
    useDocumentStore.getState().setToc(TOC);
    mount();

    const { defaultPrevented } = clickLink('#根本没有这一节');

    expect(scrollToLine).not.toHaveBeenCalled();
    expect(defaultPrevented).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('编辑器未就绪时放行，不吞掉这次点击', () => {
    view = null;
    useDocumentStore.getState().setToc(TOC);
    mount();

    const { defaultPrevented } = clickLink('#第二节');

    expect(scrollToLine).not.toHaveBeenCalled();
    expect(defaultPrevented).toBe(false);
  });

  it('按住修饰键点击不拦截', () => {
    useDocumentStore.getState().setToc(TOC);
    mount();

    const { defaultPrevented } = clickLink('#第二节', { metaKey: true });

    expect(scrollToLine).not.toHaveBeenCalled();
    expect(defaultPrevented).toBe(false);
  });

  it('目录随后到齐（编辑器又渲染了一轮）时用的是新目录', () => {
    // 目录走 ref 而不是 effect 依赖，这条锁住 ref 确实被同步了
    mount();
    clickLink('#第二节');
    expect(scrollToLine).not.toHaveBeenCalled();

    // 目录经 effect 同步进 latestRef，不冲刷的话 ref 里还是空目录
    act(() => {
      useDocumentStore.getState().setToc(TOC);
    });
    clickLink('#第二节');

    expect(scrollToLine).toHaveBeenCalledWith(view, 37);
  });
});

describe('工作区相对链接（回归）', () => {
  beforeEach(() => {
    useDocumentStore.getState().setDocument(doc('docs/readme.md'));
    useWorkspaceStore.getState().setWorkspace({
      rootName: 'docs',
      tree: [],
      fileCount: 0,
      truncated: false,
      paths: [],
    });
  });

  it('工作区内的相对链接仍然由阅读器打开', () => {
    mount();

    const { defaultPrevented } = clickLink('./install.md');

    expect(openPath).toHaveBeenCalledWith('docs/install.md');
    expect(defaultPrevented).toBe(true);
  });

  it('不在工作区里的相对链接保持默认行为', () => {
    mount();

    const { defaultPrevented } = clickLink('./missing.md');

    expect(openPath).not.toHaveBeenCalled();
    expect(defaultPrevented).toBe(false);
  });

  it('绝对链接保持默认行为', () => {
    mount();

    const { defaultPrevented } = clickLink('https://example.com/a.md');

    expect(openPath).not.toHaveBeenCalled();
    expect(defaultPrevented).toBe(false);
  });
});
