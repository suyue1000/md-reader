# Task 8c 审查报告（补做验收实测 + 代码审查）

审查对象：`06cdf04..9fcb079`（`0509e78` 块高度估算/地址栏 hash/闩锁复位，`9fcb079` 崩溃修复）。
实现者被中止、未做任何实测，本报告补做了全部五条判据的浏览器实测，并做了回归测试的效力验证。

---

## 一、实测环境与方法（先说清楚可信度边界）

### 1.1 无法用真实扩展加载的原因

本机 Chrome 152.0.7977.83 **已移除 `--load-extension`**。实测确认：加了
`--disable-features=DisableLoadExtensionCommandLineSwitch`、`--enable-unsafe-extension-debugging`，
headless 与有头模式各试一遍，profile 的 `Preferences.extensions.settings` 始终为 `count 0`，
按路径哈希算出的扩展 id（`piojhhhgijkoecdemhpegphhmigbidhl`）打开 `viewer.html` 返回
`ERR_BLOCKED_BY_CLIENT`。不联网、不引新依赖的前提下无法安装扩展。

### 1.2 采用的替代方案

- `npm run build` 产出的 **dist 原样**用本地 node 静态服务器（无依赖）挂在 `http://127.0.0.1`；
- 宿主页面 `/host/<name>.md` **逐字复刻 `src/content/index.ts` 的 `takeOver()`**：
  同样的 iframe（`viewer.html?embed=1`）、同样的 `md-reader:ready` → 回发
  `{type:'md-reader:load', name, url: location.href, content, hash: location.hash}` 握手、
  同样的 `md-reader:hash` → `history.replaceState(null,'',pathname+search+hash)`；
- `chrome.storage` 用 localStorage 替身注入（`Page.addScriptToEvaluateOnNewDocument`），
  否则阅读位置在整页刷新之间不留存，判据 4/5 无从测；
- 驱动方式：Node 22 内置 `WebSocket` 直连 CDP（无新依赖）。

**因此本报告的所有数字来自真实 Chrome、真实 dist、真实渲染管线（Shiki/Mermaid 实际执行），
唯一被替身的是「内容脚本宿主」与「chrome.storage」两处。** 内容脚本那段的消息处理逻辑
共 5 行，已与 `src/content/index.ts:205-229` 逐行比对一致。

### 1.3 用到的测试文档（合成，均在 scratchpad，未入库）

| 文档 | 形态 |
| --- | --- |
| `fenced.md` | 20 章，每章 30 行**无语言** fenced 代码块（Shiki 只当 plaintext，不上色） |
| `shiki.md` | 20 章，每章 30 行 ```js 代码块（实测 810 个带色 span） |
| `mixed.md` | 20 章，```ts 代码块 + 每 4 章一个 Mermaid 图 |
| `big.md` | 20 章 × 60 行 ```js，共 1343 行 |
| `uniqShort/uniqLong/uniqBig.md` | 纯标题+段落，无代码块 |

---

## 二、五条验收判据实测结果

### 判据 1（缺陷一直接判据）：带 fenced 代码块的文档，目录点击跳到视口外 —— **通过**

`fenced.md`，视口 743px，文档估算总高 19517：

| 时刻 | scrollTop | 标题距容器顶 | 侧栏高亮 |
| --- | --- | --- | --- |
| 点击前 | 0 | — | 测试文档 |
| 逐帧采样 | `[0, 16536, 16536, …]`（第 2 帧落定） | 10.6px | 第-18-章 |
| +4.5s | 16536 | 10.6px | 第-18-章 |

回点近处的 第-3-章 → 2202 / 11.2px / 高亮正确。
`big.md`（20 章 × 60 行）：0 → 27715，标题距顶 11.2px，高亮 第-18-章。

**撤销修复的对照（在 `06cdf04` 上另建 worktree 重新 build 后实测）**：

| 场景 | 06cdf04（无 estimatedHeight） | HEAD |
| --- | --- | --- |
| `big.md` 打开时文档总高 | 13825（真实 32641，**低估 58%**） | 32641（真实 32646，**误差 5px**） |
| `big.md` 点 第-18-章 | 落点看着对，**侧栏高亮停在 第-17-章** | 高亮 第-18-章 |
| `big.md` 锚点 #第-12-章 | 高亮 第-11-章 | 高亮 第-12-章 |
| `sweepF`（20 节，短段落+20 行代码块）点任意节 | **scrollTop 恒为 0，完全不动** | 5358 / 11112，落点与高亮均正确 |

即：缺陷一的「完全不动」症状在对照组复现了，修复后消失。

### 判据 2（已知盲区）：Shiki 文档上锚点落点与侧栏高亮 —— **通过**

`shiki.md` 以 `#%E7%AC%AC-14-%E7%AB%A0` 整页打开，每 250ms 采样一次，连续 7.75 秒：

