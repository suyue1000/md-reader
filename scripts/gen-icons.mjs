/**
 * 生成扩展图标（无第三方依赖，直接输出 PNG）。
 *
 * 为什么手写 PNG 编码器：
 * - 扩展只需要 4 张纯色 + 简单图形的图标，引入 sharp / canvas 这类
 *   带原生编译的依赖会拖慢 CI 并增加安装失败面。
 * - 图标是构建产物而非源码，纳入 .gitignore，由 `npm run icons` 生成。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
const SIZES = [16, 32, 48, 128];

/** CRC32 查表 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** 计算 CRC32 */
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 组装一个 PNG chunk */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

/** 将 RGBA 像素数组编码为 PNG 文件 */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type: None
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 点到线段的距离，用于绘制带抗锯齿的笔画 */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 圆角矩形的有符号距离 */
function roundedRectDist(px, py, w, h, r) {
  const qx = Math.abs(px - w / 2) - (w / 2 - r);
  const qy = Math.abs(py - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 以 4x 超采样绘制单个尺寸的图标 */
function drawIcon(size) {
  const SS = 4; // supersampling
  const rgba = Buffer.alloc(size * size * 4);
  // 品牌色渐变（左上 -> 右下）
  const c1 = [37, 99, 235]; // blue-600
  const c2 = [124, 58, 237]; // violet-600

  // "M" 笔画的归一化坐标（0~1）
  const strokes = [
    [0.26, 0.72, 0.26, 0.3],
    [0.26, 0.3, 0.5, 0.56],
    [0.5, 0.56, 0.74, 0.3],
    [0.74, 0.3, 0.74, 0.72],
  ];
  const strokeWidth = size * 0.085;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          const inBg = roundedRectDist(px, py, size, size, size * 0.22) <= 0;
          if (!inBg) continue;

          const t = (px / size + py / size) / 2;
          let r = c1[0] + (c2[0] - c1[0]) * t;
          let g = c1[1] + (c2[1] - c1[1]) * t;
          let b = c1[2] + (c2[2] - c1[2]) * t;

          let minDist = Infinity;
          for (const [ax, ay, bx, by] of strokes) {
            minDist = Math.min(
              minDist,
              distToSegment(px, py, ax * size, ay * size, bx * size, by * size),
            );
          }
          if (minDist <= strokeWidth / 2) {
            r = 255;
            g = 255;
            b = 255;
          }
          rSum += r;
          gSum += g;
          bSum += b;
          aSum += 255;
        }
      }
      const samples = SS * SS;
      const idx = (y * size + x) * 4;
      const alpha = aSum / samples;
      if (alpha > 0) {
        // 预乘还原：颜色按已覆盖的采样数求均值
        const covered = aSum / 255;
        rgba[idx] = Math.round(rSum / covered);
        rgba[idx + 1] = Math.round(gSum / covered);
        rgba[idx + 2] = Math.round(bSum / covered);
      }
      rgba[idx + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  writeFileSync(resolve(OUT_DIR, `icon-${size}.png`), drawIcon(size));
}
process.stdout.write(`icons generated: ${SIZES.join(', ')}\n`);
