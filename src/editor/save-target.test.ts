import { describe, expect, it } from 'vitest';
import { decideSaveTarget, type SaveContext } from './save-target';

const handle = {} as FileSystemFileHandle;

const context = (overrides: Partial<SaveContext> = {}): SaveContext => ({
  dirty: true,
  handle,
  writable: true,
  canUsePicker: true,
  automatic: false,
  conflictPending: false,
  ...overrides,
});

describe('decideSaveTarget', () => {
  it('没有改动时什么都不做', () => {
    expect(decideSaveTarget(context({ dirty: false }))).toEqual({ kind: 'clean' });
  });

  it('有句柄且有写权限时静默写回', () => {
    expect(decideSaveTarget(context())).toEqual({ kind: 'write', handle });
  });

  it('有句柄但没写权限时，手动保存要求重新授权', () => {
    expect(decideSaveTarget(context({ writable: false }))).toEqual({
      kind: 'needs-permission',
      handle,
    });
  });

  it('无句柄时手动保存走另存', () => {
    expect(decideSaveTarget(context({ handle: null, writable: false }))).toEqual({
      kind: 'save-as',
    });
  });

  it('弹不出选择器时（跨源 iframe）退到下载', () => {
    expect(
      decideSaveTarget(context({ handle: null, writable: false, canUsePicker: false })),
    ).toEqual({ kind: 'download' });
  });

  it('自动保存在无写权限时不做任何事——不能每 800ms 弹一次对话框', () => {
    expect(decideSaveTarget(context({ writable: false, automatic: true }))).toEqual({
      kind: 'clean',
    });
    expect(
      decideSaveTarget(context({ handle: null, writable: false, automatic: true })),
    ).toEqual({ kind: 'clean' });
  });

  it('自动保存在有写权限时正常写回', () => {
    expect(decideSaveTarget(context({ automatic: true }))).toEqual({ kind: 'write', handle });
  });
});

describe('decideSaveTarget：冲突未决', () => {
  /*
   * 这几条守的是整条分支里唯一一处对**第三方数据**的不可逆破坏：
   * 磁盘上那份是别的编辑器写的，而本应用里没有它的任何副本
   * （版本缓冲推进的是冲突之前的内容），写下去就再也找不回来了。
   */

  it('冲突未决时自动保存一个字节都不写——哪怕句柄和写权限都在', () => {
    expect(decideSaveTarget(context({ automatic: true, conflictPending: true }))).toEqual({
      kind: 'conflict',
    });
  });

  it('冲突未决时手动保存同样不写：⌘S 也会抹掉磁盘上那份', () => {
    expect(decideSaveTarget(context({ conflictPending: true }))).toEqual({ kind: 'conflict' });
  });

  it('冲突未决且没有句柄时也不弹另存——先决断，再谈存到哪', () => {
    expect(
      decideSaveTarget(context({ handle: null, writable: false, conflictPending: true })),
    ).toEqual({ kind: 'conflict' });
  });

  it('用户决断完（冲突清空）之后照常写回，不是一直封着', () => {
    expect(decideSaveTarget(context({ automatic: true, conflictPending: false }))).toEqual({
      kind: 'write',
      handle,
    });
  });

  it('本来就没有改动时仍然报 clean，冲突不改变这一点', () => {
    expect(decideSaveTarget(context({ dirty: false, conflictPending: true }))).toEqual({
      kind: 'clean',
    });
  });
});
