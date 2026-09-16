### Task 1: 安装 CodeMirror 依赖并验证构建

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`（`chunkSizeWarningLimit` 上方的注释）
- Test: `src/editor/smoke.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 可 import 的 `@codemirror/*` 包

- [ ] **Step 1: 安装依赖**

```bash
npm install @codemirror/state@^6 @codemirror/view@^6 @codemirror/commands@^6 \
  @codemirror/language@^6 @codemirror/lang-markdown@^6 @codemirror/search@^6 \
  @lezer/highlight@^1
```

- [ ] **Step 2: 写冒烟测试，确认包能在 jsdom 下工作**

创建 `src/editor/smoke.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';

describe('CodeMirror 依赖', () => {
  it('能创建 EditorState 并按行读回文本', () => {
    const state = EditorState.create({ doc: '# 标题\n\n正文' });
    expect(state.doc.lines).toBe(3);
    expect(state.doc.line(1).text).toBe('# 标题');
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run src/editor/smoke.test.ts`
Expected: PASS

- [ ] **Step 4: 更新 vite 配置里那段过期的注释**

`vite.config.ts` 中 `chunkSizeWarningLimit` 的注释现在写着「viewer 入口只有 84KB」。CodeMirror 进入首屏后这句不再成立，替换为：

```ts
    /**
     * 提高「分包过大」的警告阈值。
     *
     * 超过阈值的分包分两类：一是第三方的**懒加载**负载（Shiki 的单个语言语法、
     * Mermaid 的图表引擎与 cytoscape 布局），只有文档里真的出现对应语言或图表
     * 时才会被请求；二是 viewer 入口本身——CodeMirror 是唯一的文档视图，
     * 无法懒加载，入口因此在 350KB 量级。
     *
     * 这是本地扩展，资源从磁盘加载、零网络请求，这个量级不影响启动。
     * 把阈值调到实际量级，让警告重新变成「有东西不对」的信号。
     */
    chunkSizeWarningLimit: 800,
```

- [ ] **Step 5: 验证构建通过**

Run: `npm run build`
Expected: 构建成功，无报错

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json vite.config.ts src/editor/smoke.test.ts
git commit -m "feat: 引入 CodeMirror 6 依赖"
```

---

