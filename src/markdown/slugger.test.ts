import { describe, expect, it } from 'vitest';
import { Slugger, slugify } from './slugger';

describe('slugify', () => {
  it('把空格转成连字符并小写化', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('保留中文标题', () => {
    expect(slugify('一、各素材的开销')).toBe('一各素材的开销');
  });

  it('剔除中英文标点', () => {
    expect(slugify('性能报告：Tri 与 DC（实测）')).toBe('性能报告tri-与-dc实测');
  });

  it('合并连续连字符并去掉首尾连字符', () => {
    expect(slugify('  --a  b--  ')).toBe('a-b');
  });
});

describe('Slugger', () => {
  it('同名标题依次追加序号', () => {
    const slugger = new Slugger();
    expect(slugger.slug('概述')).toBe('概述');
    expect(slugger.slug('概述')).toBe('概述-1');
    expect(slugger.slug('概述')).toBe('概述-2');
  });

  it('纯标点标题回落到 section', () => {
    const slugger = new Slugger();
    expect(slugger.slug('???')).toBe('section');
  });

  it('reset 后重新开始计数', () => {
    const slugger = new Slugger();
    slugger.slug('a');
    slugger.reset();
    expect(slugger.slug('a')).toBe('a');
  });
});
