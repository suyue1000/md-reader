import { useEffect } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider, useSetEditorView } from '@/editor/EditorContext';
import { resetHostChannel, setHostNonce } from '@/editor/host-write';
import { popPreviousVersion } from '@/editor/save';
import { clearSelfWrites } from '@/editor/self-write';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useUiStore } from '@/stores/ui.store';
import type { MarkdownDocument } from '@/types';
import {
  getCurrentFileHandle,
  probeCurrentFile,
  setCurrentFileHandle,
  type FileProbeResult,
} from '@/utils/file-open';
// 命名空间形式的类型导入，供下面的 `importOriginal` 标注原模块的形状
// （项目禁止行内的 `import()` 类型标注，见 eslint 的 consistent-type-imports）
import type * as FileOpenModule from '@/utils/file-open';
import { useAutoRefresh } from './useAutoRefresh';
import { useAutoSave, useSaveCommands } from './useAutoSave';

/**
 * 这是整条保存链路第一次被接上真实的触发入口。Task 14/15/16 交付的决策、
 * 写盘与冲突判定各自都有单测，但**没有任何一条用例证明它们会被调用**——
 * 「按了 ⌘S 什么都没发生」「停笔之后没写盘」这类断线在那些用例里全是绿的。
 * 本文件测的就是这段接线。
 *
 * 只 mock `probeCurrentFile` 一个函数（它背后是真实的 File System Access
 * API，jsdom 里造不出来），`file-open` 的其余部分——尤其是模块作用域的
 * 当前句柄——保持真实，否则 `save.ts` 会拿不到句柄，测的就不是同一条链路了。
 */
vi.mock('@/utils/file-open', async (importOriginal) => {
  const actual = await importOriginal<typeof FileOpenModule>();
  return { ...actual, probeCurrentFile: vi.fn() };
});

const probeMock = vi.mocked(probeCurrentFile);

const DOC: MarkdownDocument = {
  id: 'doc:a.md',
  name: 'a.md',
  path: 'a.md',
  content: '原文',
  size: 6,
  lastModified: 1000,
  source: 'fs-handle',
};

const AUTO_SAVE_DELAY_MS = 800;
const REFRESH_INTERVAL_MS = 1500;

/**
 * 能记下写入内容、并像真实文件一样在每次写入后推进 mtime 的句柄替身。
 *
 * 与 `editor/save.test.ts` 里那个是同一套形状（那里也解释了为什么用替身而
 * 不是真实句柄）。这里另写一份而不是抽公共件：两边关心的字段不同，绑在一起
 * 之后任何一边加字段都会牵动另一边。
 */
function fakeHandle(): { handle: FileSystemFileHandle; writes: string[]; lastModified: () => number } {
  const writes: string[] = [];
  let lastModified = DOC.lastModified;
  let pending = '';
  const handle = {
    name: 'a.md',
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
          lastModified += 1;
          return Promise.resolve();
        },
      }),
    getFile: () => Promise.resolve({ lastModified } as File),
  };
  return {
    handle: handle as unknown as FileSystemFileHandle,
    writes,
    lastModified: () => lastModified,
  };
}

