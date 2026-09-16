### Task 18: 收尾——文档与产品文案

**Files:**
- Modify: `README.md`
- Modify: `STORE.md`
- Modify: `public/_locales/zh_CN/messages.json`（若扩展描述提到「阅读器」）
- Modify: `package.json`（`description`）

- [ ] **Step 1: 核对所有对外文案**

Run: `grep -rn "只做一件事\|阅读器\|好看、好读" README.md STORE.md package.json public/_locales/`
把「只读」的定位描述找齐。

- [ ] **Step 2: 更新 README 的功能表**

在「主要功能」表格里新增一行，并修订顶部的一句话定位：

```markdown
| ✏️ **就地编辑** | 按 `⌘E` 进入编辑，正文保持渲染态，只有正在改的那一段显示 Markdown 源码；改完自动写回原文件，**除改动处外全文逐字节不变** |
```

「安装」与「使用方法」两节补一句写入权限的说明：第一次点「编辑」时浏览器会请求写入权限，拒绝后仍可编辑，但只能另存。

- [ ] **Step 3: 更新 STORE.md**

商店描述里补上编辑能力，并保留「不联网、不上传」的承诺——编辑功能没有削弱它，这一点值得明说。

- [ ] **Step 4: 检查隐私声明是否仍然准确**

Run: `grep -rn "网络请求\|不上传\|零数据收集" README.md STORE.md`
确认新增的编辑与保存链路没有引入任何网络行为（CodeMirror 全部本地打包，写盘走 File System Access API）。若声明中有「只读」字样，改掉。

- [ ] **Step 5: 全量验证与打包**

Run: `npm run verify && npm run package`
Expected: 全部通过，产出扩展包

- [ ] **Step 6: 逐条走一遍 spec 的验收标准**

打开 `docs/superpowers/specs/2026-09-09-editor-design.md` 的「验收标准」一节，7 条逐条核对并记录结果。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "docs: 更新编辑能力相关文案"
```

---

## 自查记录

写完后对照 spec 逐节核对的结果：

**Spec 覆盖**

| Spec 章节 | 对应任务 |
| --- | --- |
| 块级实时预览：解析与切块 | Task 2、3 |
| 块级实时预览：装饰规则 | Task 5 |
| 块级实时预览：增量与缓存 | Task 4、6 |
| 保存：状态模型 | Task 13、17 |
| 保存：写权限时机 | Task 13 |
| 保存：保存决策 | Task 14 |
| 保存：自写回环与冲突 | Task 15、16 |
| 保存：版本安全网 | Task 15、17 |
| 保存：降级链 | Task 14、15 |
| 迁移：TOC / Scroll Spy / 跳转 | Task 8 |
| 迁移：查找 | Task 9 |
| 迁移：阅读位置 | Task 7 |
| 迁移：相对链接 | Task 6（`enhanceBlock` 里的 `rebaseRelativeUrls`） |
| 迁移：导出 / 打印 | Task 10 |
| 迁移：状态栏 | Task 11、17 |
| 涉及的类型改动 | Task 7（`ReadingPosition`）、8（`TocNode`）、11（`RenderStages`） |
| 设置与快捷键 | Task 12、13、17 |
| 测试策略 | 各任务的 TDD 步骤 |
| 风险 1：首屏体积 | Task 1 Step 4 |
| 风险 2：无句柄自动保存 | Task 14、17 |

**修正记录**

- Task 3 定义的 `LineHeading` 与 `markdown/toc.ts` 的 `FlatHeading` 在 Task 8 之后完全重合，已在 Task 8 Step 3 明确要求删除重复定义并收敛到 `FlatHeading`。留两份「标题该长什么样」的规则迟早分岔。
- Task 5 初稿里的 `activeCache` 是模块级单例，同时存在两个编辑器实例时会串味，已在同一步骤里给出用 `ViewPlugin.fromClass` 闭包传参的收尾写法。
- Task 15 的另存需要拿回新句柄才能让自动保存恢复，而现有 `saveFile` 不返回句柄，已补上对 `export/download.ts` 的改动说明。
- `src/utils/auto-refresh.ts` 的 `decideRefreshAction` 与新的 `decideRefresh` 是包含关系，已在 Task 16 明确删除旧的那份并搬走仍有价值的用例。
