/**
 * 打出可上传 Chrome 应用商店的 zip。
 *
 *   npm run package
 *
 * 与直接压缩 dist/ 的区别有两点：
 * 1. **剔除 sourcemap**。它们占了产物体积的绝大部分，而商店包里没人会用到；
 *    留着既拖慢审核上传，也等于把完整源码一并发出去。
 * 2. **上传前自检**。商店的拒审理由里，"申报了用不到的权限" 和
 *    "manifest 与实际文件对不上" 占了很大比例，这些都能在本地先发现。
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const outDir = join(root, 'release');

/** 不进商店包的文件 */
function isExcluded(path) {
  return path.endsWith('.map') || path.endsWith('.DS_Store');
}

/** 递归列出目录下的全部文件（相对 dist） */
async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else files.push(relative(dist, full));
  }
  return files;
}

/** 上传前自检；返回问题列表 */
async function audit(manifest, files) {
  const problems = [];
  const has = (path) => files.includes(path);

  // manifest 里点名的文件必须真的存在——路径写错在本地跑不出错，
  // 因为开发时走的是 vite 的 dev server
  const referenced = [
    manifest.background?.service_worker,
    manifest.options_ui?.page,
    manifest.action?.default_popup,
    ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
    ...Object.values(manifest.icons ?? {}),
  ].filter(Boolean);

  for (const path of referenced) {
    if (!has(path)) problems.push(`manifest 引用了不存在的文件：${path}`);
  }

  // 本地化：声明了 default_locale 就必须有对应的 messages.json，
  // 且 __MSG_xxx__ 占位符都能查到
  if (manifest.default_locale) {
    const messagesPath = `_locales/${manifest.default_locale}/messages.json`;
    if (!has(messagesPath)) {
      problems.push(`缺少默认语言文件：${messagesPath}`);
    } else {
      const messages = JSON.parse(await readFile(join(dist, messagesPath), 'utf8'));
      const raw = JSON.stringify(manifest);
      for (const [, key] of raw.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
        if (!(key in messages)) problems.push(`占位符 __MSG_${key}__ 在 messages.json 里没有定义`);
      }
    }
  }

  if (!has('manifest.json')) problems.push('产物里没有 manifest.json');
  if (files.some((f) => f.endsWith('.map'))) problems.push('产物里仍有 sourcemap');

  return problems;
}

async function main() {
  const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
  const all = await listFiles(dist);
  const included = all.filter((path) => !isExcluded(path));

  const problems = await audit(manifest, included);
  if (problems.length > 0) {
    console.error('自检未通过：');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(outDir, { recursive: true });
  const zipPath = join(outDir, `md-reader-v${manifest.version}.zip`);
  await rm(zipPath, { force: true });

  // 用系统 zip 而不是引入打包依赖：这是一次性的发布动作，
  // 为它增加一个生产依赖不值得
  await run('zip', ['-q', '-X', '-r', zipPath, ...included], { cwd: dist });

  const { size } = await stat(zipPath);
  const excluded = all.length - included.length;
  console.log(`已打包 ${zipPath}`);
  console.log(`  文件 ${included.length} 个（剔除 sourcemap 等 ${excluded} 个）`);
  console.log(`  体积 ${(size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  版本 ${manifest.version}`);
  console.log(`  权限 ${JSON.stringify(manifest.permissions ?? [])}`);
  console.log(`  主机权限 ${JSON.stringify(manifest.host_permissions ?? [])}`);
}

await main();
