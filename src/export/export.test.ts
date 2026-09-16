import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareExportFragment } from './dom-snapshot';
import { buildStandaloneHtml } from './html';
import { normalizeMarkdown } from './markdown';
import { replaceExtension, saveFile } from './download';
import { exportHtml, exportMarkdown, exportPdf, PRINT_ROOT_ID } from './index';

/** 用一段 HTML 造一个正文节点 */
function makeContent(html: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'markdown-body';
  root.innerHTML = html;
  return root;
}

describe('prepareExportFragment', () => {
  it('不修改原节点', () => {
    const source = makeContent('<h2>标题<a class="heading-anchor" href="#t">#</a></h2>');
    prepareExportFragment(source);
    // 用户正看着这个节点，就地清理会让屏幕内容跳一下
    expect(source.querySelector('.heading-anchor')).not.toBeNull();
  });

  it('剔除只有 JS 才能用的交互元素', () => {
    const fragment = prepareExportFragment(
      makeContent(
        '<figure class="code-block"><figcaption class="code-block__bar">' +
          '<span class="code-block__lang">ts</span>' +
          '<span class="code-block__actions"><button>复制</button></span>' +
          '</figcaption><pre><code>x</code></pre></figure>' +
          '<h2>标题<a class="heading-anchor" href="#t">#</a></h2>',
      ),
    );

    expect(fragment.querySelector('.code-block__actions')).toBeNull();
    expect(fragment.querySelector('.heading-anchor')).toBeNull();
    // 语言标签是内容而非交互，要保留
    expect(fragment.querySelector('.code-block__lang')?.textContent).toBe('ts');
    expect(fragment.querySelector('code')?.textContent).toBe('x');
  });

  it('展开折叠的代码块', () => {
    // 静态文件里没有「展开」按钮，保留折叠等于永久藏起半段代码
    const fragment = prepareExportFragment(
      makeContent('<figure class="code-block is-collapsed"><pre><code>x</code></pre></figure>'),
    );
    expect(fragment.querySelector('.code-block')?.className).toBe('code-block');
  });

  it('去掉懒加载与增强器的内部标记', () => {
    const fragment = prepareExportFragment(
      makeContent('<img src="a.png" loading="lazy" data-img-enhanced="true" alt="图">'),
    );
    const image = fragment.querySelector('img');
    expect(image?.hasAttribute('loading')).toBe(false);
    expect(image?.hasAttribute('data-img-enhanced')).toBe(false);
    // alt 是无障碍信息，必须留着
    expect(image?.getAttribute('alt')).toBe('图');
  });

  it('保留 Mermaid 的内联 SVG', () => {
    // 导出的核心承诺是「所见即所得」，图必须跟着走
    const fragment = prepareExportFragment(
      makeContent('<div class="mermaid-block" data-mermaid-theme="dark"><svg><g/></svg></div>'),
    );
    expect(fragment.querySelector('svg')).not.toBeNull();
    expect(fragment.querySelector('.mermaid-block')?.hasAttribute('data-mermaid-theme')).toBe(false);
  });
});

