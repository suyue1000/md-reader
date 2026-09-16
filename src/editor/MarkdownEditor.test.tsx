import { render, screen, waitFor } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from './MarkdownEditor';

/**
 * 等待渲染管线就绪的上限。
 *
 * 组件挂载后要动态 import 整条 Markdown 管线并注册全部内置插件，
 * vitest 下这是一次真实的模块转译，默认的 1s 不够用。
 */
const READY_TIMEOUT = 15_000;

describe('MarkdownEditor', () => {
  it('只读态下把标题渲染成 h1 而不是源码', async () => {
    render(<MarkdownEditor value="# 你好" documentId="doc:a" readOnly />);
    await waitFor(
      () => {
        // 标题里还有 markdown-it-anchor 插进去的 `#` 永久链接，用 contain 而非全等
        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('你好');
      },
      { timeout: READY_TIMEOUT },
    );
  });

  it('换文档时重建内容', async () => {
    const { rerender } = render(<MarkdownEditor value="# 甲" documentId="doc:a" readOnly />);
    await waitFor(
      () => {
        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('甲');
      },
      { timeout: READY_TIMEOUT },
    );

    rerender(<MarkdownEditor value="# 乙" documentId="doc:b" readOnly />);
    await waitFor(
      () => {
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading.textContent).toContain('乙');
        // 旧文档必须真的消失，而不是新内容追加在后面
        expect(heading.textContent).not.toContain('甲');
      },
      { timeout: READY_TIMEOUT },
    );
  });

  it('创建后通过 onViewReady 暴露实例，卸载前传 null', async () => {
    const onViewReady = vi.fn<(view: EditorView | null) => void>();
    const { unmount } = render(
      <MarkdownEditor value="# 你好" documentId="doc:a" readOnly onViewReady={onViewReady} />,
    );

    // onViewReady 现在要等首轮块渲染跑完才触发，等同于等 Markdown 管线加载完
    await waitFor(
      () => {
        expect(onViewReady).toHaveBeenCalledTimes(1);
        expect(onViewReady.mock.calls[0]?.[0]).not.toBeNull();
      },
      { timeout: READY_TIMEOUT },
    );

    unmount();
    expect(onViewReady).toHaveBeenLastCalledWith(null);
  });

  it('onViewReady 回调时首轮内容已经渲染完成，而不是还停在源码形态', async () => {
    // 这是对 Critical 缺陷的回归测试：onViewReady 一旦提前于块渲染触发，
    // 依赖它换算像素位置的消费方（阅读位置恢复）就会按源码的行高算出
    // 错误的滚动目标。用回调触发时 DOM 里是否已经有渲染出的标题来判定。
    let headingRenderedWhenReady = false;
    const onViewReady = vi.fn<(view: EditorView | null) => void>((view) => {
      if (view) {
        headingRenderedWhenReady = screen.queryByRole('heading', { level: 1 }) !== null;
      }
    });

    render(<MarkdownEditor value="# 你好" documentId="doc:a" readOnly onViewReady={onViewReady} />);

    await waitFor(() => expect(onViewReady).toHaveBeenCalled(), { timeout: READY_TIMEOUT });
    expect(headingRenderedWhenReady).toBe(true);
  });

  it('一轮增强结束后回调 onEnhanced', async () => {
    const onEnhanced = vi.fn();
    render(<MarkdownEditor value="# 你好" documentId="doc:a" readOnly onEnhanced={onEnhanced} />);

    await waitFor(() => expect(onEnhanced).toHaveBeenCalled(), { timeout: READY_TIMEOUT });
  });
});
