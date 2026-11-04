// Converts EdgeTX's compiled LVGL font sources (vendor/edgetx-fonts/*.c) into compact JSON the
// browser can draw with. Handles both plain LVGL fonts (lv_font_en_STD.c) and EdgeTX's
// LZ4-compressed wrapper format (etxLz4Font, see radio/src/gui/colorlcd/lz4_fonts.h).
//
// Usage: node tools/convert-fonts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'vendor', 'edgetx-fonts');
const outDir = path.join(here, '..', 'src', 'fonts');
fs.mkdirSync(outDir, { recursive: true });

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// text of `name[] = { ... };` (comments already stripped)
function arrayBody(text, name) {
  const m = new RegExp(`\\b${name}\\s*\\[\\]\\s*(?:__FLASH\\s*)?=\\s*\\{`).exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = text.indexOf('\n};', start);
  return text.slice(start, end < 0 ? undefined : end);
}
const hexList = (body) => (body.match(/-?0x[0-9a-fA-F]+|-?\d+/g) || []).map((s) => Number(s));
const int8 = (v) => (v > 127 ? v - 256 : v);

// ---- LZ4 block decompression ----
function lz4Block(src, outSize) {
  const out = new Uint8Array(outSize);
  let ip = 0, op = 0;
  while (ip < src.length) {
    const token = src[ip++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[ip++]; lit += b; } while (b === 255); }
    for (let i = 0; i < lit; i++) out[op++] = src[ip++];
    if (ip >= src.length) break;
    const offset = src[ip] | (src[ip + 1] << 8); ip += 2;
    let len = token & 15;
    if (len === 15) { let b; do { b = src[ip++]; len += b; } while (b === 255); }
    len += 4;
    for (let i = 0; i < len; i++) { out[op] = out[op - offset]; op++; }
  }
  if (op !== outSize) throw new Error(`lz4: produced ${op} bytes, expected ${outSize}`);
  return out;
}

const CMAP_TYPES = { FORMAT0_FULL: 0, SPARSE_FULL: 1, FORMAT0_TINY: 2, SPARSE_TINY: 3 };

