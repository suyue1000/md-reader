import { describe, expect, it } from 'vitest';
import { createVersionBuffer } from './versions';

describe('createVersionBuffer', () => {
  it('后进先出', () => {
    const buffer = createVersionBuffer(5);
    buffer.push('甲');
    buffer.push('乙');
    expect(buffer.pop()).toBe('乙');
    expect(buffer.pop()).toBe('甲');
  });

  it('空缓冲弹出 null', () => {
    expect(createVersionBuffer(5).pop()).toBeNull();
  });

  it('超出容量时丢掉最旧的一版', () => {
    const buffer = createVersionBuffer(2);
    buffer.push('甲');
    buffer.push('乙');
    buffer.push('丙');
    expect(buffer.size).toBe(2);
    expect(buffer.pop()).toBe('丙');
    expect(buffer.pop()).toBe('乙');
    expect(buffer.pop()).toBeNull();
  });

  it('内容与上一版相同时不重复入栈', () => {
    const buffer = createVersionBuffer(5);
    buffer.push('甲');
    buffer.push('甲');
    expect(buffer.size).toBe(1);
  });
});
