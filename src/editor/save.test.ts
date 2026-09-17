import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocumentStore } from '@/stores/document.store';
import { getCurrentFileHandle, getFileHandleByPath, setCurrentFileHandle } from '@/utils/file-open';
import type { MarkdownDocument } from '@/types';
import { resetHostChannel, setHostNonce } from './host-write';
import { isSelfWrite } from './self-write';
import { performSave, popPreviousVersion } from './save';

/**
 * `save.ts` 是 IO 层，但它编排的东西——版本缓冲何时入栈、自写登记何时写入、
 * 另存拿到句柄后是否升格 writable——正是简报点名的「容易测试全绿但功能已断」
 * 的那类增量。这里不 mock 浏览器 API 本身，而是像 `useEditMode.test.tsx` 一样
 * 用一个满足接口形状的普通对象充当 `FileSystemFileHandle`——它比“判断为不可测
 * 而跳过”更接近真实调用链，缺点是没有验证过真正的浏览器实现（见任务报告）。
 */

/** 造一个能记录写入内容、并知道自己“文件”当前内容的假句柄 */
function fakeHandle(initialLastModified = 1000): {
  handle: FileSystemFileHandle;
  writes: string[];
  setLastModified: (n: number) => void;
} {
  const writes: string[] = [];
  let lastModified = initialLastModified;
  let pending = '';
  const handle = {
    name: 'doc.md',
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
    getFile: () =>
      Promise.resolve({
        lastModified,
      } as File),
  };
  return {
    handle: handle as unknown as FileSystemFileHandle,
    writes,
    setLastModified: (n) => {
      lastModified = n;
    },
  };
}

function setDoc(content: string): MarkdownDocument {
  const doc: MarkdownDocument = {
    id: 'doc:doc.md',
    name: 'doc.md',
    path: 'doc.md',
    content,
    size: content.length,
    lastModified: 1000,
    source: 'fs-handle',
  };
  act(() => {
    useDocumentStore.getState().setDocument(doc);
  });
  return doc;
}

afterEach(() => {
  act(() => {
    useDocumentStore.getState().reset();
  });
  setCurrentFileHandle(null);
  resetHostChannel();
  vi.restoreAllMocks();
  delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  // 排空版本缓冲，避免用例互相污染
  while (popPreviousVersion() !== null) {
    // noop
  }
});

describe('performSave：静默写回（write 分支）', () => {
  it('写盘成功后：登记自写、把旧内容推进版本缓冲', async () => {
    const { handle, writes } = fakeHandle();
    setCurrentFileHandle(handle);
    setDoc('旧内容');
    act(() => {
      useDocumentStore.getState().setWritable(true);
    });

    const outcome = await performSave('新内容', false);

    expect(outcome.kind).toBe('saved');
    expect(writes).toEqual(['新内容']);
    // 删掉 versionBuffer().push(previous) 这一行，这条断言会失败
    expect(popPreviousVersion()).toBe('旧内容');
    if (outcome.kind === 'saved') {
      // 删掉 recordSelfWrite(...) 这一行，这条断言会失败
      expect(isSelfWrite('新内容', outcome.lastModified)).toBe(true);
    }
  });

  it('内容未变时不做任何事，也不占用版本缓冲', async () => {
    const { handle, writes } = fakeHandle();
    setCurrentFileHandle(handle);
    setDoc('相同内容');
    act(() => {
      useDocumentStore.getState().setWritable(true);
    });

    const outcome = await performSave('相同内容', false);

    expect(outcome).toEqual({ kind: 'skipped' });
    expect(writes).toEqual([]);
    expect(popPreviousVersion()).toBeNull();
  });

  it('自动保存在没有写权限时静默跳过，不弹任何交互', async () => {
    const { handle, writes } = fakeHandle();
    setCurrentFileHandle(handle);
    setDoc('旧内容');
    // writable 默认为 false

    const outcome = await performSave('新内容', true);

    expect(outcome).toEqual({ kind: 'skipped' });
    expect(writes).toEqual([]);
  });
});

