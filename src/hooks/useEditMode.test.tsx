import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetHostChannel, setHostNonce } from '@/editor/host-write';
import { useDocumentStore } from '@/stores/document.store';
import { useUiStore } from '@/stores/ui.store';
import type { MarkdownDocument } from '@/types';
import { setCurrentFileHandle } from '@/utils/file-open';
import { useEditMode } from './useEditMode';

/** 接管页面打开的文档：没有句柄，source 是 url */
const EMBEDDED: MarkdownDocument = {
  id: 'file:///甲.md',
  name: '甲.md',
  path: '/甲.md',
  content: '页面上那份正文',
  size: 21,
  lastModified: 0,
  source: 'url',
};

/**
 * 扮演宿主页面：收到请求后立刻回一条指定的消息。
 *
 * `requestWriteGrant` 先登记落点再 postMessage，所以在 postMessage 的同步
 * 实现里派发回应，落点已经就绪。`beforeReply` 用来在回应**之前**动 store，
 * 复刻「授权框弹着的时候用户换了文档」这一情形。
 */
function hostReplies(reply: Record<string, unknown>, beforeReply?: () => void): void {
  vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {
    beforeReply?.();
    window.dispatchEvent(new MessageEvent('message', { data: reply, source: window }));
  });
}

/** 记下权限申请次数的文件句柄替身 */
function permissionHandle(
  query: PermissionState,
  request: PermissionState,
): { handle: FileSystemFileHandle; requests: () => number } {
  let requests = 0;
  const fake = {
    queryPermission: () => Promise.resolve(query),
    requestPermission: () => {
      requests += 1;
      return Promise.resolve(request);
    },
  };
  return { handle: fake as unknown as FileSystemFileHandle, requests: () => requests };
}

/** 把 hook 的返回值暴露给用例；在 effect 里写，渲染期间改外部变量是 React 禁止的 */
const controls: { current: ReturnType<typeof useEditMode> | null } = { current: null };

function Probe(): React.JSX.Element {
  const value = useEditMode();
  useEffect(() => {
    controls.current = value;
  });
  return <div />;
}

async function enterEdit(): Promise<void> {
  await act(async () => {
    await controls.current?.enterEdit();
  });
}