/** 把一个真实的 EditorView 交给 provider；必须挂到 body，`useEditorView` 按 isConnected 判活 */
function WithView({ doc, children }: { doc: string; children: React.ReactNode }): React.JSX.Element {
  const setView = useSetEditorView();
  useEffect(() => {
    const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body });
    setView(view);
    return () => {
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}

/** 把两个 hook 的返回值交给用例；在 effect 里写，渲染期改外部变量是 React 禁止的 */
const commands: { current: ReturnType<typeof useSaveCommands> | null } = { current: null };

function Probe({ text, watch = false }: { text: string; watch?: boolean }): React.JSX.Element {
  useAutoSave(text);
  // 只有验「保存后会不会被误判成冲突」的那条用例需要轮询一起跑
  useAutoRefresh();
  const value = useSaveCommands();
  useEffect(() => {
    commands.current = value;
  });
  return <div data-watching={String(watch)} />;
}

/** 挂一个内容与 `text` 相同的真实编辑器——冲突判定要读它 */
function mount(text: string, editorDoc = text): void {
  render(
    <EditorViewProvider>
      <WithView doc={editorDoc}>
        <Probe text={text} />
      </WithView>
    </EditorViewProvider>,
  );
}

/** 开一份处于编辑态、已授权、句柄就位的文档 */
function openWritableDoc(handle: FileSystemFileHandle): void {
  setCurrentFileHandle(handle);
  act(() => {
    useDocumentStore.getState().setDocument(DOC);
    useDocumentStore.getState().setWritable(true);
    useDocumentStore.getState().setMode('edit');
  });
}

beforeEach(() => {
  probeMock.mockReset();
  probeMock.mockResolvedValue({ kind: 'unchanged' });
  clearSelfWrites();
  commands.current = null;
  act(() => {
    useSettingsStore
      .getState()
      .setEditor({ autoSave: true, autoSaveDelay: AUTO_SAVE_DELAY_MS, keepVersions: 5 });
  });
});

afterEach(() => {
  act(() => {
    useDocumentStore.getState().reset();
    useUiStore.getState().dismissNotice();
    useSettingsStore.getState().setEditor({ autoSave: true, autoSaveDelay: AUTO_SAVE_DELAY_MS });
  });
  setCurrentFileHandle(null);
  clearSelfWrites();
  document.body.replaceChildren();
  while (popPreviousVersion() !== null) {
    /* 排空版本缓冲，避免用例互相污染 */
  }
  vi.useRealTimers();
});

/** 推进 `ms` 毫秒并让链路上的 await 全部落定 */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useAutoSave：停笔后自动写回', () => {
  it('停笔到点后把编辑器里的文本写回文件', async () => {
    vi.useFakeTimers();
    const { handle, writes } = fakeHandle();
    openWritableDoc(handle);
    mount('改过的内容');

    // 还没到点，一个字节都不该落盘
    await advance(AUTO_SAVE_DELAY_MS - 100);
    expect(writes).toEqual([]);

    await advance(200);

    // 删掉 useAutoSave 里那句 scheduleSave()，这条会变红
    expect(writes).toEqual(['改过的内容']);
  });

  it('保存成功后把 document.content 推进到刚写下去的那份，脏状态归零', async () => {
    vi.useFakeTimers();
    const { handle, lastModified } = fakeHandle();
    openWritableDoc(handle);
    mount('改过的内容');
    await advance(AUTO_SAVE_DELAY_MS);

    const state = useDocumentStore.getState();
    // 删掉 runSave 里的 markSaved 调用，下面四条一起变红
    expect(state.document?.content).toBe('改过的内容');
    expect(state.document?.lastModified).toBe(lastModified());
    expect(state.dirty).toBe(false);
    expect(state.saveStatus).toBe('saved');
  });

  it('保存之后不会被自动刷新误判成冲突', async () => {
    /*
     * 保存把磁盘上的 mtime 改了，下一轮轮询因此一定会看到「文件变了」。
     * 挡住它的一共有三道网，这里把前两道都拆掉，只留 markSaved 那一道：
     *
     * 1. 时间戳比对（`probeCurrentFile` 发现 mtime 没变就直接返回 unchanged）
     *    ——这里 mock 掉探测，强制报告 changed；
     * 2. 自写登记表（`self-write.ts` 只留最近 12 条，连续保存会把旧条目挤出去）
     *    ——这里 `clearSelfWrites()` 模拟它已经滚过；
     * 3. `markSaved` 把 `document.content` 推进到刚写下去的那份，于是
     *    `decideRefresh` 看到磁盘内容与「上次落盘内容」一致，只对时。
     *
     * 第 3 道断掉时，`savedContent` 还停在「原文」，而编辑器里是「改过的
     * 内容」——`decideRefresh` 判定为本地有未保存改动 + 外部改动 = 冲突，
     * 用户每保存一次就被弹一条「文件在编辑器之外被修改了」。
     */
    vi.useFakeTimers();
    const { handle, lastModified } = fakeHandle();
    openWritableDoc(handle);
    mount('改过的内容');

    await advance(AUTO_SAVE_DELAY_MS);
    expect(useDocumentStore.getState().document?.content).toBe('改过的内容');

    clearSelfWrites();
    const changed: FileProbeResult = {
      kind: 'changed',
      document: { ...DOC, content: '改过的内容', lastModified: lastModified() },
    };
    probeMock.mockResolvedValue(changed);
    await advance(REFRESH_INTERVAL_MS);

    expect(useDocumentStore.getState().conflict).toBeNull();
    expect(useDocumentStore.getState().document?.content).toBe('改过的内容');
  });

  it('阅读态不自动保存', async () => {
    vi.useFakeTimers();
    const { handle, writes } = fakeHandle();
    setCurrentFileHandle(handle);
    act(() => {
      useDocumentStore.getState().setDocument(DOC);
      useDocumentStore.getState().setWritable(true);
    });
    mount('改过的内容');

    await advance(AUTO_SAVE_DELAY_MS * 2);

    expect(writes).toEqual([]);
  });

  it('关掉自动保存后定时器不再写盘，手动保存照旧', async () => {
    vi.useFakeTimers();
    const { handle, writes } = fakeHandle();
    act(() => {
      useSettingsStore.getState().setEditor({ autoSave: false });
    });
    openWritableDoc(handle);
    mount('改过的内容');

    await advance(AUTO_SAVE_DELAY_MS * 2);
    expect(writes).toEqual([]);

    await act(async () => {
      await commands.current?.saveNow();
    });
    expect(writes).toEqual(['改过的内容']);
  });

  it('没有写权限时自动保存静默跳过，不弹任何对话框', async () => {
    vi.useFakeTimers();
    const { handle, writes } = fakeHandle();
    const picker = vi.fn();
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = picker;
    setCurrentFileHandle(handle);
    act(() => {
      useDocumentStore.getState().setDocument(DOC); // writable 默认 false
      useDocumentStore.getState().setMode('edit');
    });
    mount('改过的内容');

    // 连着过好几个防抖周期：这里正是「每 800ms 弹一次对话框」会暴露的地方
    await advance(AUTO_SAVE_DELAY_MS * 4);

    expect(writes).toEqual([]);
    expect(picker).not.toHaveBeenCalled();
    expect(useUiStore.getState().notice).toBeNull();
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});

describe('useAutoSave：写盘期间换了文档', () => {
  /**
   * 造一个可以「卡在 close() 里」的句柄，用来精确构造出写盘进行中的窗口。
   *
   * 这个窗口在真实使用里就是几十毫秒（慢盘、网络挂载、大文件会拉长），
   * 但它的入口是**用户日常操作**：切换文档前的那个未保存确认框弹出时
   * `dirty` 仍为真，用户点「确定」就换了文档，而上一次写盘可能还在 await 里。
   */
  function gatedHandle(): {
    handle: FileSystemFileHandle;
    writes: string[];
    release: () => void;
  } {
    const writes: string[] = [];
    let pending = '';
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = {
      name: 'a.md',
      queryPermission: () => Promise.resolve('granted' as PermissionState),
      requestPermission: () => Promise.resolve('granted' as PermissionState),
      createWritable: () =>
        Promise.resolve({
          write: (text: string) => {
            pending = text;
            return Promise.resolve();
          },
          close: async () => {
            await gate;
            writes.push(pending);
          },
        }),
      getFile: () => Promise.resolve({ lastModified: 2000 } as File),
    };
    return { handle: handle as unknown as FileSystemFileHandle, writes, release };
  }

  it('这次保存的结果一个字都不落到新文档头上', async () => {
    /*
     * 不修的话：`markSaved` 会在 await 之后落到**新文档**头上，把甲的文本
     * 写进乙的 `document.content`。而那个字段的语义是「上次与磁盘一致的
     * 内容」，于是下一次自动保存会拿它当基准，把甲的内容真的写进乙的文件——
     * 用户从没编辑过乙，也没有回收站。这是本功能里最坏的一类缺陷。
     */
    const { handle, writes, release } = gatedHandle();
    openWritableDoc(handle);
    mount('甲改过的内容');

    // 写盘开始，卡在 close() 里
    const inFlight = commands.current?.saveNow();
    await act(async () => {
      await Promise.resolve();
    });

    // 就在这个窗口里换到另一篇文档
    const docB: MarkdownDocument = { ...DOC, id: 'doc:b.md', name: 'b.md', path: 'b.md', content: '乙的原文' };
    act(() => {
      useDocumentStore.getState().setDocument(docB);
    });

    release();
    await act(async () => {
      await inFlight;
    });

    const state = useDocumentStore.getState();
    // 写盘本身照常发生，而且写的是甲自己的文件、甲自己的文本
    expect(writes).toEqual(['甲改过的内容']);
    // 但结果不许落到乙头上
    expect(state.document?.path).toBe('b.md');
    expect(state.document?.content).toBe('乙的原文');
    expect(state.document?.lastModified).toBe(docB.lastModified);
    // 状态栏也不行：乙不该顶着一条不属于它的「已保存」
    expect(state.saveStatus).toBe('idle');
  });
});

describe('useAutoSave：冲突未决期间不写盘', () => {
  /**
   * 外部编辑器写进磁盘的那一份，等价于 `useAutoRefresh` 判出冲突的那一刻。
   *
   * 这一份在本应用里**没有任何副本**：版本缓冲推进的是冲突之前的
   * `document.content`，只有用户点了「改用磁盘上的版本」才会留一份编辑器里的。
   * 所以这期间的每一次写盘都是对第三方数据的不可逆破坏。
   */
  const DISK: MarkdownDocument = { ...DOC, content: '外部编辑器写的内容', lastModified: 9000 };

  it('冲突条弹出后用户继续敲字，自动保存到点也不动手', async () => {
    /*
     * C1 回归，锁的是缺陷本身：冲突挂起期间定时器到点了，磁盘有没有被动过。
     * 不修的话 800ms 后 `writes === ['我又敲了一个字']`，外部编辑器写的那份
     * 被静默覆盖。（现有的 ConflictBanner 用例漏掉这一条，是因为它们只测
     * 「按钮被按下之后」的状态，从不让时间往前走。）
     */
    vi.useFakeTimers();
    const { handle, writes } = fakeHandle();
    openWritableDoc(handle);
    act(() => {
      useDocumentStore.getState().setConflict(DISK);
    });
    mount('我又敲了一个字');

    // 连着过好几个防抖周期，确保不是「只是还没到点」
    await advance(AUTO_SAVE_DELAY_MS * 3);

    expect(writes).toEqual([]);
    // 一个字节都没写，版本缓冲里也不该多出一版
    expect(popPreviousVersion()).toBeNull();
  });

  it('冲突挂着时按 ⌘S 也不写盘，并且如实说明为什么没保存', async () => {
    const { handle, writes } = fakeHandle();
    openWritableDoc(handle);
    act(() => {
      useDocumentStore.getState().setConflict(DISK);
    });
    mount('我又敲了一个字');

    await act(async () => {
      await commands.current?.saveNow();
    });

    expect(writes).toEqual([]);
    // 用户明确要求保存却什么都没发生，静默就是在骗人
    expect(useUiStore.getState().notice?.text).toContain('提示条');
    expect(useDocumentStore.getState().saveStatus).not.toBe('saved');
  });

  it('用户决断完（冲突清空）之后保存恢复，不是一直封着', async () => {
    const { handle, writes } = fakeHandle();
    openWritableDoc(handle);
    act(() => {
      useDocumentStore.getState().setConflict(DISK);
    });
    mount('我又敲了一个字');
    await act(async () => {
      await commands.current?.saveNow();
    });
    expect(writes).toEqual([]);

    act(() => {
      useDocumentStore.getState().clearConflict();
    });
    await act(async () => {
      await commands.current?.saveNow();
    });

    expect(writes).toEqual(['我又敲了一个字']);
  });
});

describe('useAutoSave：版本缓冲跟着「这一次打开」走', () => {
  it('换文档之后点「回到上一个保存版本」，不会把甲的正文灌进乙', async () => {
    /*
     * C2 回归，锁的是缺陷本身：换了文档之后点那个菜单项，编辑器里会不会
     * 出现上一篇文档的正文。
     *
     * 不修的话 `popPreviousVersion()` 仍返回甲的「原文」，`restorePreviousVersion`
     * 把它 dispatch 进乙的编辑器 → 文本一变即为脏 → 800ms 后自动保存把甲的
     * 内容写进乙的文件。那个菜单项只按 `mode === 'edit'` 置灰，不问缓冲里
     * 这一份是谁的，所以拦不住。
     */
    const { handle } = fakeHandle();
    openWritableDoc(handle);
    mount('甲改过的内容');

    // 先在甲上真的保存一次，缓冲里才会有「保存前」的那一版
    await act(async () => {
      await commands.current?.saveNow();
    });

    const docB: MarkdownDocument = {
      ...DOC,
      id: 'doc:b.md',
      name: 'b.md',
      path: 'b.md',
      content: '乙的原文',
    };
    act(() => {
      useDocumentStore.getState().setDocument(docB);
    });

    act(() => {
      commands.current?.restorePreviousVersion();
    });

    // 缓冲已经跟着甲那一次打开一起结束了
    expect(useUiStore.getState().notice?.text).toContain('没有更早的版本');
    // 编辑器里一个字都没被顶掉
    expect(document.querySelector('.cm-content')?.textContent).toBe('甲改过的内容');
  });
});

describe('useAutoSave：保存结果的落点', () => {
  /** 造一个可以卡在 showSaveFilePicker 里的另存选择器替身 */
  function gatedPicker(handle: FileSystemFileHandle): { release: () => void } {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // canUseFilePicker() 以 showOpenFilePicker 的存在判定环境支持（见 utils/env.ts）
    (window as { showOpenFilePicker?: unknown }).showOpenFilePicker = () => undefined;
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => {
      await gate;
      return handle;
    };
    return { release };
  }

  it('另存落定后把新句柄登记成当前文件，writable 随之升为 true', async () => {
    /*
     * 这段登记是从 `performSave` 搬到 `runSave` 里来的（C3）。搬家不能把
     * 行为搬丢：没有它，另存之后的每一次保存都会再弹一次另存对话框，
     * 简报里「另存之后自动保存随之恢复」那条回路就断了。
     */
    const picked = fakeHandle();
    const { release } = gatedPicker(picked.handle);
    setCurrentFileHandle(null);
    act(() => {
      useDocumentStore.getState().setDocument(DOC);
      useDocumentStore.getState().setMode('edit');
    });
    mount('改过的内容');

    const inFlight = commands.current?.saveNow();
    release();
    await act(async () => {
      await inFlight;
    });

    expect(getCurrentFileHandle()).toBe(picked.handle);
    expect(useDocumentStore.getState().writable).toBe(true);
    expect(useDocumentStore.getState().document?.content).toBe('改过的内容');
    expect(useUiStore.getState().notice?.text).toContain('已另存为');

    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it('另存进行中换了文档：乙的保存不会写进甲刚另存出来的那个文件', async () => {
    /*
     * C3 回归，锁的是缺陷本身：换文档之后再存一次，**磁盘上哪个文件被写了**。
     *
     * 不修的话，`performSave` 在 await 之后执行 `setCurrentFileHandle(result.handle)`，
     * 此刻当前文档已经是乙，于是「当前文件句柄」变成甲刚另存出来的那个文件，
     * 乙的下一次保存写进甲的新文件——实测探针数据是
     * `甲.writes = [Blob, '乙的那次保存']`、`乙.writes = []`。
     */
    const picked = fakeHandle(); // 甲另存出来的新文件
    const forB = fakeHandle(); // 乙自己的文件
    const { release } = gatedPicker(picked.handle);

    setCurrentFileHandle(null); // 甲没有句柄 -> save-as
    act(() => {
      useDocumentStore.getState().setDocument(DOC);
      useDocumentStore.getState().setMode('edit');
    });
    mount('甲改过的内容');

    // 另存开始，卡在选择器里
    const inFlight = commands.current?.saveNow();
    await act(async () => {
      await Promise.resolve();
    });

    // 就在这个窗口里换到乙，乙有自己的句柄与写权限
    const docB: MarkdownDocument = {
      ...DOC,
      id: 'doc:b.md',
      name: 'b.md',
      path: 'b.md',
      content: '乙的原文',
    };
    act(() => {
      useDocumentStore.getState().setDocument(docB);
    });
    setCurrentFileHandle(forB.handle);
    act(() => {
      useDocumentStore.getState().setWritable(true);
      useDocumentStore.getState().setMode('edit');
    });

    release();
    await act(async () => {
      await inFlight;
    });

    // 甲的另存结果一个字都不落到乙头上：当前文件仍是乙自己的文件
    expect(getCurrentFileHandle()).toBe(forB.handle);

    // 乙再存一次，写的必须是乙的文件
    await act(async () => {
      await commands.current?.saveNow();
    });
    expect(forB.writes).toEqual(['甲改过的内容']);
    // 甲那个新文件只被另存那一次写过（写进去的是 Blob），此后再没被碰
    expect(picked.writes).toHaveLength(1);

    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});

describe('useAutoSave：弹不出保存对话框时的降级', () => {
  it('⌘S 只触发了下载时，不许清脏状态、不许报「已保存」', async () => {
    /*
     * C6 回归，走的正是验收标准第 5 条那条路：浏览器直开 .md 时阅读器是
     * 跨源 iframe，弹不出任何选择器，⌘S 只能把改动下载到下载目录，
     * **原文件一个字节都没变**。
     *
     * 不修的话（`performSave` 把 `via` 丢掉、两条路都返回 saved-as）：
     * `markSaved` 把 `document.content` 推进成编辑器里的文本 → dirty 归零 →
     * 关页拦截失效 → 状态栏报「已保存」，而用户的文件原封未动。
     *
     * 这里不装 showOpenFilePicker，`canUseFilePicker()` 因此为假；
     * `saveFile` 见不到 showSaveFilePicker 就走 `<a download>` 退路。
     */
    // 直接装替身、不保存原值：jsdom 里这两个本来就可能缺席，而本文件只有
    // 这一条用例用到它们（`export/export.test.ts` 用的是同一招）
    URL.createObjectURL = vi.fn(() => 'blob:stub');
    URL.revokeObjectURL = vi.fn();
    {
      setCurrentFileHandle(null);
      act(() => {
        useDocumentStore.getState().setDocument(DOC);
        useDocumentStore.getState().setMode('edit');
      });
      mount('改过的内容');

      await act(async () => {
        await commands.current?.saveNow();
      });

      const state = useDocumentStore.getState();
      // 「上次与磁盘一致的内容」不许被推进——原文件确实还是原文
      expect(state.document?.content).toBe(DOC.content);
      expect(state.dirty).toBe(true);
      expect(state.saveStatus).not.toBe('saved');
      // 关页拦截必须还在：改动确实还没落到任何一个用户的文件里
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      // 提示要说得出区别，不能是「已另存为 a.md」
      const notice = useUiStore.getState().notice?.text ?? '';
      expect(notice).toContain('下载目录');
      expect(notice).toContain('原文件没有改动');
      expect(notice).not.toContain('已另存为');
    }
  });
});

describe('useAutoSave：宿主拒写（host-stale）', () => {
  afterEach(() => {
    resetHostChannel();
    vi.restoreAllMocks();
  });

  it('磁盘被别人改过而宿主拒写时，不许清脏状态、不许报「已保存」', async () => {
    /*
     * 接管页面上这是**唯一**能发现「磁盘被别人改了」的地方：文档 source 是
     * 'url'，而 useAutoRefresh 只对 'fs-handle' 轮询，整套冲突检测在这条
     * 路径上根本不运行。宿主在动手之前比对时间戳，不符就拒写，一个字节都
     * 没有落盘。
     *
     * 这里若误写成 markSaved：document.content 被推进成编辑器里的文本、
     * dirty 归零、关页拦截失效、状态栏报「已保存」——而用户的文件没被碰过，
     * 磁盘上还是别人写的那一版，编辑器里这份改动谁也救不回来。
     * 与 downloaded 分支是同一类要害。
     */
    const EMBEDDED: MarkdownDocument = { ...DOC, id: 'file:///甲.md', source: 'url' };
    setCurrentFileHandle(null);
    setHostNonce('nonce-甲');
    // 扮演宿主：收到写回请求就回一条「磁盘已被改动」
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'md-reader:write-error',
            message: '磁盘上的文件已被其它程序改动',
            stale: true,
          },
          source: window,
        }),
      );
    });
    act(() => {
      useDocumentStore.getState().setDocument(EMBEDDED);
      useDocumentStore.getState().setMode('edit');
      useDocumentStore.getState().setWritable(true);
    });
    mount('改过的内容');

    await act(async () => {
      await commands.current?.saveNow();
    });

    const state = useDocumentStore.getState();
    // 「上次与磁盘一致的内容」不许被推进——这次根本没写
    expect(state.document?.content).toBe(DOC.content);
    expect(state.dirty).toBe(true);
    expect(state.saveStatus).toBe('error');
    // 关页拦截必须还在：改动确实还悬在编辑器里
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // 提示要说清「没写成」以及为什么
    const notice = useUiStore.getState().notice?.text ?? '';
    expect(notice).toContain('已被其它程序改动');
    expect(notice).toContain('这次没有写入');
  });
});

