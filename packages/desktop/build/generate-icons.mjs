// Brand-icon generator for the dev release.
//
// Builds, using ONLY Node.js built-ins (zlib, fs, buffer), the app/taskbar/
// overlay-window icons from the real source artwork
// (build/icon-source.png — the Icons8 "natural food / peach" 3D-fluency image):
//   - build/icon.png  (256x256, RGBA, PNG)
//   - build/icon.ico  (multi-size 16/24/32/48/64/128/256, PNG-in-ICO)
//
// The source is decoded (PNG, 8-bit RGBA) and resized with alpha-aware bilinear
// sampling, then re-encoded. Re-run with:
//   node packages/desktop/build/generate-icons.mjs
//
// PNG-in-ICO is valid and supported by modern Windows for these sizes.

import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

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

// ---- PNG decode (8-bit, color types 6=RGBA / 2=RGB / 0=gray) ---------------
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Returns { width, height, rgba } where rgba is a Buffer of width*height*4.
function decodePNG(buf) {
  if (
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    throw new Error('not a PNG file');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatParts = [];

  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (type === 'IDAT') {
      idatParts.push(buf.subarray(dataStart, dataStart + len));
    } else if (type === 'IEND') {
      break;
    }
    off = dataStart + len + 4; // skip data + CRC
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (channels === 0) throw new Error(`unsupported color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);

  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= channels ? cur[i - channels] : 0; // left
      const b = prev[i]; // up
      const c = i >= channels ? prev[i - channels] : 0; // up-left
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`bad filter ${filter}`);
      }
      cur[i] = v & 0xff;
    }
    // expand to RGBA
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (channels === 4) {
        const s = x * 4;
        out[o] = cur[s];
        out[o + 1] = cur[s + 1];
        out[o + 2] = cur[s + 2];
        out[o + 3] = cur[s + 3];
      } else if (channels === 3) {
        const s = x * 3;
        out[o] = cur[s];
        out[o + 1] = cur[s + 1];
        out[o + 2] = cur[s + 2];
        out[o + 3] = 255;
      } else {
        const g = cur[x];
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = 255;
      }
    }
    cur.copy(prev);
  }

  return { width, height, rgba: out };
}

// ---- Resize (alpha-premultiplied bilinear) ---------------------------------
function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const sample = (sx, sy) => {
    // clamp
    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    if (sx > sw - 1) sx = sw - 1;
    if (sy > sh - 1) sy = sh - 1;
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(x0 + 1, sw - 1);
    const y1 = Math.min(y0 + 1, sh - 1);
    const fx = sx - x0;
    const fy = sy - y0;

    const get = (x, y) => {
      const o = (y * sw + x) * 4;
      const a = src[o + 3] / 255;
      // premultiply
      return [src[o] * a, src[o + 1] * a, src[o + 2] * a, src[o + 3]];
    };
    const p00 = get(x0, y0);
    const p10 = get(x1, y0);
    const p01 = get(x0, y1);
    const p11 = get(x1, y1);

    const lerp = (a, b, t) => a + (b - a) * t;
    const r = lerp(lerp(p00[0], p10[0], fx), lerp(p01[0], p11[0], fx), fy);
    const g = lerp(lerp(p00[1], p10[1], fx), lerp(p01[1], p11[1], fx), fy);
    const b = lerp(lerp(p00[2], p10[2], fx), lerp(p01[2], p11[2], fx), fy);
    const a = lerp(lerp(p00[3], p10[3], fx), lerp(p01[3], p11[3], fx), fy);
    return [r, g, b, a];
  };

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      // map dest pixel center to source space
      const sx = ((x + 0.5) * sw) / dw - 0.5;
      const sy = ((y + 0.5) * sh) / dh - 0.5;
      const [pr, pg, pb, pa] = sample(sx, sy);
      const o = (y * dw + x) * 4;
      const af = pa / 255;
      // un-premultiply
      if (af > 0) {
        out[o] = Math.min(255, Math.round(pr / af));
        out[o + 1] = Math.min(255, Math.round(pg / af));
        out[o + 2] = Math.min(255, Math.round(pb / af));
      } else {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
      }
      out[o + 3] = Math.round(pa);
    }
  }
  return out;
}

// ---- PNG encode ------------------------------------------------------------
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
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
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

// ---- ICO assembly (PNG-in-ICO) ---------------------------------------------
function buildICO(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  const datas = [];
  let offset = 6 + count * 16;

  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry[0] = img.size >= 256 ? 0 : img.size; // width (0 == 256)
    entry[1] = img.size >= 256 ? 0 : img.size; // height (0 == 256)
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(img.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    datas.push(img.png);
    offset += img.png.length;
  }

  return Buffer.concat([header, ...entries, ...datas]);
}

// ---- Generate --------------------------------------------------------------
const SOURCE_CANDIDATES = [
  join(OUT_DIR, 'icon-source.png'),
  join(OUT_DIR, '../../../icons8-natural-food-3d-fluency-96.png'),
];
const sourcePath = SOURCE_CANDIDATES.find((p) => existsSync(p));
if (!sourcePath) {
  throw new Error(
    `source artwork not found. Place it at build/icon-source.png. Tried:\n  ${SOURCE_CANDIDATES.join('\n  ')}`,
  );
}

const { width, height, rgba } = decodePNG(readFileSync(sourcePath));
console.log(`Source ${sourcePath} -> ${width}x${height}`);

const pngPath = join(OUT_DIR, 'icon.png');
const icoPath = join(OUT_DIR, 'icon.ico');

// Master PNG at 256 (cross-platform fallback / overlay window icon)
const png256 = encodePNG(256, 256, resize(rgba, width, height, 256, 256));
writeFileSync(pngPath, png256);

// Multi-size ICO (Windows app / taskbar)
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const icoImages = ICO_SIZES.map((size) => ({
  size,
  png: encodePNG(size, size, resize(rgba, width, height, size, size)),
}));
const ico = buildICO(icoImages);
writeFileSync(icoPath, ico);

console.log(`Wrote ${pngPath} (${png256.length} bytes)`);
console.log(`Wrote ${icoPath} (${ico.length} bytes) sizes: ${ICO_SIZES.join(', ')}`);
