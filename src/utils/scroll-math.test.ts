import { describe, expect, it } from 'vitest';
import { heightInDocument, isWithinScrollTolerance, offsetWithinBlock } from './scroll-math';

describe('heightInDocument', () => {
  it('容器顶部在文档顶部下方时，返回两者的差', () => {
    expect(heightInDocument(500, 100)).toBe(400);
  });

  it('容器顶部与文档顶部重合时，返回 0', () => {
    expect(heightInDocument(100, 100)).toBe(0);
  });

  it('容器顶部在文档顶部上方时（文档前面还有别的内容），夹到 0 而不是负数', () => {
    expect(heightInDocument(80, 100)).toBe(0);
  });
});

describe('offsetWithinBlock', () => {
  it('文档内高度落在行块内部时，返回行内偏移', () => {
    expect(offsetWithinBlock(420, 400)).toBe(20);
  });

  it('文档内高度恰好等于行块顶部时，偏移为 0', () => {
    expect(offsetWithinBlock(400, 400)).toBe(0);
  });

  it('测量误差导致文档内高度略小于行块顶部时，夹到 0 而不是负数', () => {
    expect(offsetWithinBlock(399.5, 400)).toBe(0);
  });
});

describe('isWithinScrollTolerance', () => {
  it('实际值与期望值完全相同时，在容差内', () => {
    expect(isWithinScrollTolerance(100, 100, 2)).toBe(true);
  });

  it('差值恰好等于容差时，仍算在容差内（边界取闭区间）', () => {
    expect(isWithinScrollTolerance(102, 100, 2)).toBe(true);
    expect(isWithinScrollTolerance(98, 100, 2)).toBe(true);
  });

  it('差值超出容差一点时，判定为不在容差内', () => {
    expect(isWithinScrollTolerance(102.5, 100, 2)).toBe(false);
    expect(isWithinScrollTolerance(97.5, 100, 2)).toBe(false);
  });

  it('容差为 0 时，只有完全相等才算在容差内', () => {
    expect(isWithinScrollTolerance(100, 100, 0)).toBe(true);
    expect(isWithinScrollTolerance(100.1, 100, 0)).toBe(false);
  });
});
