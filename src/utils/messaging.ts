import { isExtensionContext } from './env';
import { createLogger } from './logger';

const log = createLogger('messaging');

/**
 * 扩展内部消息协议。
 *
 * 用可辨识联合（discriminated union）而不是随手传 object：
 * 新增一种消息时，TypeScript 会强制 background 的 switch 覆盖它，
 * 避免出现「发了消息但没人处理」的静默失败。
 */
export type RuntimeMessage =
  /** 请求打开阅读器标签页 */
  | { type: 'open-viewer' }
  /** 请求打开设置页 */
  | { type: 'open-options' }
  /** 查询扩展版本，用于状态栏与问题排查 */
  | { type: 'get-version' };

/** 各消息对应的响应类型 */
export interface RuntimeResponseMap {
  'open-viewer': { tabId: number | null };
  'open-options': { ok: boolean };
  'get-version': { version: string };
}

/** 发送消息并获得类型正确的响应 */
export async function sendMessage<T extends RuntimeMessage['type']>(
  message: Extract<RuntimeMessage, { type: T }>,
): Promise<RuntimeResponseMap[T] | null> {
  if (!isExtensionContext()) {
    log.warn('非扩展环境，消息被忽略', message);
    return null;
  }
  try {
    return await chrome.runtime.sendMessage<typeof message, RuntimeResponseMap[T]>(message);
  } catch (error) {
    log.error('消息发送失败', message, error);
    return null;
  }
}