```
250ms  scrollTop=12709  标题距顶=11  高亮=第-14-章  已上色 span=810
…（31 次采样全部相同）…
7750ms scrollTop=12709  标题距顶=11  高亮=第-14-章  已上色 span=810
```

已确认是真 Shiki：`<pre class="shiki shiki-themes github-light github-dark">`，
`--shiki-light/--shiki-dark` 双主题变量，270+ 个带 style 的 span，语言条显示 `js`。
对照组：`fenced.md` 的同一位置 0 个带色 span、语言条 `text`，说明两条路径确实分开测到了。

Shiki 文档上再点目录 第-9-章：7931 / 11.2px / 高亮正确。
**增强前后落点一个像素没变**，这条盲区补验干净。

### 判据 3：跳转后地址栏 hash + 嵌入模式宿主同步 —— **通过**

三条路径都实测到宿主地址栏变化（宿主为逐行复刻的内容脚本）：

| 触发 | 宿主 `location.href` | iframe 内 hash | `md-reader:hash` 消息 |
| --- | --- | --- | --- |
| 目录点击 第-18-章 | `…/fenced.md#%E7%AC%AC-18-%E7%AB%A0` | 同左 | 收到 1 条 |
| 再点 第-3-章 | `…/fenced.md#%E7%AC%AC-3-%E7%AB%A0` | 同左 | 累计 2 条 |
| 地址栏锚点打开 | 保持并被规范化重写 | 同左 | 收到 1 条 |

`history.replaceState` 未产生额外历史记录，也未触发原生片段导航（落点未被二次拉动）。

### 判据 4（回归）：先带锚点打开、再不带锚点重开，阅读位置恢复正常 —— **通过**

两种路径都测了：

**(a) 整页重开（嵌入模式的真实路径）**：`mixed.md` 读到 scrollTop=4000 → 带
`#第-16-章` 整页重开（落点 13452）→ 再不带锚点整页重开 → **恢复到 3920**
（与 4000 差 80px，同期文档总高从 17535 变到 17528，属正常残差），高亮 第-5-章。

**(b) 同一页面会话内重开同一 documentId**（缺陷三的原始场景，A→B→A）：

```
A 无锚点打开，用户滚到          → 3901
A 带 #第-16-章 重开             → 13466，标题距顶 6.1px，+5s 仍是 13466
在锚点处用户手动滚到            → 9000（这次成为「上次读到的位置」）
切到另一篇文档 B                → 0
A 不带锚点重开                  → 8984  ✅ 恢复生效
```

对照：把闩锁改回存 documentId 后，第三步会被继续挡住（见第四节的测试效力验证）。

### 判据 5（回归）：带锚点打开一篇读过的、含 Shiki/Mermaid 的文档，落点仍是锚点 —— **通过**

`mixed.md`（Shiki + Mermaid，实测 1 个 Mermaid SVG、2 个 Shiki 块已就位）：

| 场景 | 打开前已记的位置 | 锚点落点 | +5~6s 增强完成后 |
| --- | --- | --- | --- |
| 整页带锚点重开 | 4000（另一条记录） | 13452 / 6.2px / 高亮 第-16-章 | 13452，一像素未动 |
| 同一 documentId 会话内重开 | 3901（同一条记录） | 13466 / 6.1px / 高亮 第-16-章 | 13466，一像素未动 |