describe('performSave：需要重新授权（needs-permission 分支）', () => {
  it('手动保存在授权成功后照常写回，并把「刚拿到写权限」这件事交回给调用方', async () => {
    const { handle, writes } = fakeHandle();
    setCurrentFileHandle(handle);
    setDoc('旧内容');
    // writable 默认为 false，但句柄的 requestPermission 会给 granted

    const outcome = await performSave('新内容', false);

    expect(outcome.kind).toBe('saved');
    expect(writes).toEqual(['新内容']);
    if (outcome.kind === 'saved') expect(outcome.permissionGranted).toBe(true);
    /*
     * 授权跨了一个 await，因此 `performSave` **不自己写 store**：授权框弹着
     * 的时候用户可以换文档，在这里写就会给乙记上一份只对甲成立的写权限。
     * 落点在 `runSave` 的 openEpoch 守卫之后（见 useAutoSave.test.tsx
     * 「授权与另存的结果都落在 epoch 守卫之后」）。
     */
    expect(useDocumentStore.getState().writable).toBe(false);
  });

  it('静默写回（已授权）不会谎称自己申请过权限', async () => {
    const { handle } = fakeHandle();
    setCurrentFileHandle(handle);
    setDoc('旧内容');
    act(() => {
      useDocumentStore.getState().setWritable(true);
    });

    const outcome = await performSave('新内容', false);

    expect(outcome.kind).toBe('saved');
    if (outcome.kind === 'saved') expect(outcome.permissionGranted).toBe(false);
  });

  it('用户拒绝授权时返回 denied，不触碰磁盘', async () => {
    const { handle, writes } = fakeHandle();
    // 必须先让 queryPermission 报「未授权」，ensureFileWritePermission 才会
    // 走到 requestPermission 那一步——两者都是 granted 时它提前短路返回
    handle.queryPermission = () => Promise.resolve('prompt');
    handle.requestPermission = () => Promise.resolve('denied');
    setCurrentFileHandle(handle);
    setDoc('旧内容');

    const outcome = await performSave('新内容', false);

    expect(outcome).toEqual({ kind: 'denied' });
    expect(writes).toEqual([]);
    expect(useDocumentStore.getState().writable).toBe(false);
  });
});

describe('performSave：另存（save-as 分支）', () => {
  it('另存把新句柄交回调用方，而**不是**自己写进全局状态', async () => {
    /*
     * 这条是 C3 的回归用例，锁的是「`performSave` 在 await 之后不碰全局状态」
     * 这条不变量本身。
     *
     * 曾经这里直接 `setCurrentFileHandle(result.handle)`，实测后果：另存
     * 进行中换到乙，落定后「当前文件句柄」变成甲刚另存出来的那个文件，
     * 乙的下一次自动保存于是写进了甲的新文件（探针数据
     * `a.writes = [Blob, '乙改过的内容']`、`b.writes = []`）。
     * 把这两行搬回 `performSave` 里，下面三条 expect 会立刻变红。
     * 「换文档之后落点是谁」那一面由 useAutoSave.test.tsx 的集成用例扎住。
     */
    const { handle: pickedHandle } = fakeHandle();
    // canUseFilePicker() 是以 showOpenFilePicker 的存在来判定「环境支持选择器」的
    // （见 utils/env.ts），不装它 decideSaveTarget 会判成 download 而不是 save-as
    (window as { showOpenFilePicker?: unknown }).showOpenFilePicker = () => undefined;
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = () => pickedHandle;
    setCurrentFileHandle(null); // 无句柄 -> save-as
    setDoc('旧内容');

    const outcome = await performSave('新内容', false);

    expect(outcome).toEqual({ kind: 'saved-as', handle: pickedHandle, filename: 'doc.md' });
    expect(getCurrentFileHandle()).toBeNull();
    expect(getFileHandleByPath('doc.md')).toBeUndefined();
    expect(useDocumentStore.getState().writable).toBe(false);
  });

  it('用户取消另存返回 cancelled，不改动任何句柄状态', async () => {
    (window as { showOpenFilePicker?: unknown }).showOpenFilePicker = () => undefined;
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = () => {
      throw new DOMException('abort', 'AbortError');
    };
    setCurrentFileHandle(null);
    setDoc('旧内容');

    const outcome = await performSave('新内容', false);

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(getCurrentFileHandle()).toBeNull();
    expect(useDocumentStore.getState().writable).toBe(false);
  });
});

