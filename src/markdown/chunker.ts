/**
 * 源文本分块。
 *
 * 为什么切的是**源文本**而不是 token 流：实测 10MB 文档一次渲染 7.5s，
 * 其中 `md.parse()` 独占 6.4s（85%）。token 级分块必须先解析完整篇，
 * 那 6.4s 一秒都省不掉。要把主线程还给用户，只能在解析之前就切开。
 *
 * 切点的选择是这个模块的全部难点：切错地方会改变渲染结果。
 * 一个跨越切点的列表会被解析成两个 `<ul>`，围栏代码块被切开则直接崩坏。
 */

/** 一块源文本 */
export interface SourceChunk {
  /** 本块的文本 */
  text: string;
  /** 在原文中的起始字符偏移，供搜索定位与错误上报使用 */
  start: number;
}

/** 围栏代码块的开合行 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** ATX 标题行——最理想的切点 */
const HEADING = /^ {0,3}#{1,6}\s/;
/** 列表项与引用：在它们前面切会把一个块拆成两个 */
const CONTINUATION = /^ {0,3}(?:[-*+]\s|\d+[.)]\s|>|\s*$)/;
/** 缩进代码块 */
const INDENTED = /^(?: {4}|\t)/;

/** 候选切点的评级：标题最优，其次是安全的空行 */
type Boundary = 'heading' | 'blank' | null;

/**
 * 判断第 i 行是否可以作为「新块的第一行」。
 *
 * 标题永远安全——它一定开启一个新的块级结构。
 * 空行之后的普通段落也安全，但如果下一行是列表项、引用或缩进代码，
 * 就说明我们正站在一个更大结构的中间，切下去会把它拆散。
 */
function classify(lines: readonly string[], i: number): Boundary {
  const line = lines[i];
  if (line === undefined) return null;
  if (HEADING.test(line)) return 'heading';

  const previous = lines[i - 1];
  if (previous === undefined || previous.trim() !== '') return null;
  if (line.trim() === '') return null;
  if (CONTINUATION.test(line) || INDENTED.test(line)) return null;
  return 'blank';
}

/**
 * 把源文本切成若干块。
 *
 * 每块**至少** `targetChars` 个字符，然后一直向后找，直到遇见第一个
 * 安全切点。宁可让块偏大也不在不安全的位置下刀——块大一点只是多占一帧，
 * 切错了却会让内容渲染错乱。
 *
 * 找不到任何安全切点时（比如整篇是一个巨大的代码块），返回单块，
 * 退化成原来的一次性渲染：慢，但正确。
 *
 * @param source 完整源文本
 * @param targetChars 每块的目标字符数
 */
export function splitSource(source: string, targetChars: number): SourceChunk[] {
  if (source === '' || targetChars <= 0) return [{ text: source, start: 0 }];

  const lines = source.split('\n');
  const chunks: SourceChunk[] = [];

  /** 当前块的起始行与起始偏移 */
  let startLine = 0;
  let startOffset = 0;
  /** 当前块已累计的字符数 */
  let size = 0;
  /** 所在围栏的标记；非 null 时一律不切 */
  let fence: string | null = null;

  /** 收束当前块，从 endLine 开始新块 */
  const flush = (endLine: number): void => {
    const text = lines.slice(startLine, endLine).join('\n');
    chunks.push({ text, start: startOffset });
    // +1 补回 join 时丢掉的换行符
    startOffset += text.length + 1;
    startLine = endLine;
    size = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // 围栏内部只累计长度，绝不判定切点
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      size += line.length + 1;
      continue;
    }

    const opening = FENCE.exec(line);
    if (opening?.[1] !== undefined) {
      // 围栏起始行本身可能正好是个切点候选，先判定再进入围栏
      if (size >= targetChars && i > startLine && classify(lines, i) !== null) flush(i);
      fence = opening[1];
      size += line.length + 1;
      continue;
    }

    if (size >= targetChars && i > startLine && classify(lines, i) !== null) {
      flush(i);
    }
    size += line.length + 1;
  }

  if (startLine < lines.length) flush(lines.length);
  return chunks.length === 0 ? [{ text: source, start: 0 }] : chunks;
}

/** 当前行是否收尾了围栏块（与 export/markdown.ts 同一套判定） */
function closesFence(line: string, marker: string): boolean {
  const char = marker[0];
  if (char === undefined) return false;
  const trimmed = line.trim();
  if (trimmed.length < marker.length) return false;
  return [...trimmed].every((current) => current === char);
}
