import{c as n,i as t}from"./index-CJsxlR0Y.js";import{c as o}from"./logger-Bs1cxXFO.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i=n("BookOpen",[["path",{d:"M12 7v14",key:"1akyts"}],["path",{d:"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",key:"ruj8y"}]]),e=o("messaging");async function u(r){if(!t())return e.warn("非扩展环境，消息被忽略",r),null;try{return await chrome.runtime.sendMessage(r)}catch(a){return e.error("消息发送失败",r,a),null}}export{i as B,u as s};
//# sourceMappingURL=messaging-BC1I83FY.js.map