describe('performSave：弹不出保存对话框（download 分支）', () => {
  it('退到浏览器下载时如实报 downloaded，而不是混进「已另存」', async () => {
    /*
     * 这条路就是验收标准第 5 条那条路：浏览器直开 .md 时阅读器是跨源 iframe，
     * 弹不出任何选择器。文件落进下载目录，**原文件一个字节没变**——
     * 与 `saved-as` 混成一种，调用方就会照着「已保存」清脏状态（见
     * useAutoSave.test.tsx 里对应的那条）。
     *
     * 这里不装 showOpenFilePicker，`canUseFilePicker()` 因此为假，
     * `decideSaveTarget` 判成 download；`saveFile` 见不到 showSaveFilePicker
     * 就走 `<a download>`。
     */
    const createObjectURL = vi.fn(() => 'blob:stub');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    setCurrentFileHandle(null);
    setDoc('旧内容');

    const outcome = await performSave('新内容', false);

    expect(outcome).toEqual({ kind: 'downloaded', filename: 'doc.md' });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // 下载与「当前文件」是两回事，句柄不许被动
    expect(getCurrentFileHandle()).toBeNull();
    expect(useDocumentStore.getState().writable).toBe(false);
  });
});

describe('performSave：宿主代劳写回（host-write 分支）', () => {
  /** 接管页面的场景：没有本地句柄，写权限落在「宿主已授权代劳」上 */
  function embedded(content: string): void {
    setCurrentFileHandle(null);
    setHostNonce('nonce-甲');
    setDoc(content);
    act(() => {
      useDocumentStore.getState().setWritable(true);
    });
  }

  /** 扮演宿主，记下它收到的请求并回一条指定消息 */
  function hostReplies(reply: Record<string, unknown>): { requests: unknown[] } {
    const requests: unknown[] = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
      requests.push(message);
      window.dispatchEvent(new MessageEvent('message', { data: reply, source: window }));
    });
    return { requests };
  }

  it('把文本与比对基线交给宿主，成功后如实报 saved', async () => {
    embedded('旧内容');
    const { requests } = hostReplies({ type: 'md-reader:write-ok', lastModified: 2000 });

    const outcome = await performSave('新内容', false);

    expect(outcome).toEqual({ kind: 'saved', lastModified: 2000, permissionGranted: false });
    // setDoc 给的 lastModified 是 1000，它必须原样成为宿主的比对基线
    expect(requests).toEqual([
      { type: 'md-reader:write-file', nonce: 'nonce-甲', text: '新内容', baseModified: 1000 },
    ]);
  });

  it('代劳写回不谎称自己申请过写权限', async () => {
    // permissionGranted 只属于 needs-permission 那条路；报真了会让调用方
    // 把一份并不存在的本地授权记进 store
    embedded('旧内容');
    hostReplies({ type: 'md-reader:write-ok', lastModified: 2000 });

    const outcome = await performSave('新内容', false);

    expect(outcome).toMatchObject({ permissionGranted: false });
  });

  it('动磁盘之前先把旧内容存进版本缓冲', async () => {
    embedded('旧内容');
    hostReplies({ type: 'md-reader:write-ok', lastModified: 2000 });

    await performSave('新内容', false);

    expect(popPreviousVersion()).toBe('旧内容');
  });

  it('宿主拒写时版本缓冲里**仍然**留着旧内容', async () => {
    /*
     * 这条守的是顺序：push 必须发生在请求写回**之前**。若写成「成功之后
     * 才 push」，这里就什么都弹不出来——而这正是用户最需要后悔药的时刻。
     * 写失败了缓冲里多一版无害，写成功了没留就没救了。
     */
    embedded('旧内容');
    hostReplies({
      type: 'md-reader:write-error',
      message: '磁盘上的文件已被其它程序改动',
      stale: true,
    });

    const outcome = await performSave('新内容', false);

    expect(outcome).toEqual({ kind: 'host-stale', message: '磁盘上的文件已被其它程序改动' });
    expect(popPreviousVersion()).toBe('旧内容');
  });

  it('宿主报普通错误时归入 error，不混进 host-stale', async () => {
    // 两者的善后完全不同：stale 要请用户重开文档，普通错误只是这次没写成
    embedded('旧内容');
    hostReplies({ type: 'md-reader:write-error', message: '磁盘已满', stale: false });

    const outcome = await performSave('新内容', false);

    expect(outcome).toEqual({ kind: 'error', message: '磁盘已满' });
  });

  it('自动保存也走代劳这条路——停笔自动写回正是它最大的价值', async () => {
    embedded('旧内容');
    hostReplies({ type: 'md-reader:write-ok', lastModified: 2000 });

    const outcome = await performSave('新内容', true);

    expect(outcome).toMatchObject({ kind: 'saved' });
  });
});

