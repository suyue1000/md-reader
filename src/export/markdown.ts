/**
 * Markdown 源文本规整。
 *
 * 这里刻意**只做空白层面的整理**，不碰任何语法结构：不统一列表符号、
 * 不重排表格、不重新折行。理由是导出的对象是用户自己的文件，一个
 * 「导出」动作把 `*` 列表全改成 `-`、把手写对齐的表格重排，是越界的。
 * 规整的目标只有一个：让文件在不同编辑器之间流转时不带脏空白。
 *
 * 代码块内的一切原样保留——围栏代码块与缩进代码块都算。缩进代码块
 * 尤其要小心：它靠空行和缩进界定，折叠空行会直接改掉代码内容。
 */

/** 围栏代码块的起始行：最多 3 个前导空格，之后是 3 个以上的 ` 或 ~ */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** 缩进代码块的行：4 个空格或一个 tab 起头 */
const INDENTED_CODE = /^(?: {4}|\t)/;

/** 硬换行：行尾两个以上空格 */
const HARD_BREAK = / {2,}$/;

/** 规整选项 */
export interface NormalizeOptions {
  /** 是否把连续空行压成一个空行 */
  collapseBlankLines?: boolean;
}

/**
 * 当前行是否结束了围栏块。
 *
 * 收尾围栏必须与开头**同字符**、不短于开头，且整行别无他物——
 * `~~~` 关不掉 ``` ``` ``` 开的块，代码里出现的 ```` ```js ```` 也不会被误判为收尾。
 */
function closesFence(line: string, marker: string): boolean {
  const char = marker[0];
  if (char === undefined) return false;
  const trimmed = line.trim();
  if (trimmed.length < marker.length) return false;
  return [...trimmed].every((current) => current === char);
}

/**
 * 规整 Markdown 源文本。
 *
 * 具体做四件事：
 * 1. 行尾序列统一成 `\n`；
 * 2. 去掉行尾多余空白，但保留「两个空格」这种硬换行——它是有语义的，
 *    很多格式化工具在这里踩过坑，把用户的换行悄悄吃掉；
 * 3. 连续空行压成一个（可关闭）；
 * 4. 去掉文件开头的空行，结尾保证恰好一个换行。
 */
export function normalizeMarkdown(source: string, options: NormalizeOptions = {}): string {
  const { collapseBlankLines = true } = options;

  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];

  /** 当前所在围栏的标记；null 表示不在围栏内 */
  let fence: string | null = null;
  /** 是否处于缩进代码块中 */
  let indentedCode = false;
  /** 已连续输出的空行数，用于压缩 */
  let blankRun = 0;

  for (const line of lines) {
    // --- 围栏代码块：进出判定优先于其他一切处理 ---
    if (fence !== null) {
      output.push(line);
      if (closesFence(line, fence)) fence = null;
      blankRun = 0;
      continue;
    }

    const opening = FENCE_OPEN.exec(line);
    if (opening?.[1] !== undefined) {
      fence = opening[1];
      output.push(line.trimEnd());
      blankRun = 0;
      continue;
    }

    const isBlank = line.trim() === '';

    // --- 缩进代码块：只能由非空的缩进行开启，被非缩进的正文行终止 ---
    if (!isBlank) {
      // 段落内部的续行即使缩进了 4 格也不是代码块，所以要求它前面是空行
      const canStartIndentedCode = output.length === 0 || blankRun > 0;
      indentedCode = INDENTED_CODE.test(line) && (indentedCode || canStartIndentedCode);
    }

    if (indentedCode && !isBlank) {
      output.push(line);
      blankRun = 0;
      continue;
    }

    if (isBlank) {
      // 文件开头的空行直接丢掉
      if (output.length === 0) continue;
      blankRun += 1;
      // 缩进代码块内部允许出现空行，此时不压缩也不结束块
      if (collapseBlankLines && !indentedCode && blankRun > 1) continue;
      output.push('');
      continue;
    }

    blankRun = 0;
    // 保留硬换行，其余行尾空白一律去掉
    output.push(HARD_BREAK.test(line) ? `${line.trimEnd()}  ` : line.trimEnd());
  }

  // 结尾恰好一个换行
  while (output.length > 0 && output[output.length - 1] === '') output.pop();
  return output.length === 0 ? '' : `${output.join('\n')}\n`;
}
