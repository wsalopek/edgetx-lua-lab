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

export const loadFontsNode = () => loadFonts(async (n) => JSON.parse(fs.readFileSync(path.join(root, 'src', 'fonts', `${n}.json`), 'utf8')));

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
