import type { HostMessage, ViewerMessage } from '@/content/protocol';
import { createLogger } from '@/utils/logger';

const log = createLogger('host-write');

/**
 * 宿主代劳写回的通道。
 *
 * 「浏览器直接打开 .md」这条路径上，阅读器是嵌在 `file://` 页面里的跨源
 * iframe：浏览器禁止这种 iframe 弹出任何文件选择器，它因此既拿不到当前
 * 文件的句柄，也无法换取一个。句柄只能留在宿主页面那一侧，写入经由
 * postMessage 代劳——与目录选择（`pick-folder`）是同一套办法，跨越边界的
 * 始终只有普通数据。
 *
 * ## 令牌能挡住什么、挡不住什么
 *
 * 宿主在接管时随机生成一个令牌，随 `load` 消息送进来；此后凡是会读写用户
 * 文件的请求都带上它，宿主逐条核对。它挡住的是「第三方页面冒充阅读器向
 * 宿主发号施令」。
 *
 * 它**挡不住**反过来的那一面：恶意页面可以自己嵌一个 `viewer.html?embed=1`
 * 并伪造一条带自编令牌的 `load` 消息，阅读器就会把它当宿主。这一点在加入
 * 写回之前就已经存在（伪造 `load` 灌入任意正文），写回没有扩大它——能被
 * 回传出去的只有嵌入方自己塞进来、再由用户在它自己页面里改动过的内容，
 * 阅读器不会因此去读用户的别的文件。如实记在这里，不假装令牌解决了一切。
 */

/** 宿主给的令牌；null 表示还没握手过，或压根不在嵌入模式 */
let nonce: string | null = null;

/** 记下宿主令牌。由 `useEmbeddedDocument` 在收到 `load` 时调用 */
export function setHostNonce(value: string): void {
  nonce = value;
}

/** 当前是否存在可用的宿主通道 */
export function hasHostChannel(): boolean {
  return nonce !== null;
}

/** 仅供测试：清掉握手状态，避免用例之间互相污染 */
export function resetHostChannel(): void {
  nonce = null;
  pending.clear();
}

/** 等待中的请求：消息类型 -> 落点 */
const pending = new Map<string, (message: HostMessage) => void>();

/** 是否已经装过监听器。装一次就够，且不随组件卸载摘掉 */
let listening = false;

function ensureListening(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', (event: MessageEvent) => {
    // 只认父窗口；与 useEmbeddedDocument 的判据一致
    if (event.source !== window.parent) return;
    const data = event.data as { type?: unknown } | null;
    if (typeof data?.type !== 'string') return;
    const settle = pending.get(data.type);
    if (settle) settle(data as HostMessage);
  });
}

/**
 * 发一条请求并等宿主的回音。
 *
 * @param request 要发出去的消息
 * @param outcomes 可能的回音类型；先到的那一条落点，其余一并清掉
 */
function ask(request: ViewerMessage, outcomes: readonly string[]): Promise<HostMessage> {
  ensureListening();
  return new Promise<HostMessage>((resolve) => {
    const settle = (message: HostMessage): void => {
      for (const type of outcomes) pending.delete(type);
      resolve(message);
    };
    for (const type of outcomes) pending.set(type, settle);
    /*
     * 宿主是 `file://` 页面，其 origin 是字符串 "null"，没有具体源可以填，
     * 只能用 '*'。安全性由上面那个令牌承担，取舍见模块头部。
     */
    window.parent.postMessage(request, '*');
  });
}

/** 授权结果 */
export type GrantOutcome =
  /** 宿主已握住句柄；`content` 是磁盘上的真实字节，未必等于页面里那份 */
  | { kind: 'granted'; content: string; lastModified: number }
  | { kind: 'denied'; reason: string; cancelled: boolean }
  /** 不在嵌入模式，压根没有宿主可问 */
  | { kind: 'unavailable' };

/** 请宿主弹选择器，授权写回当前文档。必须在用户手势的调用栈内调用 */
export async function requestWriteGrant(): Promise<GrantOutcome> {
  if (nonce === null) return { kind: 'unavailable' };

  const reply = await ask({ type: 'md-reader:grant-write', nonce }, [
    'md-reader:write-granted',
    'md-reader:write-denied',
  ]);

  if (reply.type === 'md-reader:write-granted') {
    return { kind: 'granted', content: reply.content, lastModified: reply.lastModified };
  }
  if (reply.type === 'md-reader:write-denied') {
    return { kind: 'denied', reason: reply.reason, cancelled: reply.cancelled };
  }
  log.warn('授权请求收到意料之外的回音', reply.type);
  return { kind: 'denied', reason: '宿主页面返回了意料之外的结果', cancelled: false };
}

/** 写回结果 */
export type HostWriteOutcome =
  | { kind: 'written'; lastModified: number }
  /** `stale` 表示磁盘已被外部改动，这次一个字节都没写 */
  | { kind: 'failed'; message: string; stale: boolean };

/**
 * 请宿主把文本写回原文件。
 *
 * @param baseModified 我们认为的磁盘时间戳。宿主写之前会拿它跟真实值比对，
 *   对不上就拒写——嵌入路径上没有任何别的冲突检测，这是唯一的一道闸。
 */
export async function requestHostWrite(
  text: string,
  baseModified: number,
): Promise<HostWriteOutcome> {
  if (nonce === null) return { kind: 'failed', message: '没有可用的宿主通道', stale: false };

  const reply = await ask({ type: 'md-reader:write-file', nonce, text, baseModified }, [
    'md-reader:write-ok',
    'md-reader:write-error',
  ]);

  if (reply.type === 'md-reader:write-ok') {
    return { kind: 'written', lastModified: reply.lastModified };
  }
  if (reply.type === 'md-reader:write-error') {
    return { kind: 'failed', message: reply.message, stale: reply.stale };
  }
  log.warn('写回请求收到意料之外的回音', reply.type);
  return { kind: 'failed', message: '宿主页面返回了意料之外的结果', stale: false };
}
