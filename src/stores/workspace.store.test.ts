import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspace.store';
import { createMemoryStorageDriver, setStorageDriver } from '@/utils/storage';
import type { FileTreeNode, RecentFileEntry } from '@/types';

/** 构造一条最近打开记录 */
function recent(id: string, openedAt = Date.now()): RecentFileEntry {
  return { id, name: id.split('/').pop() ?? id, path: id.replace(/^doc:/, ''), openedAt };
}

/** 构造一个文件节点 */
function node(path: string): FileTreeNode {
  return { id: path, name: path, kind: 'file', depth: 0 };
}

describe('workspace store', () => {
  beforeEach(() => {
    setStorageDriver(createMemoryStorageDriver());
    useWorkspaceStore.setState({
      rootName: null,
      tree: [],
      scanning: false,
      truncated: false,
      fileCount: 0,
      recentFiles: [],
      favorites: [],
      availablePaths: new Set<string>(),
      hydrated: false,
    });
  });

  describe('最近打开', () => {
    it('新条目排在最前', () => {
      useWorkspaceStore.getState().addRecent(recent('doc:a.md'));
      useWorkspaceStore.getState().addRecent(recent('doc:b.md'));
      expect(useWorkspaceStore.getState().recentFiles.map((e) => e.id)).toEqual([
        'doc:b.md',
        'doc:a.md',
      ]);
    });

    it('重复打开同一文件时提到最前而不是产生重复条目', () => {
      const store = useWorkspaceStore.getState();
      store.addRecent(recent('doc:a.md'));
      store.addRecent(recent('doc:b.md'));
      useWorkspaceStore.getState().addRecent(recent('doc:a.md'));

      const ids = useWorkspaceStore.getState().recentFiles.map((e) => e.id);
      expect(ids).toEqual(['doc:a.md', 'doc:b.md']);
    });

    it('超过上限时截断', () => {
      for (let i = 0; i < 25; i++) {
        useWorkspaceStore.getState().addRecent(recent(`doc:${String(i)}.md`));
      }
      expect(useWorkspaceStore.getState().recentFiles).toHaveLength(20);
      // 最新的在最前，最旧的被丢掉
      expect(useWorkspaceStore.getState().recentFiles[0]?.id).toBe('doc:24.md');
    });

    it('清空后列表为空', () => {
      useWorkspaceStore.getState().addRecent(recent('doc:a.md'));
      useWorkspaceStore.getState().clearRecent();
      expect(useWorkspaceStore.getState().recentFiles).toEqual([]);
    });
  });

  describe('收藏', () => {
    it('切换收藏状态', () => {
      useWorkspaceStore.getState().toggleFavorite('doc:a.md');
      expect(useWorkspaceStore.getState().favorites).toEqual(['doc:a.md']);
      useWorkspaceStore.getState().toggleFavorite('doc:a.md');
      expect(useWorkspaceStore.getState().favorites).toEqual([]);
    });
  });

  describe('可用路径', () => {
    it('打开文件夹时整体替换', () => {
      useWorkspaceStore.getState().addAvailablePath('old.md');
      useWorkspaceStore.getState().setWorkspace({
        rootName: 'docs',
        tree: [node('a.md')],
        fileCount: 1,
        truncated: false,
        paths: ['a.md'],
      });

      const { availablePaths } = useWorkspaceStore.getState();
      // 扫描会重建句柄表，旧路径的句柄已失效，必须一并作废
      expect(availablePaths.has('a.md')).toBe(true);
      expect(availablePaths.has('old.md')).toBe(false);
    });

    it('重复登记同一路径不产生新的 Set', () => {
      useWorkspaceStore.getState().addAvailablePath('a.md');
      const first = useWorkspaceStore.getState().availablePaths;
      useWorkspaceStore.getState().addAvailablePath('a.md');
      // 引用不变，依赖它的 useMemo 不会白白重算
      expect(useWorkspaceStore.getState().availablePaths).toBe(first);
    });

    it('关闭文件夹后全部作废', () => {
      useWorkspaceStore.getState().setWorkspace({
        rootName: 'docs',
        tree: [],
        fileCount: 1,
        truncated: false,
        paths: ['a.md'],
      });
      useWorkspaceStore.getState().clearWorkspace();

      expect(useWorkspaceStore.getState().availablePaths.size).toBe(0);
      expect(useWorkspaceStore.getState().rootName).toBeNull();
    });
  });
});
