# Task 7 修复第 2 轮 · 控制方恢复报告

实现者子代理第三次随会话进程退出被杀，提交前状态丢失、未留报告。
控制方（会话恢复后）在工作树中发现完整改动，实跑验证后代为提交。

## 验证（控制方实跑，非转述）

npm run verify 全绿：typecheck 无输出、lint 无输出、vitest 31 文件 / 285 测试通过。

## 三条未决findings 的落实核实

(7) 插件挂起导致 onEnhanced 永不触发 —— 已落实。
    新增 src/utils/settle-with-timeout.ts：改用 Promise.allSettled + 超时 race。
    注释明确写了「超时分支是一根保险丝，不是性能开关」，并说明为何用 allSettled
    而非 all（某个任务失败不该把信号从「迟到」变成「永远拿不到」）。
    配套 settle-with-timeout.test.ts 41 行。

(4) 拖拽滚动条检测不到用户滚动 —— 已落实，采用复审建议的无竞态解法。
    scroll-math.ts 新增 isWithinScrollTolerance(actual, expected, tolerance)：
    记下我们自己写入的 scrollTop，在 scroll 事件里比对实际值，超出容差即判为用户操作。
    容差解释留在调用方（SCROLL_TOLERANCE_PX 上方），此函数只负责比较——职责划分清楚。

(2) 引导失败路径 —— 已如实标注为已知降级，未粉饰。
    MarkdownEditor.tsx 注释原文要点：「如实记录这不是『修好了』，而是把问题从主路径
    挪到了失败路径」，并给出接受理由：管线加载失败时脚注/公式/代码高亮全部一起失效，
    阅读位置差几行是这次整体降级里最不重要的一环。

## 信息损失

实现者未留下本轮的自述报告与自查记录，随崩溃丢失。以上核实由控制方阅读 diff 得出。