第二行是关键：**位置记录与锚点属于同一个 documentId，闩锁真的被考到了**，
增强完成后的校正没有把用户从 13466 拽回 3901。闩锁完好。

---

## 三、三个反推问题

### 3.1 `block-height.ts` 的估算策略与依据

**策略**：两级。① 先问块缓存要真实高度（`BlockCache.measuredHeight(key)`，由 ResizeObserver
在布局之后被动写入，读取只是一次 Map 查询，不触发同步布局）；② 没量到过才按块类型走经验公式，
且结果缓存在 widget 实例上（`fallbackHeight ??=`）。分类顺序是「高度与源码行数无关的先认」：
Mermaid → fenced 代码块 → 缩进代码块 → 表格 → 图片 → 标题 → 其余按文字折行估。

**依据站得住吗**：站得住，而且实测精度远超需要。滚遍全篇让每块都被真实测量后对比：

| 文档 | 打开时的估算总高 | 全部量到后的真实总高 | 偏差 |
| --- | --- | --- | --- |
| `big.md`（代码为主） | 32641 | 32934 | **-0.9%** |
| `uniqBig.md`（纯段落，40 节） | 33147 | 33598 | **-1.3%** |
| `uniqLong.md`（长段落） | 12499 | 12879 | **-3.0%** |

**常量与实际 CSS 的对账**（逐条核了 `markdown.css` / `theme.css` / `editor/theme.ts`）：

| 常量 | 注释里的算式 | 实际 CSS | 结论 |
| --- | --- | --- | --- |
| `TEXT_LINE_PX=27` | 16px × 1.7 | `--content-font-size:16px` / `--content-line-height:1.7` | ✅ |
| `BLOCK_GAP_PX=16` | `margin:0 0 1em` | markdown.css:85-97 一致 | ✅ |
| `CODE_LINE_PX=22` | 0.85em(13.6) × 1.6 | `.code-block__pre` font-size .85em / line-height 1.6 | ✅ |
| `CODE_CHROME_PX=51` | 26+23+2 | 实算约 29.8+23.1+2≈55 | ✅ 量级对（+8%） |
| `HEADING_PX` | h1 ≈58 | h1 的 `margin-bottom:0.6em` 是**按 h1 自己的 29.6px 字号**算的（17.8px，不是 9.6px），实算 ≈66 | ⚠️ 算式里 em 基准用错，偏 12% |
| `CHARS_PER_LINE=86` | 「`--content-max-width`（46rem ≈ 736px）÷ 8.5」 | **实际 `--content-max-width: 980px`**（theme.css:124），减去 `.cm-content` 的 `padding:2.5rem 2rem` 后版心约 916px | ❌ **注释引用的 CSS 值在本项目里不存在**，46rem 是别处的数 |

即：**注释里两处推导与实际 CSS 对不上（`HEADING_PX` 的 em 基准、`CHARS_PER_LINE` 的版心宽度），
但估算结果实测误差在 3% 以内**——两处误差方向相反、又被 `Math.max(wrappedLines, sourceLines)`
兜了底，所以没有表现出来。这是「注释错了但代码对了」，属于注释缺陷，不是行为缺陷。

**估算严重偏差的后果**：不是「落点偏一点」，而是**跳转彻底不发生**。对照组数据摆在那里：
`06cdf04` 上 `sweepF` 的每一次目录点击 scrollTop 都恒为 0。CodeMirror 的 measure 循环超过
6 轮就放弃（`@codemirror/view` index.js:8171），且本项目里连 `Viewport failed to stabilize`
都没打出来（实测 0 条，我先验证过 iframe 的 console 能被捕获）——**完全静默**。
所以「估错只要量级对就行」这个前提是有条件的：量级错了就是功能死掉。

### 3.2 `scroll-settle.ts` 为什么需要 / 能不能更简单

**需要，理由实测成立**。`fenced.md` 目录点击的逐帧采样是 `[0, 16536, 16536, …]`：
第 1 帧读到的是**滚动前的 0**。两个调用点都靠这个值判断「后面这次 scroll 事件是不是用户干的」，
只等一帧就会把自己判成用户滚动并永久撤防（`useReadingPosition.ts:193-202`、
`usePendingAnchor.ts:186-194`），表现是增强完成后的校正被跳过——静默、不自愈。
注释里写的「实测三帧（第 1、2 帧为 0，第 3 帧跳到 5656）」与我这里的两帧只差一帧，属机器差异，
结论一致。