describe('useAutoSave：关页拦截', () => {
  /** 派发一次 beforeunload，返回浏览器会不会因此弹确认 */
  function closeIntercepted(): boolean {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('有未保存改动时拦下关页', () => {
    const { handle } = fakeHandle();
    openWritableDoc(handle);
    mount('改过的内容');

    expect(useDocumentStore.getState().dirty).toBe(true);
    // 删掉 beforeunload 那个 effect，这条变红
    expect(closeIntercepted()).toBe(true);
  });

  it('没有未保存改动时不打扰用户', () => {
    const { handle } = fakeHandle();
    openWritableDoc(handle);
    mount(DOC.content);

    expect(useDocumentStore.getState().dirty).toBe(false);
    expect(closeIntercepted()).toBe(false);
  });
});

describe('useSaveCommands：回到上一个保存版本', () => {
  it('把上一个保存前的版本灌回编辑器', async () => {
    const { handle } = fakeHandle();
    openWritableDoc(handle);
    mount('改过的内容');

    // 先真的保存一次，版本缓冲里才会有「保存前」的那一版
    await act(async () => {
      await commands.current?.saveNow();
    });
    expect(useDocumentStore.getState().document?.content).toBe('改过的内容');

    act(() => {
      commands.current?.restorePreviousVersion();
    });

    await waitFor(() => {
      expect(useUiStore.getState().notice?.text).toContain('上一个保存版本');
    });
    // 编辑器里回到了保存前的原文
    const content = document.querySelector('.cm-content')?.textContent;
    expect(content).toBe(DOC.content);
  });

  it('没有更早的版本时如实说明，而不是静默无反应', () => {
    const { handle } = fakeHandle();
    openWritableDoc(handle);
    mount('改过的内容');

    act(() => {
      commands.current?.restorePreviousVersion();
    });

    expect(useUiStore.getState().notice?.text).toContain('没有更早的版本');
  });
});
