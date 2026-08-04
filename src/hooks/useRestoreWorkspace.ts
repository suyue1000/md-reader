import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { STORAGE_AREAS, STORAGE_KEYS, subscribeStorage } from '@/utils/storage';
import { useWorkspace } from './useWorkspace';

/**
 * 启动时自动恢复上次打开的文件夹。
 *
 * 「打开某个 .md 时自动带出它所在的目录」这件事，浏览器不允许直接做：
 * File System Access API 既不能从文件句柄取到父目录，也不允许在没有
 * 用户手势的情况下弹出目录选择器——这是它刻意划下的安全边界。
 *
 * 能做的是把代价压缩到**一次**：用户确认过的目录句柄存进 IndexedDB，
 * 之后每次启动（包括在浏览器里直接打开该目录下任意 .md 而触发的
 * 嵌入式阅读器）都自动恢复，用户不再需要点任何东西。
 *
 * 非交互式恢复：只在权限仍是 granted 时才扫描，绝不主动弹授权框——
 * 一打开文档就跳权限提示是很讨厌的行为。权限过期时由文件树面板
 * 给出一个明确的按钮，让用户在自己想要的时候点。
 */
export function useRestoreWorkspace(): void {
  const { restoreFolder } = useWorkspace();
  const rootName = useWorkspaceStore((state) => state.rootName);
  /** 只在本次挂载里试一次，失败不反复重试 */
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current || rootName !== null) return;
    attemptedRef.current = true;
    void restoreFolder(false);
  }, [restoreFolder, rootName]);

  /**
   * 跟进别的扩展页面里的选择结果。
   *
   * 被接管的页面里弹不出选择器（跨源 iframe 的浏览器限制），用户只能到
   * 独立的阅读器标签页去选。扩展页面共用同一个源，那边授权过的句柄
   * 这边直接可用，缺的只是一个「去看一眼」的信号——就是这个。
   */
  useEffect(
    () =>
      subscribeStorage((changes, area) => {
        if (area !== STORAGE_AREAS.workspaceSignal) return;
        if (!(STORAGE_KEYS.workspaceSignal in changes)) return;
        void restoreFolder(false);
      }),
    [restoreFolder],
  );
}