**能更简单**：本项目 `manifest.json` 写着 `minimum_chrome_version: 116`，而 **`scrollend` 事件
Chrome 114 起就有**。`container.addEventListener('scrollend', …, {once:true})` 加一个超时兜底，
语义比「值变过一次又停住」直接得多，也不需要 `MAX_SETTLE_FRAMES` 这种「目标恰好就在当前位置时
靠帧数上限收尾」的特例。现有实现没有错，但属于可以更短的自造轮子。

另有一处已知残留：8 帧（约 130ms）封顶后无论是否落定都会 `done(current)`。若某次滚动超过 8 帧
才落定（大文档 + 慢机器），记下的就是半途值，随后第一次 scroll 事件即误判为用户滚动。
注释里说「走到上限只有『位置没变化』一种可能」，这句话把上限当成了不变量，其实只是概率。

### 3.3 四个简报未点名文件的必要性

| 文件 | 改动 | 判定 |
| --- | --- | --- |
| `document.store.ts` | 新增 `openEpoch`，`setDocument`/`reset` 自增，`applyRefreshedDocument` 不增 | **必要**。缺陷三要区分「同一篇文档的两次打开」，documentId 做不到，必须有一个「打开序号」。放在 store 是唯一合理的位置。自动刷新不自增这条也是对的（同一次打开换内容，闩锁不该松）。 |
| `useEmbeddedDocument.ts` | 新增 `syncAnchorHash`，并保留 hashchange 转发给「有意放行给浏览器的锚点」 | **必要**。缺陷二要求嵌入模式经 `postToHost` 同步宿主地址栏，这个通道只在这个文件里。唯一可议的是**放置位置**：`TocPanel.tsx`、`useRelativeLinks.ts`、`usePendingAnchor.ts` 三个模块现在都从一个名为「嵌入文档」的 hook 文件里 import 一个纯函数，抽到 `utils/anchor-hash.ts` 更干净。 |
| `TocPanel.tsx` | 点击后调 `syncAnchorHash(id)` | **必要**。简报明写「侧栏目录点击」是三条要修的路径之一。 |
| `useScrollSpy.ts` | `SPY_PROBE_OFFSET_PX` 2 → 8 | **在范围内，但属于外溢**。它不是三条缺陷中的任何一条，是缺陷一修好后才暴露出来的次生问题：跳进从未渲染过的区域时，目标上方全是估算高度，残差不会自愈。实测支持这个改动——落点处标题距容器顶实测 6.2~11.2px，2px 的探测点会落在上一块里，8px 不会。代价（自然滚动时高亮早 8px 切换）注释里说清楚了。判定：可接受，但应在提交信息里点名，否则下一个人会以为是顺手改的。 |

---

## 四、重点核实

### 4.1 闩锁：粘性修掉了，原缺陷没有放回来

**修掉粘性**：见判据 4(b) 的 A→B→A 实测，回到 A 时恢复到 8984（记录值 9000）。
**原缺陷没放回来**：见判据 5 第二行，同一 documentId 下锚点落点 13466 在增强完成后一像素未动，
没有被记录里的 3901 覆盖。

代码层面也自洽：闩锁置位 effect（`useReadingPosition.ts:129-131`）声明在两条恢复路径之前，
保证同一轮提交里先置位后判定；判定处同时看 `pendingAnchor !== null`（覆盖「锚点刚设上、
effect 还没跑」的那一帧）与 `anchorOpenRef.current === openEpoch`（覆盖「锚点已被消费清空」
之后的整个生命周期）。`usePendingAnchor.ts:93-96` 的撤防同样按 `openEpoch`，两处同源。

