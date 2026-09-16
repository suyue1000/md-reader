### Task 14: 保存决策（纯函数）

**Files:**
- Create: `src/editor/save-target.ts`
- Test: `src/editor/save-target.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export type SaveTarget =
  | { kind: 'clean' }
  | { kind: 'write'; handle: FileSystemFileHandle }
  | { kind: 'needs-permission'; handle: FileSystemFileHandle }
  | { kind: 'save-as' }
  | { kind: 'download' };

export interface SaveContext {
  dirty: boolean;
  handle: FileSystemFileHandle | null;
  writable: boolean;
  canUsePicker: boolean;
  /** 由定时器触发（true）还是用户按下 ⌘S（false） */
  automatic: boolean;
}

export function decideSaveTarget(context: SaveContext): SaveTarget;
```

- [ ] **Step 1: 写失败的测试**

创建 `src/editor/save-target.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { decideSaveTarget, type SaveContext } from './save-target';

const handle = {} as FileSystemFileHandle;

const context = (overrides: Partial<SaveContext> = {}): SaveContext => ({
  dirty: true,
  handle,
  writable: true,
  canUsePicker: true,
  automatic: false,
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/editor/save-target.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

创建 `src/editor/save-target.ts`：

```ts
/**
 * 保存要写到哪里。
 *
 * 用可辨识联合而不是「返回 null + 抛异常」：这几种结果全都是**预期内**的，
 * 各自需要不同的界面反馈——需要重新授权和无法写回原文件，对用户来说是
 * 两件完全不同的事。这与 `FileProbeResult` 是同一套取舍。
 */
export type SaveTarget =
  /** 无改动，什么都不做 */
  | { kind: 'clean' }
  /** 静默写回原文件 */
  | { kind: 'write'; handle: FileSystemFileHandle }
  /** 有句柄但写权限未授予，需要用户手势重新申请 */
  | { kind: 'needs-permission'; handle: FileSystemFileHandle }
  /** 无句柄，弹保存对话框另存 */
  | { kind: 'save-as' }
  /** 连保存对话框都弹不出（跨源 iframe），退到浏览器下载 */
  | { kind: 'download' };

export interface SaveContext {
  dirty: boolean;
  handle: FileSystemFileHandle | null;
  writable: boolean;
  canUsePicker: boolean;
  /** 由定时器触发（true）还是用户按下 ⌘S（false） */
  automatic: boolean;
}

/**
 * 决定这次保存该走哪条路。
 *
 * 核心的一条规则：**自动保存只在能静默写回时才动作**。没有写权限时，
 * 剩下的每条路（重新授权、另存对话框、触发下载）都需要用户参与，
 * 而自动保存每 800ms 就来一次——那会变成一台对话框机关枪。
 */
export function decideSaveTarget(context: SaveContext): SaveTarget {
  if (!context.dirty) return { kind: 'clean' };

  if (context.handle && context.writable) {
    return { kind: 'write', handle: context.handle };
  }

  // 到这里说明写不回原文件，后续每条路都需要用户参与
  if (context.automatic) return { kind: 'clean' };

  if (context.handle) return { kind: 'needs-permission', handle: context.handle };
  return context.canUsePicker ? { kind: 'save-as' } : { kind: 'download' };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/editor/save-target.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/editor/save-target.ts src/editor/save-target.test.ts
git commit -m "feat: 保存决策"
```

---

