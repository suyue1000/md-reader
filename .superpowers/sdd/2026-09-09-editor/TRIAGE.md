# 最终全分支审查 · 分诊清单

由控制方从 ledger 汇总。最终审查应对下列各项判断：哪些必须在合入前修，哪些可以带着走。

## 一、推迟的 Minor（各任务审查发现、当时判定不阻塞）

- 100:Task 3: minor (deferred): block-render.ts 未注释说明「为何逐块 render 时读 env 是安全的」——未来若引入在 render 阶段写 env 的插件会踩坑
- 101:Task 3: minor (deferred): contract.ts 的 instance() 注释未提示返回的是**共享**实例，调用方 .use() 或改 renderer.rules 会污染所有共用同 signature 的路径
- 102:Task 3: minor (deferred): 无用例直接断言 trailing 块的 trailing===true 与 key 格式，裁决 B 的代码路径只被间接覆盖
- 111:Task 4: minor (deferred): acquire 缺文档注释，「命中时忽略传入 html」这一行为未说明
- 112:Task 4: minor (deferred): 「相同键必然内容相同」这个载重假设未在注释中写明，被违反时会静默使用旧内容
- 113:Task 4: minor (deferred): 未覆盖 capacity=0/1 的边界
- 121:Task 5: minor (deferred): 越界保护未覆盖 endLine 下界，依赖 block-slice 的「块至少跨 1 行」不变量，无测试兜底
- 122:Task 5: minor (deferred): 测试用例未注释标注各自覆盖的边界值，边界覆盖是顺带命中而非有意设计
- 224:Task 7: minor (deferred): settle-with-timeout 中 race 落败一侧的 setTimeout 未清理，会多挂一个最长 5s 的空定时器
- 246:Task 8: minor (deferred): EditorContext 首个用例是正向对照，换成不做任何过滤的实现也能通过
- 247:Task 8: minor (deferred): useScrollSpy 依赖 flat，而 setToc 每轮块渲染产出新数组 → 打字时每 200ms 拆装一次 scroll 监听与 ResizeObserver
- 248:Task 8: minor (deferred): lineOffset 给死代码打补丁；splitSource 内部本有 startLine 却丢弃，重新 split('\n') 多一次全文扫描
- 264:Task 8: minor (deferred): reset()（关闭文档）不清 pendingAnchor，与新加的 setDocument 清锚点不对称；当前无害（任何下一篇文档都走 setDocument）
- 361:Task 8d: minor (deferred): 新常量值本身无任何用例锁定，表格用例上界从 160 放宽到 220；MarkdownEditor.test.tsx JSX 属性里的 \n 未转义；live-preview.ts:141 prettier 换行属范围外格式改动
- 400:Task 8e: minor (deferred): 序号无上界说明；目录跳转后落点不再有增强后校正（既有行为被固化）
- 412:Task 8e: minor (deferred): ReaderPage.test.tsx 的假 view 为了让同住一屋的 useScrollSpy 不抛，多塞了 documentTop/lineBlockAtHeight/state.doc.lineAt 三个成员——一处「测 A 却要喂 B」的耦合
- 448:Task 9: minor (deferred): 编辑态 characterData 每帧全量重建索引未验证；activeMatchRange 为 null 时无条件滚+记导航（即便目标已在屏上）；locateActive 为 null 时静默不画当前命中层；自动刷新/换文档会记一次非用户发起的导航（旧实现同形状且更频繁，非本次回归）；仅 1 处命中时「下一处」因 React bail out 不回中；countMatches 无生产调用方；活动块 rangesInBlock 每次导航算两遍
- 679:Task 13: minor (deferred): `dragging===null` 的边界（点击坐标落在残留旧选区 rect 内时首次 get 走 posAtCoords 而非锚点）——非本轮引入，**从未有人实测过**

## 二、明确移交最终审查分诊的项

- 104:Ruling R12 (与 R11 相反的取舍): Task 3 的三条 Minor 全部推迟，不并入修复循环 — 与 T2 不同，这三条都是纯文档/覆盖增强，且无功能风险；T2 那次破例是因为 block-slice 是地基且改动零风险，若每次都破例就等于取消了"Minor 不进循环"这条规则 — 代价：这三条要等到最终审查的修复波才处理，期间代码里缺两句有价值的注释。已列入最终审查的分诊清单。
- 172:Task 6: complete (commits 2c3edaa..489ed42, 7 项 parked 给后续任务 + 1 项 parked 为计划缺口)
- 173:  parked 明细见上方 R17（7 项分别归属 T7/T8/T9/T10/T11）与 R18（usePendingAnchor 并入 T8）。
- 174:  parked: 人工浏览器验收（简报 Step 9）从未执行，R14 滚动归属权的两个直接判据至今未验证 —— 只能由人工完成，已在阶段 A 验收清单中列出，并已告知用户。
- 203:Task 6: parked 项「人工浏览器验收从未执行」**已被执行并通过** —— 原实现者恢复后用 headless Chrome + 裸 CDP（未引入新依赖、未联网）在当时工作树上实测：
- 207:  → 这条 parked 项就此关闭，不必再要求用户人工复验 R14（其余整体观感仍建议人工过一遍）
- 270:Ruling R24 补充（复审给出更锐利的定性）: onEnhanced 里那道锚点守卫**实际是死代码**，不只是「未被独立测试」—— 只要闩锁生效，restoredDocRef 永不置为该文档 id，onEnhanced 会先被 restoredDocRef 挡住，锚点守卫从不成为决定性条件。仍维持保留裁决（显式标注的纵深防御），但归类从「缺测试」修正为「不可达分支」，已列入最终审查分诊清单。
- 492:  处置：不在本轮回溯重验（成本高且未必有问题），列入最终审查分诊清单，由最终审查判断哪些结论需要重验 — 代价：若确有结论失真，会在阶段 A 整体验收时才暴露。
- 503:Task 10: 【已知遗留 · 进最终审查分诊】10 秒保险丝到期后确实会静默印出空框，无额外提示。报告已明确记录未隐瞒
- 860:Ruling R45 (残余定级，复审独立推演后): **移交最终审查分诊，不阻塞本轮**。