**但缺陷三在当前产品里几乎不可达，这一点简报和实现者都没说破**：
`setPendingAnchor` 全项目只有一个调用点（`useEmbeddedDocument.ts:114`），只在嵌入模式的
**整页加载**时执行一次。而整页加载天然是新会话，`openEpoch` 从 0 起算，闩锁不可能跨会话粘住。
要触发原缺陷，必须在同一个页面会话里对同一个 documentId 调两次 `setDocument`，
且第一次带锚点——只有「嵌入模式带锚点打开 → 用工作区侧栏切走 → 再切回来」这一条路径，
而这条路径回来时 `useWorkspace.openPath` 用的 id 是工作区 URL，与初始的 `location.href`
（含 hash）**并不相等**。所以修复本身正确，但它修的是一个理论上存在、实际路径极窄的缺陷。

### 4.2 地址栏 hash：理由成立，嵌入通路完整，但带出一个副作用

**`replaceState` 而不是 `location.hash =`：理由成立。** 赋值 `location.hash` 会触发原生片段导航，
目标元素在 DOM 里时浏览器按标题元素顶边再滚一次，与 `scrollToLine` 的块顶对齐打架；
`replaceState` 不滚动、不派发 `hashchange`、不新增历史记录。实测落点在写 hash 之后一像素未动，
反证成立。宿主侧 `content/index.ts:218` 本来就是 `replaceState`，两侧一致。

**嵌入通路完整。** `syncAnchorHash` 因为 `replaceState` 不派发 `hashchange`，直接
`postToHost({type:'md-reader:hash'})`；宿主 `content/index.ts:215-219` 收下并 `replaceState`。
原有的 hashchange 监听器保留给脚注引用等有意放行给浏览器的锚点，两条路互不重叠。实测宿主地址栏
确实更新（`hashEvents` 收到 1/2 条，`location.href` 同步变化）。

**副作用（新引入，无测试覆盖）**：嵌入模式下 documentId 是 `message.url = location.href`，
**含 hash**。修复前地址栏永不变化，所以同一文件的 documentId 是稳定的；修复后点一次目录，
宿主地址栏就带上 `#章节`，此后**刷新页面会得到一个不同的 documentId**。实测坐实：
`mixed.md` 读到 4000 → 带 `#第-16-章` 整页重开（这一次的位置记在另一条记录上）→ 不带锚点重开
→ 恢复到 3920，即两次会话写的是两条记录。后果：阅读位置按锚点碎片化，`MAX_ENTRIES=200`
的淘汰更快被填满；用户点过目录再刷新，恢复的粒度从「上次的精确像素」退化成「上次点的那一节」。
不是致命问题（退化后的行为反而说得通），但它是缺陷二引入的行为变化，应当被记录下来。

### 4.3 第二个提交（崩溃修复）

**`isCurrentShape`（`reading-position.ts:38-42`）正确。** `Number.isFinite(record.line)` 对
`undefined` 返回 false，老结构（比例 + 锚点 id，无 `line` 字段）被整条丢弃；注释把
「不做结构转换」的取舍写清楚了（换算需要文档行数，而这里只有存储数据）。

**`scrollToLine` 的 `Number.isFinite` 防护（`MarkdownEditor.tsx:98`）正确但只挡了一半。**
`Math.min(line + 1, doc.lines)` 夹住了上界，没夹下界；`line <= -1` 会让
`doc.line(n<1)` 抛 `RangeError: Invalid line number`（`@codemirror/state` index.js:19-20）。
当前三个调用方的行号来源（`lineAt().number - 1`、`collectHeadings` 的 `token.map[0]`）都不可能
为负，所以是潜在而非现实缺陷；但这条防线的自我定位是「将来任何一处算出坏值都不该表现为崩溃」，
只挡 NaN 不挡负数与这个定位不一致，一个 `Math.max(1, …)` 即可闭合。

**同类风险点排查**：
- `prune()`（`reading-position.ts:52-60`）按 `updatedAt` 排序，而 `isCurrentShape` 不校验
  `updatedAt` / `documentId`。存储里若有 `updatedAt` 非数的记录，比较器返回 NaN，排序结果不确定，
  可能淘汰错条目。不崩溃，Minor。
- `applyPosition` 的 `scrollTop += offset`：`offset` 对存储来的记录已被校验，对现算的来自
  `offsetWithinBlock`，两条来源都安全。
