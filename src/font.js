// EdgeTX / LVGL font engine (works in the browser and in Node).
// Mirrors lv_font_fmt_txt.c from EdgeTX's lvgl fork: glyph lookup via cmaps, class-based kerning,
// advance width rounding, 4 bpp glyph bitmaps.

// EdgeTX font index lives in bits 8..11 of the draw flags (radio/src/gui/colorlcd/fonts.h).
export const FONT_MASK = 0x0f00;
export const FONT_NAMES = ['STD', 'bold_STD', 'XXS', 'XS', 'L', 'bold_XL', 'bold_XXL', 'bold_LXL'];
export const fontIndex = (flags) => (flags & FONT_MASK) >> 8;

const b64 = (s) => (typeof Buffer !== 'undefined' ? Uint8Array.from(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

export class LvglFont {
  constructor(json) {
    this.name = json.name;
    this.lineHeight = json.lineHeight;
    this.baseLine = json.baseLine;
    this.kernScale = json.kernScale;
    this.glyphs = json.glyphs; // [bitmapIndex, adv(1/16 px), boxW, boxH, ofsX, ofsY]
    this.cmaps = json.cmaps;
    this.kern = json.kern;
    this.bitmap = b64(json.bitmap);
  }

  // unicode code point -> glyph id (0 = not found); same rules as get_glyph_dsc_id()
  glyphId(cp) {
    if (cp === 0) return 0;
    for (const c of this.cmaps) {
      const rcp = cp - c.start;
      if (rcp < 0 || rcp >= c.len) continue;
      if (c.type === 2) return c.gid0 + rcp; // FORMAT0_TINY
      if (c.type === 3 || c.type === 1) { // SPARSE
        const i = c.list.indexOf(rcp); // lists are tiny; a linear scan is fine
        return i >= 0 ? c.gid0 + i : 0;
      }
      return 0;
    }
    return 0;
  }

  kernValue(gl, gr) {
    const k = this.kern;
    const lc = k.left[gl], rc = k.right[gr];
    if (lc > 0 && rc > 0) return k.values[(lc - 1) * k.rightCnt + (rc - 1)] ?? 0;
    return 0;
  }

  // advance width in whole pixels for `cp` when followed by `next` (lv_font_get_glyph_dsc_fmt_txt)
  advance(cp, next = 0) {
    const isTab = cp === 9;
    if (isTab) cp = 32;
    const gid = this.glyphId(cp);
    if (!gid) return null;
    let kv = 0;
    if (next) {
      const g2 = this.glyphId(next);
      if (g2) kv = (this.kernValue(gid, g2) * this.kernScale) >> 4;
    }
    let adv = this.glyphs[gid][1];
    if (isTab) adv *= 2;
    adv += kv;
    return (adv + 8) >> 4;
  }

  // width of a string in pixels (sum of advances, with kerning)
  textWidth(text) {
    const cps = [...text].map((ch) => ch.codePointAt(0));
    let w = 0;
    for (let i = 0; i < cps.length; i++) {
      const a = this.advance(cps[i], cps[i + 1] || 0);
      if (a !== null) w += a;
    }
    return w;
  }

  // coverage (0..15) of glyph pixel (x, y) inside its own box
  glyphCoverage(gid, x, y) {
    const [bi, , bw] = this.glyphs[gid];
    const n = y * bw + x;
    const byte = this.bitmap[bi + (n >> 1)];
    return n & 1 ? byte & 15 : byte >> 4;
  }

  // Draws `text` into an RGBA ImageData-like buffer (Uint8ClampedArray, width w). x,y = top-left of line box.
  drawText(buf, w, h, x, y, text, rgb) {
    const cps = [...text].map((ch) => ch.codePointAt(0));
    let pen = x;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const gid = this.glyphId(cp === 9 ? 32 : cp);
      if (gid) {
        const [, , bw, bh, ox, oy] = this.glyphs[gid];
        // top of glyph box: line top + (lineHeight - baseLine) - (oy + bh)
        const gy = y + this.lineHeight - this.baseLine - (oy + bh);
        for (let yy = 0; yy < bh; yy++) {
          for (let xx = 0; xx < bw; xx++) {
            const cov = this.glyphCoverage(gid, xx, yy);
            if (!cov) continue;
            const px = pen + ox + xx, py = gy + yy;
            if (px < 0 || py < 0 || px >= w || py >= h) continue;
            const o = (py * w + px) * 4;
            const a = (cov * 17) / 255; // 4 bpp -> 0..1
            buf[o] = buf[o] * (1 - a) + rgb[0] * a;
            buf[o + 1] = buf[o + 1] * (1 - a) + rgb[1] * a;
            buf[o + 2] = buf[o + 2] * (1 - a) + rgb[2] * a;
            buf[o + 3] = 255;
          }
        }
      }
      const adv = this.advance(cp, cps[i + 1] || 0);
      if (adv !== null) pen += adv;
    }
    return pen - x;
  }
}
