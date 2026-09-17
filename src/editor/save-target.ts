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
  /**
   * 没有本地句柄，但宿主页面握着句柄、可以代劳写回原文件。
   *
   * 只出现在「浏览器直接打开 .md、被内容脚本接管」这条路径上：那里的阅读器
   * 是跨源 iframe，自己既拿不到句柄、也弹不出选择器去换一个，句柄只能留在
   * 宿主侧，写入经由 postMessage 代劳（见 `content/protocol.ts`）。
   */
  | { kind: 'host-write' }
  /** 无句柄，弹保存对话框另存 */
  | { kind: 'save-as' }
  /** 连保存对话框都弹不出（跨源 iframe），退到浏览器下载 */
  | { kind: 'download' }
  /** 磁盘上那份被外部改过、用户还没决断，这次保存一律不许发生 */
  | { kind: 'conflict' };

export interface SaveContext {
  dirty: boolean;
  handle: FileSystemFileHandle | null;
  writable: boolean;
  canUsePicker: boolean;
  /**
   * 宿主页面是否已握住当前文件的句柄、可以代劳写回。
   *
   * 由 `GrantWriteMessage` 那次授权置真：用户在宿主弹出的选择器里亲手选中
   * 了当前这篇文档，宿主校验文件名相符后留住句柄。
   */
  hostWritable: boolean;
  /** 由定时器触发（true）还是用户按下 ⌘S（false） */
  automatic: boolean;
  /**
   * 冲突未决：磁盘上那份被编辑器之外的程序改过，与本地未保存的改动冲突，
   * 而用户还没在提示条上选「保留我的改动」还是「改用磁盘上的版本」
   * （`document.store` 的 `conflict` 字段，由 `decideRefresh` 判出）。
   */
  conflictPending: boolean;
}

/**
 * 决定这次保存该走哪条路。
 *
 * 核心的一条规则：**自动保存只在能静默写回时才动作**。没有写权限时，
 * 剩下的每条路（重新授权、另存对话框、触发下载）都需要用户参与，
 * 而自动保存每 800ms 就来一次——那会变成一台对话框机关枪。
 *
 * 第二条规则：**冲突未决时一个字节都不写**。这条判在这里而不是判在
 * `useAutoSave` 的排期处，是因为手动 ⌘S 与定时器走的是同一个判据，
 * 分两处写必然分岔——自动刷新那边的「冲突期间暂停轮询」正是只写在
 * `useAutoRefresh` 里，于是后加的自动保存整个绕过了它。
 */
export function decideSaveTarget(context: SaveContext): SaveTarget {
  if (!context.dirty) return { kind: 'clean' };

  /*
   * 冲突未决期间写盘，覆盖掉的是**别的程序写进磁盘的内容**，而那份内容
   * 在本应用里没有任何副本：版本缓冲（`writeThrough` 里那次 push）推进的是
   * `document.content`，也就是冲突**之前**我们自己读到/写下的那一份，
   * 不是磁盘上的新内容；`ConflictBanner` 只在用户点了「改用磁盘上的版本」
   * 时才把编辑器里那份推进缓冲。所以这一次写盘是不可逆的第三方数据破坏，
   * 没有回收站、没有后悔药，必须在动手之前挡住。
   *
   * 挡的是自动与手动两条路：手动保存同样会静默抹掉磁盘上那份，区别只是
   * 调用方要不要告诉用户（见 `runSave` 的 conflict-pending 分支）。
   */
  if (context.conflictPending) return { kind: 'conflict' };

  if (context.handle && context.writable) {
    return { kind: 'write', handle: context.handle };
  }

  /*
   * 代劳写回同样是「能静默完成」的——授权在进入编辑态时就一次性拿到了，
   * 写的时候不需要任何用户参与。所以这一条必须排在下面那句 `automatic`
   * 短路**之前**：排在后面的话自动保存永远走不到它，接管页面上这个功能就
   * 只剩手动 ⌘S 一条路，而「停笔就自动写回」恰恰是它最大的价值。
   */
  if (context.hostWritable) return { kind: 'host-write' };

  // 到这里说明写不回原文件，后续每条路都需要用户参与
  if (context.automatic) return { kind: 'clean' };

  if (context.handle) return { kind: 'needs-permission', handle: context.handle };
  return context.canUsePicker ? { kind: 'save-as' } : { kind: 'download' };
}