describe('performSave：冲突未决', () => {
  /** 让 store 进入「磁盘上那份被外部改过、用户还没决断」的状态 */
  function setConflict(diskContent: string): void {
    act(() => {
      useDocumentStore.getState().setConflict({
        id: 'doc:doc.md',
        name: 'doc.md',
        path: 'doc.md',
        content: diskContent,
        size: diskContent.length,
        lastModified: 9000,
        source: 'fs-handle',
      });
    });
  }

  it('冲突挂着时自动保存不写盘，磁盘上那份外部改动原样留着', async () => {
    /*
     * C1 回归。不修的话：冲突条弹出后用户敲一个字，800ms 后外部编辑器写的
     * 那份被静默覆盖，而版本缓冲里推进的是冲突**之前**的内容——磁盘上那份
     * 外部改动没有任何副本，也没有回收站。
     */
    const { handle, writes } = fakeHandle();
    setCurrentFileHandle(handle);
    setDoc('旧内容');
    act(() => {
      useDocumentStore.getState().setWritable(true);
    });
    setConflict('外部编辑器写的内容');

    const outcome = await performSave('我又敲的内容', true);

    expect(outcome).toEqual({ kind: 'conflict-pending' });
    expect(writes).toEqual([]);
    // 一个字节都没写，也就不该在版本缓冲里留下任何东西
    expect(popPreviousVersion()).toBeNull();
  });

  it('冲突挂着时手动保存同样不写盘', async () => {
    const { handle, writes } = fakeHandle();
    setCurrentFileHandle(handle);
    setDoc('旧内容');
    act(() => {
      useDocumentStore.getState().setWritable(true);
    });
    setConflict('外部编辑器写的内容');

    expect(await performSave('我又敲的内容', false)).toEqual({ kind: 'conflict-pending' });
    expect(writes).toEqual([]);
  });

  it('用户决断完之后照常写回', async () => {
    const { handle, writes } = fakeHandle();
    setCurrentFileHandle(handle);
    setDoc('旧内容');
    act(() => {
      useDocumentStore.getState().setWritable(true);
    });
    setConflict('外部编辑器写的内容');
    act(() => {
      useDocumentStore.getState().clearConflict();
    });

    expect((await performSave('我又敲的内容', true)).kind).toBe('saved');
    expect(writes).toEqual(['我又敲的内容']);
  });
});

describe('版本缓冲跟着「这一次打开」走', () => {
  it('换了文档之后，上一篇的保存前版本不再弹得出来', async () => {
    /*
     * C2 回归。缓冲是模块级单例，`setDocument` / `reset` 都不清它，于是甲
     * 保存一次之后换到乙，`popPreviousVersion()` 仍返回甲的正文——而工具栏
     * 的「回到上一个保存版本」只按 `mode === 'edit'` 置灰，在乙上点一下，
     * 甲的正文就进了乙的编辑器，800ms 后写进乙的文件。
     * 去掉 `versionBuffer()` 里那段按 openEpoch 清空的代码，这条会变红。
     */
    const { handle } = fakeHandle();
    setCurrentFileHandle(handle);
    setDoc('甲的原文');
    act(() => {
      useDocumentStore.getState().setWritable(true);
    });
    await performSave('甲改过的内容', false);
    // 还在甲这一次打开里，后悔药在
    expect(popPreviousVersion()).toBe('甲的原文');

    await performSave('甲又改了一次', false);
    // 换到乙（`setDocument` 自增 openEpoch）
    setDoc('乙的原文');

    expect(popPreviousVersion()).toBeNull();
  });

  it('同一篇文档重新打开也算新的一次打开，不留上一次的版本', async () => {
    const { handle } = fakeHandle();
    setCurrentFileHandle(handle);
    setDoc('原文');
    act(() => {
      useDocumentStore.getState().setWritable(true);
    });
    await performSave('改过的内容', false);

    // 同样的 id、同样的路径，只是又打开了一次：编辑器里已经是磁盘上的内容，
    // 上一次打开留下的「保存前版本」对它不再成立
    setDoc('原文');

    expect(popPreviousVersion()).toBeNull();
  });
});

describe('performSave：无文档', () => {
  it('没有打开的文档时直接跳过', async () => {
    const outcome = await performSave('任意', false);
    expect(outcome).toEqual({ kind: 'skipped' });
  });
});
