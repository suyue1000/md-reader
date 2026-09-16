import { beforeEach, describe, expect, it } from 'vitest';
import { clearSelfWrites, isSelfWrite, recordSelfWrite } from './self-write';

describe('self-write', () => {
  beforeEach(clearSelfWrites);

  it('登记过的内容与时间戳会被认出来', () => {
    recordSelfWrite('正文', 1000);
    expect(isSelfWrite('正文', 1000)).toBe(true);
  });

  it('内容相同但时间戳不同，不算自写', () => {
    recordSelfWrite('正文', 1000);
    expect(isSelfWrite('正文', 2000)).toBe(false);
  });

  it('未登记的内容不算自写', () => {
    expect(isSelfWrite('别的正文', 1000)).toBe(false);
  });

  it('只保留最近若干条，旧登记会被淘汰', () => {
    for (let i = 0; i < 20; i++) recordSelfWrite(`v${String(i)}`, i);
    expect(isSelfWrite('v0', 0)).toBe(false);
    expect(isSelfWrite('v19', 19)).toBe(true);
  });
});