describe('useEditMode', () => {
  afterEach(() => {
    setCurrentFileHandle(null);
    controls.current = null;
    resetHostChannel();
    vi.restoreAllMocks();
    act(() => {
      useDocumentStore.getState().reset();
      useUiStore.getState().dismissNotice();
    });
  });

  it('句柄已授权时进入编辑态并置 writable，不再申请', async () => {
    const { handle, requests } = permissionHandle('granted', 'denied');
    setCurrentFileHandle(handle);
    render(<Probe />);

    await enterEdit();

    expect(useDocumentStore.getState().mode).toBe('edit');
    expect(useDocumentStore.getState().writable).toBe(true);
    expect(requests()).toBe(0);
    expect(useUiStore.getState().notice).toBeNull();
  });

  it('尚未授权时在这一下申请写权限，拿到就置 writable', async () => {
    const { handle, requests } = permissionHandle('prompt', 'granted');
    setCurrentFileHandle(handle);
    render(<Probe />);

    await enterEdit();

    // 这是整条保存链路上唯一一次能申请写权限的机会，它必须真的发生
    expect(requests()).toBe(1);
    expect(useDocumentStore.getState().writable).toBe(true);
    expect(useDocumentStore.getState().mode).toBe('edit');
  });

  it('权限被拒仍然进入编辑态，只是 writable 为 false 并说明按 ⌘S 会再申请一次', async () => {
    const { handle } = permissionHandle('prompt', 'denied');
    setCurrentFileHandle(handle);
    render(<Probe />);

    await enterEdit();

    expect(useDocumentStore.getState().mode).toBe('edit');
    expect(useDocumentStore.getState().writable).toBe(false);
    /*
     * 文案锁的是一条**现在真的兑现得了**的承诺：手动保存握着句柄时会走
     * `performSave` 的 needs-permission 分支，在按键这个用户手势里补发一次
     * `requestPermission`。⌘S 接上之前这里只能让用户去「导出 Markdown」，
     * 那句旧文案随之作废（见 `useEditMode` 的说明）。
     */
    expect(useDocumentStore.getState().writable).toBe(false);
    expect(useUiStore.getState().notice?.text).toContain('写入权限');
    expect(useUiStore.getState().notice?.text).toContain('再申请');
  });

  it('没有文件句柄时照样能编辑，writable 为 false', async () => {
    setCurrentFileHandle(null);
    render(<Probe />);

    await enterEdit();

    expect(useDocumentStore.getState().mode).toBe('edit');
    expect(useDocumentStore.getState().writable).toBe(false);
    expect(useUiStore.getState().notice?.text).toContain('另存');
  });

  /*
   * 以下是「浏览器直接打开 .md、被内容脚本接管」这条路径：阅读器是跨源
   * iframe，自己拿不到也换不到句柄，只能请宿主页面代劳（见 editor/host-write.ts）。
   */
  describe('宿主代劳授权（接管的 file:// 页面）', () => {
    /** 布置成接管场景：没有本地句柄，但握着宿主令牌 */
    function embedded(): void {
      setCurrentFileHandle(null);
      setHostNonce('nonce-甲');
      act(() => {
        useDocumentStore.getState().setDocument(EMBEDDED);
      });
    }

    it('授权通过且磁盘内容一致时置 writable，正文不动', async () => {
      embedded();
      hostReplies({
        type: 'md-reader:write-granted',
        content: '页面上那份正文',
        lastModified: 777,
      });
      render(<Probe />);

      await enterEdit();

      expect(useDocumentStore.getState().mode).toBe('edit');
      expect(useDocumentStore.getState().writable).toBe(true);
      expect(useDocumentStore.getState().document?.content).toBe('页面上那份正文');
      // 基线必须对齐到磁盘的时间戳，否则第一次写回就会被宿主判成冲突
      expect(useDocumentStore.getState().document?.lastModified).toBe(777);
    });

    it('磁盘内容与页面上那份不一致时，以磁盘为准重新载入', async () => {
      /*
       * 页面那份取自浏览器渲染出来的 <pre>，未必逐字节等于磁盘（换行、BOM
       * 都可能被归一），文件也可能在打开之后被别的程序改过。不以磁盘为准，
       * 用户什么都没改、按一下保存就会把一份被变换过的文本盖回原文——
       * 而「保存不做任何文本规整」是这条链路的底线。
       */
      embedded();
      hostReplies({
        type: 'md-reader:write-granted',
        content: '磁盘上真正的正文',
        lastModified: 888,
      });
      render(<Probe />);

      await enterEdit();

      expect(useDocumentStore.getState().document?.content).toBe('磁盘上真正的正文');
      expect(useDocumentStore.getState().document?.lastModified).toBe(888);
      expect(useDocumentStore.getState().writable).toBe(true);
      expect(useUiStore.getState().notice?.text).toContain('磁盘');
    });

    it('授权被拒时仍可编辑，writable 为 false 并说明原因', async () => {
      embedded();
      hostReplies({
        type: 'md-reader:write-denied',
        reason: '选中的是 乙.md，与当前文档 甲.md 不是同一个文件',
        cancelled: false,
      });
      render(<Probe />);

      await enterEdit();

      expect(useDocumentStore.getState().mode).toBe('edit');
      expect(useDocumentStore.getState().writable).toBe(false);
      expect(useUiStore.getState().notice?.text).toContain('未获得写回授权');
    });

    it('用户自己取消选择时不弹提示——那不是故障', async () => {
      embedded();
      hostReplies({ type: 'md-reader:write-denied', reason: '已取消授权', cancelled: true });
      render(<Probe />);

      await enterEdit();

      expect(useDocumentStore.getState().mode).toBe('edit');
      expect(useDocumentStore.getState().writable).toBe(false);
      expect(useUiStore.getState().notice).toBeNull();
    });

    it('授权期间换了文档：结果一个字都不落到新文档头上', async () => {
      /*
       * 这条守的是 openEpoch 闩锁。文件选择器是用户可能盯着看很久的系统
       * 对话框，弹着的时候完全可以换一篇文档（切换前那个未保存确认框就是
       * 入口）。不核对的话，那次 applyRefreshedDocument 会把**甲的正文**
       * 替换进乙，而乙的下一次保存就把甲的内容写进了乙的文件——不可逆，
       * 且没有回收站。同一类事故在另存那条路上真的发生过。
       */
      const OTHER: MarkdownDocument = { ...EMBEDDED, id: 'file:///乙.md', content: '乙的正文' };
      embedded();
      hostReplies(
        { type: 'md-reader:write-granted', content: '甲在磁盘上的正文', lastModified: 999 },
        () => {
          // 回应落点之前换文档，复刻「授权框弹着时用户切走了」
          useDocumentStore.getState().setDocument(OTHER);
        },
      );
      render(<Probe />);

      await enterEdit();

      const state = useDocumentStore.getState();
      expect(state.document?.id).toBe('file:///乙.md');
      // 甲的正文绝不能落到乙头上
      expect(state.document?.content).toBe('乙的正文');
      // 只对甲成立的写权限也不能记到乙头上
      expect(state.writable).toBe(false);
    });
  });

  it('退出编辑态回到阅读态，但不丢掉已经拿到的写权限', async () => {
    const { handle } = permissionHandle('granted', 'granted');
    setCurrentFileHandle(handle);
    render(<Probe />);

    await enterEdit();
    act(() => {
      controls.current?.leaveEdit();
    });

    expect(useDocumentStore.getState().mode).toBe('read');
    // 浏览器不会因为用户退出编辑就收回授权，清掉只会让下次白弹一次提示
    expect(useDocumentStore.getState().writable).toBe(true);
  });
});