function parsePlain(raw, name) {
  const t = stripComments(raw);
  const bitmap = Uint8Array.from(hexList(arrayBody(t, 'glyph_bitmap')));
  const dscBody = arrayBody(t, 'glyph_dsc');
  const glyphs = [];
  const re = /\.bitmap_index\s*=\s*(\d+),\s*\.adv_w\s*=\s*(\d+),\s*\.box_w\s*=\s*(\d+),\s*\.box_h\s*=\s*(\d+),\s*\.ofs_x\s*=\s*(-?\d+),\s*\.ofs_y\s*=\s*(-?\d+)/g;
  let m;
  while ((m = re.exec(dscBody))) glyphs.push(m.slice(1, 7).map(Number)); // [bi, adv16, bw, bh, ox, oy]

  const lists = {};
  for (const lm of t.matchAll(/uint16_t\s+(unicode_list_\d+)\s*\[\]\s*=\s*\{/g)) lists[lm[1]] = hexList(arrayBody(t, lm[1]));
  const cmapBody = arrayBody(t, 'cmaps');
  const cmaps = [];
  const cre = /\{\s*\.range_start\s*=\s*(\d+),\s*\.range_length\s*=\s*(\d+),\s*\.glyph_id_start\s*=\s*(\d+),\s*\.unicode_list\s*=\s*(\w+),[^}]*?\.list_length\s*=\s*(\d+),\s*\.type\s*=\s*LV_FONT_FMT_TXT_CMAP_(\w+)/g;
  while ((m = cre.exec(cmapBody))) {
    cmaps.push({ start: +m[1], len: +m[2], gid0: +m[3], type: CMAP_TYPES[m[6]], list: m[4] === 'NULL' ? null : lists[m[4]] });
  }
  const pick = (re) => { const x = re.exec(t); if (!x) throw new Error(`${name}: missing ${re}`); return Number(x[1]); };
  return {
    glyphs, bitmap, cmaps,
    lineHeight: pick(/\.line_height\s*=\s*(\d+)/), baseLine: pick(/\.base_line\s*=\s*(\d+)/),
    kernScale: pick(/\.kern_scale\s*=\s*(\d+)/), bpp: pick(/\.bpp\s*=\s*(\d+)/),
    kern: {
      leftCnt: pick(/\.left_class_cnt\s*=\s*(\d+)/), rightCnt: pick(/\.right_class_cnt\s*=\s*(\d+)/),
      left: hexList(arrayBody(t, 'kern_left_class_mapping')),
      right: hexList(arrayBody(t, 'kern_right_class_mapping')),
      values: hexList(arrayBody(t, 'kern_class_values')).map(int8),
    },
  };
}

function parseLz4(raw, name) {
  const t = stripComments(raw);
  const comp = Uint8Array.from(hexList(arrayBody(t, 'lz4FontData')));
  const num = (k) => { const x = new RegExp(`\\.${k}\\s*=\\s*(-?\\d+)`).exec(t.slice(t.indexOf('etxLz4Font lv_font'))); if (!x) throw new Error(`${name}: missing ${k}`); return Number(x[1]); };
  const unc = lz4Block(comp, num('uncomp_size'));
  const dv = new DataView(unc.buffer);
  const cmapBody = arrayBody(t, 'cmaps');
  const cmaps = [];
  const cre = /\.range_start\s*=\s*(\d+),\s*\.range_length\s*=\s*(\d+),\s*\.glyph_id_start\s*=\s*(\d+),\s*\.list_length\s*=\s*(\d+),\s*\.type\s*=\s*(\d+),\s*\.unicode_list\s*=\s*(\d+)/g;
  let m;
  while ((m = cre.exec(cmapBody))) {
    const listLen = +m[4], off = +m[6];
    const list = listLen ? Array.from({ length: listLen }, (_, i) => dv.getUint16(off + i * 2, true)) : null;
    cmaps.push({ start: +m[1], len: +m[2], gid0: +m[3], type: +m[5], list });
  }
  const glyphBitmapOfs = num('glyph_bitmap'), pairOfs = num('class_pair_values');
  const leftOfs = num('left_class_mapping'), rightOfs = num('right_class_mapping');
  const leftCnt = num('left_class_cnt'), rightCnt = num('right_class_cnt');
  // glyph_dsc (8 bytes each) sits at the start, followed by unicode lists, then the bitmap
  const firstList = Math.min(...[...t.matchAll(/\.unicode_list\s*=\s*(\d+)/g)].map((x) => +x[1]).filter((v) => v > 0), glyphBitmapOfs);
  const count = firstList / 8;
  const glyphs = [];
  for (let i = 0; i < count; i++) {
    const w = dv.getUint32(i * 8, true);
    glyphs.push([w & 0xfffff, w >>> 20, unc[i * 8 + 4], unc[i * 8 + 5], int8(unc[i * 8 + 6]), int8(unc[i * 8 + 7])]);
  }
  return {
    glyphs, bitmap: unc.slice(glyphBitmapOfs, pairOfs), cmaps,
    lineHeight: num('line_height'), baseLine: num('base_line'), kernScale: num('kern_scale'), bpp: num('bpp'),
    kern: {
      leftCnt, rightCnt,
      left: Array.from(unc.slice(leftOfs, leftOfs + count)),
      right: Array.from(unc.slice(rightOfs, rightOfs + count)),
      values: Array.from(unc.slice(pairOfs, pairOfs + leftCnt * rightCnt), int8),
    },
  };
}

const files = fs.readdirSync(srcDir).filter((f) => /^lv_font_en_.*\.c$/.test(f));
for (const f of files) {
  const raw = fs.readFileSync(path.join(srcDir, f), 'utf8');
  const name = f.replace(/^lv_font_en_/, '').replace(/\.c$/, '');
  const font = raw.includes('etxLz4Font lv_font') ? parseLz4(raw, name) : parsePlain(raw, name);
  if (font.bpp !== 4) throw new Error(`${name}: expected 4 bpp, got ${font.bpp}`);
  const json = {
    name, lineHeight: font.lineHeight, baseLine: font.baseLine, kernScale: font.kernScale,
    glyphs: font.glyphs, cmaps: font.cmaps, kern: font.kern,
    bitmap: Buffer.from(font.bitmap).toString('base64'),
  };
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(json));
  console.log(`${name.padEnd(10)} glyphs=${font.glyphs.length} cmaps=${font.cmaps.length} bitmap=${font.bitmap.length}B lineHeight=${font.lineHeight}`);
}
