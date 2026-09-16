import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '@/stores/document.store';
import { useUiStore } from '@/stores/ui.store';
import { setCurrentFileHandle } from '@/utils/file-open';
import { useEditMode } from './useEditMode';

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
