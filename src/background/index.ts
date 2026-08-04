import type { RuntimeMessage, RuntimeResponseMap } from '@/utils/messaging';
import { createLogger } from '@/utils/logger';

/**
 * Service Worker。
 *
 * MV3 的 SW 随时会被回收，因此这里遵守两条纪律：
 * 1. 不保存任何内存状态——所有状态都在 chrome.storage 里；
 * 2. 所有监听器在模块顶层同步注册，否则 SW 被唤醒后可能错过事件。
 */

const log = createLogger('background');

/** 阅读器页面地址 */
const VIEWER_URL = 'viewer.html';

/** 记住阅读器标签页 id 的 session 存储键 */
const VIEWER_TAB_KEY = 'viewerTabId';

/**
 * 找出已经开着的阅读器标签页。
 *
 * 刻意**不用** `chrome.tabs.query({ url })` —— 按 URL 查询需要 `tabs` 权限，
 * 而那个权限在商店页面上会显示成「读取您的浏览记录」。为了「不重复开标签页」
 * 这点便利去要一个听起来能看光用户浏览历史的权限，不划算。
 *
 * 改为自己记住创建过的标签页 id：`tabs.get` 取基本信息不需要该权限
 * （拿不到 url/title，但这里也用不上）。id 存在 session 区，浏览器一关就没，
 * 正好符合它的生命周期。
 */
async function findExistingViewer(): Promise<number | null> {
  try {
    const stored = await chrome.storage.session.get(VIEWER_TAB_KEY);
    const tabId = stored[VIEWER_TAB_KEY] as number | undefined;
    if (typeof tabId !== 'number') return null;

    // 标签页可能已被关闭，get 会抛错
    await chrome.tabs.get(tabId);
    return tabId;
  } catch {
    return null;
  }
}

/** 打开（或聚焦已有的）阅读器标签页 */
async function openViewer(): Promise<number | null> {
  const existing = await findExistingViewer();
  if (existing !== null) {
    const tab = await chrome.tabs.update(existing, { active: true });
    if (tab?.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return existing;
  }

  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(VIEWER_URL) });
  if (tab.id !== undefined) {
    await chrome.storage.session.set({ [VIEWER_TAB_KEY]: tab.id });
  }
  return tab.id ?? null;
}

// 首次安装时打开阅读器，让用户立刻看到入口
chrome.runtime.onInstalled.addListener((details) => {
  log.info('扩展已安装/更新', details.reason);
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void openViewer();
  }
});

/**
 * 消息路由。
 *
 * 返回 true 以保持消息通道开启（异步响应），这是 MV3 里最常见的坑：
 * 忘记返回 true 会让 sendMessage 的 Promise 直接 resolve 成 undefined。
 */
chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse: (response: unknown) => void): boolean => {
    switch (message.type) {
      case 'open-viewer': {
        void openViewer().then((tabId) => {
          const response: RuntimeResponseMap['open-viewer'] = { tabId };
          sendResponse(response);
        });
        return true;
      }
      case 'open-options': {
        void chrome.runtime.openOptionsPage().then(() => {
          const response: RuntimeResponseMap['open-options'] = { ok: true };
          sendResponse(response);
        });
        return true;
      }
      case 'get-version': {
        const response: RuntimeResponseMap['get-version'] = {
          version: chrome.runtime.getManifest().version,
        };
        sendResponse(response);
        return false;
      }
      default: {
        // 穷尽性检查：新增消息类型但漏了分支时会在编译期报错
        const exhaustive: never = message;
        log.warn('收到未知消息', exhaustive);
        return false;
      }
    }
  },
);
