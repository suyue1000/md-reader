import { useEffect, useRef } from 'react';
import { isEditableTarget, isMacPlatform, matchesCombo, parseCombo } from '@/utils/hotkeys';

/** 一条快捷键绑定 */
export interface HotkeyBinding {
  /** 组合键描述，如 `mod+shift+o` */
  combo: string;
  /** 触发时执行 */
  handler: () => void;
  /** 是否允许在输入框内触发；默认 false */
  allowInInput?: boolean;
  /** 为 false 时这条绑定不生效（例如对应功能当前不可用） */
  enabled?: boolean;
}

/**
 * 全局快捷键。
 *
 * 只在 window 上挂**一个** keydown 监听，而不是每条快捷键各挂一个：
 * 监听器数量与快捷键数量解耦，新增绑定不增加事件系统开销，
 * 也避免了多个监听器之间 preventDefault 的先后顺序问题。
 *
 * 用 ref 持有最新的绑定表，这样调用方不需要为了避免重复绑定而
 * useCallback/useMemo 包裹每个 handler——监听器只在挂载时注册一次。
 */
export function useHotkeys(bindings: readonly HotkeyBinding[]): void {
  const bindingsRef = useRef(bindings);

  // 在 effect 里更新而不是渲染期直接赋值：渲染期写 ref 在并发渲染下
  // 可能被执行多次或被丢弃，React 明确不推荐
  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useEffect(() => {
    const isMac = isMacPlatform();

    const handleKeyDown = (event: KeyboardEvent): void => {
      // 输入法组合输入过程中不响应，否则中文输入会被打断
      if (event.isComposing) return;

      const editable = isEditableTarget(event.target);

      for (const binding of bindingsRef.current) {
        if (binding.enabled === false) continue;
        if (editable && binding.allowInInput !== true) continue;
        if (!matchesCombo(event, parseCombo(binding.combo), isMac)) continue;

        // 命中即拦截：这些组合（Ctrl+O / Ctrl+P）在浏览器里有默认行为，
        // 不阻止的话会同时触发浏览器的打开文件、打印对话框
        event.preventDefault();
        binding.handler();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
