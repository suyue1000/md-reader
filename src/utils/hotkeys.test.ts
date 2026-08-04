import { describe, expect, it } from 'vitest';
import { formatCombo, isEditableTarget, matchesCombo, parseCombo } from './hotkeys';

/** 构造一个最小的键盘事件替身 */
function keyEvent(init: {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: init.key,
    ctrlKey: init.ctrl ?? false,
    metaKey: init.meta ?? false,
    shiftKey: init.shift ?? false,
    altKey: init.alt ?? false,
  });
}

describe('parseCombo', () => {
  it('解析单键', () => {
    expect(parseCombo('o')).toEqual({ key: 'o', mod: false, shift: false, alt: false });
  });

  it('解析带修饰键的组合', () => {
    expect(parseCombo('mod+shift+o')).toEqual({ key: 'o', mod: true, shift: true, alt: false });
  });

  it('大小写与空格不敏感', () => {
    expect(parseCombo(' MOD + Shift + O ')).toEqual({
      key: 'o',
      mod: true,
      shift: true,
      alt: false,
    });
  });

  it('支持标点主键', () => {
    expect(parseCombo('mod+,')).toEqual({ key: ',', mod: true, shift: false, alt: false });
  });
});

describe('matchesCombo', () => {
  const modO = parseCombo('mod+o');

  it('Windows 上 mod 映射到 Ctrl', () => {
    expect(matchesCombo(keyEvent({ key: 'o', ctrl: true }), modO, false)).toBe(true);
    expect(matchesCombo(keyEvent({ key: 'o', meta: true }), modO, false)).toBe(false);
  });

  it('Mac 上 mod 映射到 Cmd', () => {
    expect(matchesCombo(keyEvent({ key: 'o', meta: true }), modO, true)).toBe(true);
    expect(matchesCombo(keyEvent({ key: 'o', ctrl: true }), modO, true)).toBe(false);
  });

  it('多余的修饰键不匹配', () => {
    // Ctrl+Shift+O 不应该命中 mod+o，否则一个快捷键会吃掉一批相近组合
    expect(matchesCombo(keyEvent({ key: 'O', ctrl: true, shift: true }), modO, false)).toBe(false);
  });

  it('Shift 组合按大写键上报时仍能匹配', () => {
    const modShiftO = parseCombo('mod+shift+o');
    expect(matchesCombo(keyEvent({ key: 'O', ctrl: true, shift: true }), modShiftO, false)).toBe(
      true,
    );
  });

  it('主键不同不匹配', () => {
    expect(matchesCombo(keyEvent({ key: 'p', ctrl: true }), modO, false)).toBe(false);
  });
});

describe('formatCombo', () => {
  it('Mac 上用符号表示修饰键', () => {
    expect(formatCombo('mod+shift+o', true)).toBe('⌘⇧O');
    expect(formatCombo('mod+,', true)).toBe('⌘,');
  });

  it('其它平台用文字表示', () => {
    expect(formatCombo('mod+shift+o', false)).toBe('Ctrl+Shift+O');
    expect(formatCombo('mod+,', false)).toBe('Ctrl+,');
  });
});

describe('isEditableTarget', () => {
  it('识别输入框与文本域', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('select'))).toBe(true);
  });

  it('普通元素不算可编辑', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('contenteditable 算可编辑', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    // jsdom 不实现 isContentEditable，这里显式模拟浏览器行为
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isEditableTarget(div)).toBe(true);
  });
});