describe('buildStandaloneHtml', () => {
  const base = {
    title: '笔记.md',
    bodyHtml: '<h1>标题</h1>',
    css: '.markdown-body { color: red }',
    theme: 'dark' as const,
    generatedAt: new Date('2026-07-29T10:00:00'),
  };

  it('产出带主题标记的完整文档', () => {
    const html = buildStandaloneHtml(base);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="zh-CN" data-theme="dark">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>笔记.md</title>');
  });

  it('样式内联进文件，不留外部依赖', () => {
    const html = buildStandaloneHtml(base);
    expect(html).toContain('.markdown-body { color: red }');
    expect(html).not.toContain('<link');
  });

  it('转义标题，避免文件名把文档结构撑破', () => {
    // 文件名是用户可控的，`</title><script>` 这种名字不该变成注入点
    const html = buildStandaloneHtml({ ...base, title: '<script>x</script>.md' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;.md');
  });
});

describe('saveFile 在选择器不可用时的退路', () => {
  const HTML_TYPE = { description: 'HTML 文件', accept: { 'text/html': ['.html'] } };

  beforeEach(() => {
    // jsdom 没有实现这两个，但退路必须用到
    URL.createObjectURL = vi.fn(() => 'blob:stub');
    URL.revokeObjectURL = vi.fn();
    // canUseFilePicker 是以 showOpenFilePicker 的存在为准的，
    // 不装它就会在更早一步走掉退路，测不到下面那两个分支
    (window as { showOpenFilePicker?: unknown }).showOpenFilePicker = () => undefined;
  });

  afterEach(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    vi.restoreAllMocks();
  });

  it('没有 showSaveFilePicker 时退回浏览器下载', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const result = await saveFile('a.html', new Blob(['x']), HTML_TYPE);

    expect(click).toHaveBeenCalled();
    expect(result).toEqual({ status: 'done', filename: 'a.html', bytes: 1 });
  });

  /**
   * 守的是接管页面里的导出。
   *
   * 那里的阅读器是嵌在 file:// 页面中的跨源 iframe，浏览器会以
   * `SecurityError: Third party iframes are not allowed to show a file picker`
   * 拒绝一切选择器。把这个错误当成普通故障上报，用户看到的就是「导出失败」，
   * 而其实退回浏览器下载完全可以拿到文件。
   */
  it('选择器抛 SecurityError 时退回浏览器下载而不是报错', async () => {
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = () => {
      throw new DOMException('Third party iframes are not allowed', 'SecurityError');
    };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const result = await saveFile('a.html', new Blob(['xy']), HTML_TYPE);

    expect(click).toHaveBeenCalled();
    expect(result.status).toBe('done');
  });

  it('用户取消仍然是 cancelled，不会误触发下载', async () => {
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = () => {
      throw new DOMException('abort', 'AbortError');
    };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const result = await saveFile('a.html', new Blob(['x']), HTML_TYPE);

    expect(result).toEqual({ status: 'cancelled' });
    expect(click).not.toHaveBeenCalled();
  });
});

describe('replaceExtension', () => {
  it('只替换最后一段扩展名', () => {
    expect(replaceExtension('notes.md', 'html')).toBe('notes.html');
    expect(replaceExtension('notes.zh-CN.md', 'html')).toBe('notes.zh-CN.html');
  });

  it('没有扩展名时直接追加', () => {
    expect(replaceExtension('README', 'html')).toBe('README.html');
  });
});

describe('normalizeMarkdown', () => {
  it('统一行尾并保证结尾恰好一个换行', () => {
    expect(normalizeMarkdown('a\r\nb\r\n\n\n')).toBe('a\nb\n');
    expect(normalizeMarkdown('a')).toBe('a\n');
  });

  it('去掉行尾空白，但保留两个空格的硬换行', () => {
    // 硬换行是有语义的，很多格式化工具在这里悄悄吃掉用户的换行
    expect(normalizeMarkdown('第一行  \n第二行   \t\n')).toBe('第一行  \n第二行\n');
  });

  it('压缩连续空行', () => {
    expect(normalizeMarkdown('# 标题\n\n\n\n正文\n')).toBe('# 标题\n\n正文\n');
  });

  it('丢掉文件开头的空行', () => {
    expect(normalizeMarkdown('\n\n# 标题\n')).toBe('# 标题\n');
  });

  it('可以关掉空行压缩', () => {
    expect(normalizeMarkdown('a\n\n\nb\n', { collapseBlankLines: false })).toBe('a\n\n\nb\n');
  });

  it('围栏代码块内一个字符都不动', () => {
    const source = '```js\nconst a = 1;   \n\n\n\nconst b = 2;\n```\n';
    expect(normalizeMarkdown(source)).toBe(source);
  });

  it('波浪号围栏不会被反引号关掉', () => {
    const source = '~~~\n```\n\n\n还在块里\n~~~\n';
    expect(normalizeMarkdown(source)).toBe(source);
  });

  it('代码块里的 ```js 不会被当成收尾围栏', () => {
    const source = '````\n```js\n\n\nx\n````\n';
    expect(normalizeMarkdown(source)).toBe(source);
  });

  it('缩进代码块内的空行不被压缩', () => {
    // 缩进代码块靠空行和缩进界定，折叠空行会直接改掉代码内容
    const source = '正文\n\n    line1\n\n\n    line2\n';
    expect(normalizeMarkdown(source)).toBe(source);
  });

  it('段落里缩进四格的续行不算代码块', () => {
    // 它没有前置空行，是段落的一部分，行尾空白照常清理
    expect(normalizeMarkdown('一句话\n    续行 \n')).toBe('一句话\n    续行\n');
  });

  it('把三个以上的行尾空格收敛成标准的两个', () => {
    expect(normalizeMarkdown('一句话    \n下一行\n')).toBe('一句话  \n下一行\n');
  });

  it('全空白输入产出空串', () => {
    expect(normalizeMarkdown('\n\n\n')).toBe('');
  });
});

