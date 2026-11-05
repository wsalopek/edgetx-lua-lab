// Helpers for running the simulator headless in Node (tests, golden-image generation).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadFonts } from '../src/lcd.js';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// fengari-web is a browser bundle; give it just enough of a fake browser to load, then use its Lua API.
export function loadFengari() {
  globalThis.window = globalThis; globalThis.self = globalThis;
  globalThis.HTMLDocument = function () {};
  globalThis.document = Object.assign(new globalThis.HTMLDocument(), { readyState: 'complete', addEventListener() {}, getElementsByTagName() { return []; }, querySelectorAll() { return []; } });
  globalThis.XMLHttpRequest = function () {};
  const log = console.log, warn = console.warn; console.log = console.warn = () => {}; // silence the MutationObserver notice
  try { return createRequire(import.meta.url)(path.join(root, 'vendor', 'fengari', 'fengari-web.js')); } finally { console.log = log; console.warn = warn; }
}

export const loadFontsNode = (set = 'std') => loadFonts(async (n) => JSON.parse(fs.readFileSync(path.join(root, 'src', 'fonts', set === 'std' ? '' : set, `${n}.json`), 'utf8')));

// ---- tiny PNG writer (RGBA) ----
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
export function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---- PNG reader (8-bit, non-interlaced; gray/RGB/palette/+alpha) -> { w, h, rgba } ----
export function readPng(buf) {
  let o = 8, w = 0, h = 0, depth = 8, ctype = 6, pal = null, trns = null; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len); o += 12 + len;
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; if (d[12]) throw new Error('interlaced PNG not supported'); }
    else if (type === 'PLTE') pal = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype], bpp = Math.max(1, (ch * depth) >> 3), stride = Math.ceil((w * ch * depth) / 8);
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  const sample = (row, i) => depth === 8 ? px[row + i] : (px[row + ((i * depth) >> 3)] >> (8 - depth - ((i * depth) & 7))) & ((1 << depth) - 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const row = y * stride, o2 = (y * w + x) * 4; let r, g, bl, a = 255;
    if (ctype === 6) { const i = row + x * 4; r = px[i]; g = px[i + 1]; bl = px[i + 2]; a = px[i + 3]; }
    else if (ctype === 2) { const i = row + x * 3; r = px[i]; g = px[i + 1]; bl = px[i + 2]; }
    else if (ctype === 4) { const i = row + x * 2; r = g = bl = px[i]; a = px[i + 1]; }
    else if (ctype === 0) { r = g = bl = sample(row, x) * (255 / ((1 << depth) - 1)); }
    else { const idx = sample(row, x); r = pal[idx * 3]; g = pal[idx * 3 + 1]; bl = pal[idx * 3 + 2]; if (trns && idx < trns.length) a = trns[idx]; }
    rgba[o2] = r; rgba[o2 + 1] = g; rgba[o2 + 2] = bl; rgba[o2 + 3] = a;
  }
  return { w, h, rgba };
}

// Load an SD-card folder tree into { files (text), bitmaps } keyed by radio path (e.g. /WIDGETS/yaapu/main.lua).
export function loadSdTree(dir, prefix = '/') {
  const files = {}, bitmaps = {};
  const walk = (d, p) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name), rp = p + e.name;
    if (e.isDirectory()) walk(full, rp + '/');
    else if (/\.png$/i.test(e.name)) { const { w, h, rgba } = readPng(fs.readFileSync(full)); bitmaps[rp] = { w, h, rgba }; }
    else if (/\.(lua|cfg|txt)$/i.test(e.name)) files[rp] = fs.readFileSync(full, 'utf8');
  } };
  walk(dir, prefix);
  return { files, bitmaps };
}
