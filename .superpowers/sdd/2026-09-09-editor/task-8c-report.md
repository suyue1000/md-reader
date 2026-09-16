# Task 8c 报告（控制方代写 · 实现者被用户中止）

实现者子代理在完成代码改动后、进行验收实测之前被用户主动停止，不可恢复，其工作按取消处理。
工作树中留有完整改动，控制方实跑验证后代为提交，以免成果丢失。

## 控制方实跑的验证

npm run verify 全绿：typecheck 无输出、lint 无输出、vitest 39 文件 / 382 测试通过。
（基线：Task 8b 结束时为 35 文件 / 335 测试。）

## 改动清单

新增：
- src/editor/block-height.ts（+ 测试）—— 缺陷一的 estimatedHeight 估算
- src/utils/scroll-settle.ts（+ 测试）—— 简报未要求，实现者自行引入，用途未留说明
- src/components/toc/TocPanel.test.tsx
- src/hooks/useEmbeddedDocument.test.ts

修改：live-preview.ts、block-cache.ts、useReadingPosition.ts、usePendingAnchor.ts、
useRelativeLinks.ts、useScrollSpy.ts、document.store.ts、useEmbeddedDocument.ts、
TocPanel.tsx、test/setup.ts 及相应测试

## 【重要】未完成的部分

**简报的五条验收判据，一条都没有实测。** 实现者在做到这一步之前被中止。

1. 带 fenced 代码块的文档，目录点击跳转 —— 未验（这是缺陷一的直接判据）
2. 带 Shiki 代码块的文档，锚点落点与高亮 —— 未验（且这本就是一个已知盲区）
3. 地址栏 hash 同步 + 嵌入模式宿主同步 —— 未验
4. 回归：同文档先带锚点后不带锚点重开 —— 未验
5. 回归：闩锁是否仍然完好 —— 未验

**回归测试的效力验证（撤销修复后是否真的失败）也未进行。**

## 信息损失

实现者未留下任何自述报告，以下问题无人回答：
- estimatedHeight 最终采用的估算策略与依据
- scroll-settle.ts 为何需要（简报未要求）
- 为何改动了 document.store.ts / useEmbeddedDocument.ts / useScrollSpy.ts / TocPanel.tsx
  这四个简报未点名的文件

以上均需在后续审查中由审查者从代码反推，或重新验证。

## 风险提示

本项目已三次出现「npm run verify 全绿而功能实际是坏的」：目录高亮、锚点跳转、
锚点被阅读位置覆盖，三次都是在浏览器里才发现。因此**本次提交的绿灯不构成
「三条缺陷已修复」的证据**，只构成「代码可编译、单测通过」的证据。