describe('exportHtml 用调用方给的正文节点', () => {
  const DOC = {
    id: 'file:///tmp/a.md',
    name: 'a.md',
    path: '/tmp/a.md',
    content: '旧内容',
    size: 3,
    lastModified: 0,
    source: 'url' as const,
  };

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:stub');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  /**
   * 守的是这次改造的病根。
   *
   * 旧实现是 `document.querySelector('.markdown-body')`，而编辑器里**每个块
   * widget 都带这个类名**，只会取到第一块。这里刻意在页面上先摆两个
   * `.markdown-body`（模拟两个块 widget），再把完整正文作为参数传进去：
   * 谁要是把选择器改回来，拿到的就是「只有第一块」那份。
   */
  it('页面上有多个 .markdown-body 时也不受影响', async () => {
    for (const text of ['屏幕上的第一块', '屏幕上的第二块']) {
      const stray = makeContent(`<p>${text}</p>`);
      document.body.appendChild(stray);
    }

    const content = makeContent('<h1>完整标题</h1><p>第一段</p><p>最后一段</p>');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    let saved = '';
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
    const blobs: Blob[] = [];
    const originalBlobText = Blob.prototype.text;
    Blob.prototype.text = function capture(this: Blob): Promise<string> {
      blobs.push(this);
      return originalBlobText.call(this);
    };

    const result = await exportHtml({ doc: DOC, theme: 'light', source: '源文本', content });
    expect(result.status).toBe('done');
    expect(click).toHaveBeenCalled();

    Blob.prototype.text = originalBlobText;
    saved = await (blobs[0] as Blob).text();
    expect(saved).toContain('完整标题');
    expect(saved).toContain('第一段');
    expect(saved).toContain('最后一段');
    expect(saved).not.toContain('屏幕上的第一块');
  });
});

describe('exportMarkdown 导出的是传入的源文本', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:stub');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** store 里的 `doc.content` 可能落后一次尚未回写的改动，不能拿它当准 */
  it('用 context.source 而不是 doc.content', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const blobs: Blob[] = [];
    const originalBlobText = Blob.prototype.text;
    Blob.prototype.text = function capture(this: Blob): Promise<string> {
      blobs.push(this);
      return originalBlobText.call(this);
    };

    await exportMarkdown({
      doc: {
        id: 'file:///tmp/a.md',
        name: 'a.md',
        path: '/tmp/a.md',
        content: 'store 里的旧副本',
        size: 3,
        lastModified: 0,
        source: 'url',
      },
      theme: 'light',
      source: '编辑器里的新文本',
    });

    Blob.prototype.text = originalBlobText;
    const text = await (blobs[0] as Blob).text();
    expect(text).toBe('编辑器里的新文本\n');
  });
});

describe('exportPdf', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('把完整正文挂进 #print-root，afterprint 之后撤掉', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const content = makeContent('<h1>完整标题</h1><p>最后一段</p>');

    exportPdf(content);

    const root = document.getElementById(PRINT_ROOT_ID);
    expect(root).not.toBeNull();
    expect(root?.textContent).toContain('完整标题');
    expect(root?.textContent).toContain('最后一段');
    expect(print).toHaveBeenCalled();

    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById(PRINT_ROOT_ID)).toBeNull();
  });

  it('挂进去的是克隆，原节点不被搬走', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const host = document.createElement('div');
    const content = makeContent('<p>正文</p>');
    host.appendChild(content);
    document.body.appendChild(host);

    exportPdf(content);

    // 离屏渲染那棵树的所有权仍在调用方手上，dispose 还要靠它
    expect(content.parentElement).toBe(host);
  });

  it('纸上不留只有 JS 才能用的按钮', () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    exportPdf(
      makeContent(
        '<figure class="code-block"><figcaption class="code-block__bar">' +
          '<span class="code-block__actions"><button>复制</button></span>' +
          '</figcaption><pre><code>x</code></pre></figure>',
      ),
    );
    expect(document.querySelector(`#${PRINT_ROOT_ID} .code-block__actions`)).toBeNull();
  });
});