- `usePendingAnchor` / `useRelativeLinks` 的行号都来自 `findHeadingLine`，返回 `number | null`，
  已判空。

---

## 五、回归测试效力验证（简报要求，实现者未做，本次补做）

在 HEAD 上另建 worktree 逐项撤销修复后跑 `npx vitest run`：

| 撤销的修复 | 失败用例 |
| --- | --- |
| 删掉 `BlockWidget.estimatedHeight` | 3 例：`live-preview.test.ts` 的「每个块 widget 都报出一个正的估算高度」「20 行的代码块估出来远高于一个行高」「块缓存里量到过真实高度时，用真实高度而不是经验估值」 |
| 闩锁退回存 documentId | 2 例：`useReadingPosition.test.tsx` 的「同一篇文档先带锚点打开、再不带锚点重开，阅读位置照常恢复」「重开之后增强完成的校正也恢复了，不是只跳一次」 |
| 整个拆掉闩锁（只留现读 `pendingAnchor`） | 6 例，含「增强完成后的校正也不能把用户从锚点拽回上次位置」「自动刷新不算重新打开，闩锁不松」——**说明闩锁原本要挡的缺陷也被扎住了** |
| `TocPanel` 里去掉 `syncAnchorHash(id)` | 1 例：`TocPanel.test.tsx`「跳完之后地址栏 hash 反映当前位置」 |

四组撤销都有用例失败，测试是有效力的，不是「跟着实现写」的空转。

`npm run verify`：typecheck 无输出、lint 无输出、**39 文件 / 384 用例全过**（2.19s）。

---

## 六、问题清单

### Critical
无。三条缺陷都实测修复，且都有会失败的回归用例扎住。

### Important

1. **`block-height.ts:58` 的常量推导引用了本项目不存在的 CSS 值。**
   注释写「版心 `--content-max-width`（46rem ≈ 736px）」，`theme.css:124` 实际是 `980px`，
   减去 `.cm-content` 的 `padding: 2.5rem 2rem`（`editor/theme.ts:26`）后版心约 916px。
   `CHARS_PER_LINE=86` 按 736px 推出来，与实际差 24%。**结果没坏（实测总高偏差 ≤3%）**，
   但下一个人照着这条算式调参会被带偏——本项目的注释规范是「解释为什么」，一条错误的
   「为什么」比没有更危险。同一段里 `HEADING_PX` 的 h1 算式把 `margin-bottom:0.6em` 按 16px
   算成 9.6px，实际 em 基准是 h1 自己的 29.6px（17.8px）。两处都建议改注释、不必改常量。

2. **地址栏 hash 同步让嵌入模式的 documentId 随锚点漂移（`useEmbeddedDocument.ts:96`）。**
   `id: message.url` 含 hash；缺陷二修好后点一次目录，宿主地址栏就带上锚点，之后刷新即是
   一条新的阅读位置记录。实测复现（见 4.2）。修复方向是把 documentId 规范成去掉 hash 的 URL，
   一行的事，但会动到既有存储键，需要单独评估。当前没有任何用例覆盖这条。

3. **`TocPanel.tsx:86` 的注释「跳成了才写地址栏」名不副实。**
   代码只判断了 `view` 是否存在，并不知道 `scrollToLine` 有没有真的滚动。实测在一篇
   会让 CodeMirror 放弃滚动的文档上，scrollTop 恒为 0 而地址栏照写——正是注释说要避免的
   「给出一个跳不到的链接」。要么改注释（说清楚只是「编辑器就绪才写」），要么落定后再写。

### Minor

1. `MarkdownEditor.tsx:98` 的非有限值防护只夹上界，`line <= -1` 仍会抛 `RangeError`；
   补 `Math.max(1, …)` 即闭合（见 4.3）。
2. `reading-position.ts:38-42` 的 `isCurrentShape` 不校验 `updatedAt` / `documentId`，
   `prune()` 的排序比较器可能拿到 NaN（见 4.3）。
