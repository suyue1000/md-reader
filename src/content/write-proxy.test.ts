import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearWriteHandle, grantWrite, writeCurrentFile } from './index';
import type { HostMessage } from './protocol';

/**
 * 宿主代劳写回的两道闸。
 *
 * 它们挡的都是不可逆、且没有回收站的事：把甲的内容写进乙、覆盖掉别的程序
 * 刚写进去的东西。这两件事一旦发生，用户没有任何找回的办法。
 */

let replies: HostMessage[];
const reply = (message: HostMessage): void => void replies.push(message);

/** 造一个只有本测试用得到的那几个方法的文件句柄替身 */
function fakeHandle(name: string) {
  const written: string[] = [];
  const stream = {
    write: vi.fn((data: string) => {
      written.push(data);
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  const getFile = vi.fn();
  const createWritable = vi.fn(() => Promise.resolve(stream));
  const handle = { name, getFile, createWritable } as unknown as FileSystemFileHandle;
  return { handle, getFile, createWritable, stream, written };
}

/** 让选择器返回指定句柄，并记下它收到的选项 */
function pickerReturns(handle: FileSystemFileHandle): { options: Record<string, unknown>[] } {
  const options: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'showOpenFilePicker',
    vi.fn((received: Record<string, unknown>) => {
      options.push(received);
      return Promise.resolve([handle]);
    }),
  );
  return { options };
}

beforeEach(() => {
  replies = [];
  clearWriteHandle();
  // fileNameFrom 读的是 location.href，当前文档定为 甲.md
  history.replaceState(null, '', '/甲.md');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearWriteHandle();
  history.replaceState(null, '', '/');
});

describe('第一道闸：授权时校验选中的是不是同一个文件', () => {
  it('选中的文件名与当前文档一致时放行，并交出磁盘上的真实内容', async () => {
    const f = fakeHandle('甲.md');
    f.getFile.mockResolvedValue({ text: () => Promise.resolve('磁盘上的正文'), lastModified: 111 });
    pickerReturns(f.handle);

    await grantWrite(reply);

    expect(replies).toEqual([
      { type: 'md-reader:write-granted', content: '磁盘上的正文', lastModified: 111 },
    ]);
  });

  it('选错了别的文件时硬拒绝——放行一次就是把甲的内容写进乙', async () => {
    const f = fakeHandle('乙.md');
    f.getFile.mockResolvedValue({ text: () => Promise.resolve('乙的正文'), lastModified: 111 });
    pickerReturns(f.handle);

    await grantWrite(reply);

    expect(replies[0]).toMatchObject({ type: 'md-reader:write-denied', cancelled: false });
    // 连磁盘都不该去读，更不该留下句柄
    expect(f.getFile).not.toHaveBeenCalled();
  });

  it('被拒之后并没有留下句柄：紧接着的写回必须失败', async () => {
    /*
     * 替身必须配上能正常读出内容的 getFile。不配的话，一旦文件名闸被拆掉，
     * 授权会在 `file.text()` 上抛异常、被 catch 吞掉，句柄照样没留下——断言
     * 碰巧仍然成立，这条用例就守不住任何东西了（反向验证实测如此）。
     */
    const f = fakeHandle('乙.md');
    f.getFile.mockResolvedValue({ text: () => Promise.resolve('乙的正文'), lastModified: 111 });
    pickerReturns(f.handle);
    await grantWrite(reply);

    replies = [];
    await writeCurrentFile('任何内容', 111, reply);

    expect(replies).toEqual([
      { type: 'md-reader:write-error', message: '尚未授权写回', stale: false },
    ]);
    expect(f.createWritable).not.toHaveBeenCalled();
  });

  it('用户取消选择时如实报 cancelled，调用方据此不弹提示', async () => {
    vi.stubGlobal(
      'showOpenFilePicker',
      vi.fn(() => Promise.reject(new DOMException('用户取消', 'AbortError'))),
    );

    await grantWrite(reply);

    expect(replies[0]).toMatchObject({ type: 'md-reader:write-denied', cancelled: true });
  });

  it('中文文件名要对得上——地址里是百分号编码，句柄给的是原文', async () => {
    /*
     * 回归：`fileNameFrom` 少一次 decodeURIComponent，这道闸就会永远拒绝，
     * 功能一次都用不了。用户真实文档的路径正是这种形态。
     */
    history.replaceState(null, '', `/${encodeURIComponent('1-准备清单.md')}`);
    const f = fakeHandle('1-准备清单.md');
    f.getFile.mockResolvedValue({ text: () => Promise.resolve('正文'), lastModified: 5 });
    pickerReturns(f.handle);

    await grantWrite(reply);

    expect(replies[0]?.type).toBe('md-reader:write-granted');
  });
});

describe('选择器开在哪里', () => {
  /** 授权走通所需的最小布置 */
  function readyHandle(name: string) {
    const f = fakeHandle(name);
    f.getFile.mockResolvedValue({ text: () => Promise.resolve('正文'), lastModified: 5 });
    return f;
  }

  it('从当前文件所属的知名目录打开，用户少翻几层', async () => {
    /*
     * 浏览器不接受任意路径作为起始位置，只认知名目录常量。这是能给出的
     * 最精确的提示——加上固定的 id，第二次起浏览器会直接停在上次那个目录。
     */
    history.replaceState(null, '', '/Users/suyue/Desktop/github/甲.md');
    const f = readyHandle('甲.md');
    const picker = pickerReturns(f.handle);

    await grantWrite(reply);

    expect(picker.options[0]).toMatchObject({ id: 'md-reader-write', startIn: 'desktop' });
  });

  it('认不出知名目录时不传 startIn，交给浏览器用默认位置', async () => {
    // 传一个浏览器不认的值会让选择器直接抛错，宁可不传
    history.replaceState(null, '', '/var/tmp/甲.md');
    const f = readyHandle('甲.md');
    const picker = pickerReturns(f.handle);

    await grantWrite(reply);

    expect(picker.options[0]).not.toHaveProperty('startIn');
  });
});

describe('第二道闸：写之前自检磁盘时间戳', () => {
  /** 先完成一次授权，拿到句柄 */
  async function grant(mtime: number) {
    const f = fakeHandle('甲.md');
    f.getFile.mockResolvedValue({ text: () => Promise.resolve('磁盘上的正文'), lastModified: mtime });
    pickerReturns(f.handle);
    await grantWrite(reply);
    replies = [];
    f.getFile.mockReset();
    return f;
  }

  it('时间戳对得上时正常写入，并回传新的时间戳', async () => {
    const f = await grant(111);
    f.getFile
      .mockResolvedValueOnce({ lastModified: 111 })
      .mockResolvedValueOnce({ lastModified: 222 });

    await writeCurrentFile('新的正文', 111, reply);

    expect(replies).toEqual([{ type: 'md-reader:write-ok', lastModified: 222 }]);
  });

  it('写进去的是原样的文本，一个字符都不改', async () => {
    // 「保存不做任何文本规整」是这条链路的底线
    const f = await grant(111);
    f.getFile
      .mockResolvedValueOnce({ lastModified: 111 })
      .mockResolvedValueOnce({ lastModified: 222 });
    const text = '行尾有空格   \r\n混合换行\n末尾没有换行';

    await writeCurrentFile(text, 111, reply);

    expect(f.written).toEqual([text]);
  });

  it('磁盘已被别的程序改过时拒写，且一个字节都没有写出去', async () => {
    /*
     * 这条是整条路径上唯一的冲突闸门：嵌入文档 source 是 'url'，
     * useAutoRefresh 只对 'fs-handle' 轮询，别处没有任何地方能发现磁盘变了。
     * 断言 createWritable 没被调用，而不只是看回传的消息——真正要守的是
     * 「没有发生写入」这件事本身。
     */
    const f = await grant(111);
    f.getFile.mockResolvedValue({ lastModified: 999 });

    await writeCurrentFile('新的正文', 111, reply);

    expect(replies).toEqual([
      { type: 'md-reader:write-error', message: '磁盘上的文件已被其它程序改动', stale: true },
    ]);
    expect(f.createWritable).not.toHaveBeenCalled();
    expect(f.written).toEqual([]);
  });

  it('写入过程出错时如实报错，且不标成 stale', async () => {
    const f = await grant(111);
    f.getFile.mockResolvedValueOnce({ lastModified: 111 });
    f.createWritable.mockRejectedValueOnce(new Error('磁盘已满'));

    await writeCurrentFile('新的正文', 111, reply);

    expect(replies).toEqual([
      { type: 'md-reader:write-error', message: '磁盘已满', stale: false },
    ]);
  });
});
