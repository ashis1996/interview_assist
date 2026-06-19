// Placeholder brand-icon generator for the dev release.
//
// Produces, using ONLY Node.js built-ins (zlib, fs, buffer):
//   - build/icon.png  (512x512, RGBA, PNG)
//   - build/icon.ico  (multi-size 16/24/32/48/64/128/256, PNG-in-ICO)
//
// The mark is a flat brand-colored rounded square with a centered filled
// circle and a small "notch" cut, an acceptable clean placeholder for dev.
// Re-run with:  node packages/desktop/build/generate-icons.mjs
//
// PNG-in-ICO is valid and supported by modern Windows for these sizes.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

// ---- Brand palette (placeholder) -------------------------------------------
const BRAND = { r: 0x4f, g: 0x46, b: 0xe5 }; // indigo-600
const BRAND_DK = { r: 0x3a, g: 0x32, b: 0xc9 }; // subtle inner shade
const MARK = { r: 0xff, g: 0xff, b: 0xff }; // white glyph

// ---- CRC32 (PNG) -----------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- PNG chunk + encoder ---------------------------------------------------
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA (truecolor + alpha)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Pixel drawing ---------------------------------------------------------
// Returns an RGBA Buffer (length n*n*4) of the placeholder mark at size n.
function drawMark(n) {
  const buf = Buffer.alloc(n * n * 4); // transparent by default

  const margin = n * 0.055;
  const radius = n * 0.235; // rounded-square corner radius
  const left = margin;
  const right = n - margin;
  const top = margin;
  const bottom = n - margin;

  const cx = n / 2;
  const cy = n / 2;
  const circleR = n * 0.275; // centered glyph circle

  // simple supersampled coverage for crisp edges
  const SS = 3;
  const ssStep = 1 / SS;

  const inRoundedRect = (x, y) => {
    if (x < left || x > right || y < top || y > bottom) return false;
    // corner test
    const dxL = left + radius - x;
    const dxR = x - (right - radius);
    const dyT = top + radius - y;
    const dyB = y - (bottom - radius);
    const ax = Math.max(dxL, dxR, 0);
    const ay = Math.max(dyT, dyB, 0);
    return ax * ax + ay * ay <= radius * radius;
  };

  const inCircle = (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= circleR * circleR;
  };

  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      let rectHits = 0;
      let circleHits = 0;
      let total = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) * ssStep;
          const y = py + (sy + 0.5) * ssStep;
          total++;
          if (inRoundedRect(x, y)) {
            rectHits++;
            if (inCircle(x, y)) circleHits++;
          }
        }
      }
      if (rectHits === 0) continue;

      const rectCov = rectHits / total;
      const circleCov = circleHits / total;

      // vertical gradient on the brand square for a touch of depth
      const t = py / n;
      const bg = {
        r: Math.round(BRAND.r + (BRAND_DK.r - BRAND.r) * t),
        g: Math.round(BRAND.g + (BRAND_DK.g - BRAND.g) * t),
        b: Math.round(BRAND.b + (BRAND_DK.b - BRAND.b) * t),
      };

      // composite glyph (circle) over the brand square within the rect coverage
      const circleFrac = rectCov > 0 ? circleCov / rectCov : 0;
      const r = Math.round(bg.r + (MARK.r - bg.r) * circleFrac);
      const g = Math.round(bg.g + (MARK.g - bg.g) * circleFrac);
      const b = Math.round(bg.b + (MARK.b - bg.b) * circleFrac);
      const a = Math.round(255 * rectCov);

      const o = (py * n + px) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = a;
    }
  }

  return buf;
}

// ---- ICO assembly (PNG-in-ICO) ---------------------------------------------
function buildICO(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  const datas = [];
  let offset = 6 + count * 16;

  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry[0] = img.size >= 256 ? 0 : img.size; // width (0 == 256)
    entry[1] = img.size >= 256 ? 0 : img.size; // height (0 == 256)
    entry[2] = 0; // palette color count
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.png.length, 8); // bytes of image data
    entry.writeUInt32LE(offset, 12); // offset of image data
    entries.push(entry);
    datas.push(img.png);
    offset += img.png.length;
  }

  return Buffer.concat([header, ...entries, ...datas]);
}

// ---- Generate --------------------------------------------------------------
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const pngPath = join(OUT_DIR, 'icon.png');
const icoPath = join(OUT_DIR, 'icon.ico');

// 512px master PNG
const png512 = encodePNG(512, 512, drawMark(512));
writeFileSync(pngPath, png512);

// Multi-size ICO (each size drawn natively for crisp small icons)
const icoImages = ICO_SIZES.map((size) => ({
  size,
  png: encodePNG(size, size, drawMark(size)),
}));
const ico = buildICO(icoImages);
writeFileSync(icoPath, ico);

console.log(`Wrote ${pngPath} (${png512.length} bytes)`);
console.log(`Wrote ${icoPath} (${ico.length} bytes) sizes: ${ICO_SIZES.join(', ')}`);