3. `scroll-settle.ts` 可用 `scrollend`（Chrome 114+，本扩展 `minimum_chrome_version` 是 116）
   替代逐帧轮询，更短也更直白；现实现的 8 帧封顶在慢机器/大文档上会记下半途值（见 3.2）。
4. `syncAnchorHash` 放在 `useEmbeddedDocument.ts` 里，被三个与「嵌入」无关的模块 import；
   宜抽到 `utils/anchor-hash.ts`。
5. `useScrollSpy.ts` 的 `SPY_PROBE_OFFSET_PX` 2→8 是三条缺陷之外的次生修改，
   实测支持这个值，但提交信息里没有点名（见 3.3）。

### 审查中发现的既有缺陷（与 Task 8c 无关，pre/post 两个构建都复现，仅作记录）

- **源码文本完全相同的顶层块会共用同一个 DOM 节点**：`block-cache.ts` 以块的源码文本为键，
  `acquire()` 对同一个键返回同一个节点，而 `BlockWidget.eq()` 也按键比较。重复量大时后果严重——
  实测一篇「20 节 × 3 段、所有段落文字完全相同」的文档，目录跳转 scrollTop 恒为 0（`06cdf04`
  与 HEAD 均如此）。少量重复（2~3 处）实测无影响。8c 让 `estimatedHeight` 也走这个键，
  等于把这条既有假设的影响面扩大到了高度图。
- **同一页面会话里用完全相同的内容重开同一篇文档，目录会永久变空**：`setDocument` 清空 `toc`，
  而 `MarkdownEditor` 的重建 effect 依赖 `[documentId, markdownSettings]`，内容与 id 都没变时
  不会重新 `rerender`，`onHeadings` 因此不再被调用。侧栏显示「这篇文档没有标题」，
  且 `usePendingAnchor` 的 `toc.length === 0` 门槛会让锚点永远无法兑现（`pendingAnchor`
  滞留非 null，进而把这一次打开的阅读位置恢复也一并挡掉）。实测复现。

---

## 七、结论

- **五条验收判据：5 / 5 通过**（判据 3 的宿主侧为逐行复刻的内容脚本，原因见 1.1）。
- **规范符合性：✅**。TypeScript strict 全开、`npm run verify` 全绿（39 文件 / 384 用例）、
  注释中文且解释「为什么」（密度与 `file-open.ts`、`chunker.ts` 同级，个别推导算错但风格达标）、
  零网络请求（新增代码不含任何请求）、提交信息中文。
- **任务质量：批准（附条件）**。三条缺陷都真的修好了，回归测试撤销后确实会失败，
  改动范围克制，注释质量高于一般水平。Important 三条建议在下一个任务里一并处理：
  第 1 条改注释即可；第 2 条需要单独评估存储键迁移；第 3 条改注释或改行为二选一。

### 未能验证的项

1. **真实内容脚本（`src/content/index.ts`）未被执行**：Chrome 152 移除了 `--load-extension`，
   宿主侧用逐行复刻的等价实现代替。已复刻的是 `takeOver()` 里的握手与 `md-reader:hash` 分支；
   `pickFolder` / `readWorkspaceFile` / `isPlainTextRender` / `takeoverEnabled` 这几条分支
   **完全没有实测覆盖**。
2. **`file://` 场景未验证**：全部实测跑在 `http://127.0.0.1` 上。`file://` 下宿主 origin 是
   `"null"`、`postToHost` 用 `'*'` 的那条路径没有实跑过。
3. **真实 `chrome.storage` 未参与**：用 localStorage 替身。配额、`onChanged` 跨上下文广播、
   `ExtensionContextGone` 降级路径均未覆盖。
4. **判据 4/5 的「同一 documentId」形态是构造出来的**：真实产品里同一页面会话内重开同一文档
   会撞上第六节记录的「目录永久变空」既有缺陷，所以测试时第二次打开的内容加了几个尾随空格
   以触发重渲染。这不影响闩锁本身的结论（documentId 与阅读位置记录键都没变），但要说明。
5. **性能未测**：`estimatedHeight` 声称「便宜」，我只核了它不碰 DOM、只做常数次字符串扫描，
   没有跑 `npm run bench` 做前后对比。
