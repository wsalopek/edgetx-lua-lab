// Simulated EdgeTX color LCD: framebuffer, colors, flags and the drawing primitives behind lcd.*.
// Behaviour follows radio/src/lua/api_colorlcd.cpp and gui/colorlcd/colors.* in the EdgeTX source.
import { LvglFont, FONT_NAMES, fontIndex } from './font.js';

// ---- flag constants (libopenui_defines.h, fonts.h, api_general.cpp) ----
export const FLAGS = {
  INVERS: 0x01, VCENTER: 0x02, CENTER: 0x04, RIGHT: 0x08, LEFT: 0x00,
  LEADING0: 0x10, PREC1: 0x20, PREC2: 0x30, NO_UNIT: 0x40, SHADOWED: 0x80,
  VTOP: 0x00, VBOTTOM: 0x200, BLINK: 0x1000, TIMEHOUR: 0x2000, RGB_FLAG: 0x8000,
  // font index goes in bits 8..11 and is ADDED when flags are added in Lua
  STDSIZE: 0 << 8, BOLD: 1 << 8, TINSIZE: 2 << 8, SMLSIZE: 3 << 8, MIDSIZE: 4 << 8,
  DBLSIZE: 5 << 8, XXLSIZE: 6 << 8, XLSIZE: 7 << 8,
  SOLID: 0xff, DOTTED: 0x55, FORCE: 0x02, ERASE: 0x04, ROUND: 0x04, // TODO verify FORCE/ERASE/ROUND values
};

// ---- colors (colors.h / colors.cpp) ----
export const rgb565 = (r, g, b) => ((r & 0xf8) << 8) + ((g & 0xfc) << 3) + ((b & 0xf8) >> 3);
const THEME = ['PRIMARY1', 'PRIMARY2', 'PRIMARY3', 'SECONDARY1', 'SECONDARY2', 'SECONDARY3', 'FOCUS', 'EDIT', 'ACTIVE', 'WARNING', 'DISABLED', 'QM_BG', 'QM_FG', 'CUSTOM'];
const FIXED = ['BLACK', 'WHITE', 'LIGHTWHITE', 'LIGHTGREY', 'GREY', 'DARKGREY', 'RED', 'DARKRED', 'LIGHTRED', 'GREEN', 'DARKGREEN', 'BRIGHTGREEN', 'BLUE', 'DARKBLUE', 'CYAN', 'YELLOW', 'LIGHTBROWN', 'DARKBROWN', 'ORANGE', 'MAGENTA'];
export const COLOR_INDEX = {};
THEME.forEach((n, i) => { COLOR_INDEX[n] = i; });
FIXED.forEach((n, i) => { COLOR_INDEX[n] = THEME.length + i; });
export const THEME_COLOR_COUNT = THEME.length;
export const TOTAL_COLOR_COUNT = THEME.length + FIXED.length;
// Values in table order. NB: EdgeTX's table lists 0x40 before 0x60 although the enum is GREY, DARKGREY.
export const DEFAULT_COLORS = [
  rgb565(0, 0, 0), rgb565(255, 255, 255), rgb565(12, 63, 102), rgb565(18, 94, 153), rgb565(182, 224, 242), rgb565(228, 238, 242),
  rgb565(20, 161, 229), rgb565(0, 153, 9), rgb565(255, 222, 0), rgb565(224, 0, 0), rgb565(140, 140, 140), rgb565(0, 0, 0),
  rgb565(255, 255, 255), rgb565(170, 85, 0),
  rgb565(0, 0, 0), rgb565(255, 255, 255), rgb565(0xea, 0xea, 0xea), rgb565(0xc0, 0xc0, 0xc0), rgb565(0x40, 0x40, 0x40),
  rgb565(0x60, 0x60, 0x60), rgb565(255, 0, 0), rgb565(0xa0, 0, 0), rgb565(0xff, 0x99, 0x99), rgb565(0, 255, 0),
  rgb565(0, 0xa0, 0), rgb565(0, 0xb4, 0x3c), rgb565(0, 0, 255), rgb565(0, 0, 0xa0), rgb565(0, 255, 255),
  rgb565(255, 255, 0), rgb565(0x9c, 0x6d, 0x20), rgb565(0x6a, 0x48, 0x10), rgb565(0xe5, 0x64, 0x1e), rgb565(0x80, 0, 0x80),
];
// flag-space color (what Lua sees): color << 16, optionally | RGB_FLAG
export const colorToFlags = (idx) => (idx << 16) >>> 0;
const e5 = (v) => (v << 3) | (v >> 2), e6 = (v) => (v << 2) | (v >> 4);
const to8 = (c) => [e5((c >> 11) & 31), e6((c >> 5) & 63), e5(c & 31)];
const from8 = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);

export class Bitmap {
  // rgba: Uint8ClampedArray, 8-bit straight alpha
  constructor(w, h, rgba) { this.w = w; this.h = h; this.rgba = rgba; }
}

export class Lcd {
  constructor(w = 480, h = 272, fonts = {}) {
    this.w = w; this.h = h;
    this.fb = new Uint16Array(w * h);
    this.fonts = fonts; // name -> LvglFont
    this.colorTable = Uint16Array.from(DEFAULT_COLORS);
    this.blinkOn = true;
    this.unsupported = new Map(); // function name -> call count (for the "what's missing" list)
    this.clear(this.colorTable[COLOR_INDEX.SECONDARY3]);
  }

  // ---- colors ----
  // color flags -> RGB565 (colorToRGB in EdgeTX). Returns a 16-bit color.
  resolve(flags) {
    flags >>>= 0;
    const val = flags >>> 16;
    if (flags & FLAGS.RGB_FLAG) return val;
    const idx = val & 0xff;
    return this.colorTable[idx >= TOTAL_COLOR_COUNT ? COLOR_INDEX.WHITE : idx];
  }
  setColor(indexFlags, colorFlags) {
    const idx = (indexFlags >>> 16) & 0xffff;
    if (idx < THEME_COLOR_COUNT) this.colorTable[idx] = this.resolve(colorFlags);
  }

  // ---- fonts ----
  font(flags) { return this.fonts[FONT_NAMES[fontIndex(flags)]] || this.fonts.STD; }
  fontHeight(flags) { return this.font(flags).lineHeight; }
  textWidth(text, flags = 0) { return this.font(flags).textWidth(text); }

  // ---- primitives (all operate on RGB565 colors) ----
  clear(c565) { this.fb.fill(c565); }
  pixel(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.fb[y * this.w + x] = c; }
  blend(x, y, c, a) { // a: 0..255 coverage
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const o = y * this.w + x;
    if (a >= 255) { this.fb[o] = c; return; }
    const [br, bg, bb] = to8(this.fb[o]), [fr, fg, fb] = to8(c);
    this.fb[o] = from8(br + (((fr - br) * a) / 255 | 0), bg + (((fg - bg) * a) / 255 | 0), bb + (((fb - bb) * a) / 255 | 0));
  }
  fillRect(x, y, w, h, c, opacity = 0) {
    const a = opacity ? Math.round((opacity & 15) * 17) : 255; // TODO verify EdgeTX opacity mapping
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { if (a === 255) this.fb[yy * this.w + xx] = c; else this.blend(xx, yy, c, a); }
  }
  rect(x, y, w, h, c, thickness = 1, opacity = 0) {
    if (w <= 0 || h <= 0) return;
    const t = Math.min(thickness, Math.ceil(Math.min(w, h) / 2));
    this.fillRect(x, y, w, t, c, opacity); this.fillRect(x, y + h - t, w, t, c, opacity);
    this.fillRect(x, y + t, t, h - 2 * t, c, opacity); this.fillRect(x + w - t, y + t, t, h - 2 * t, c, opacity);
  }
  line(x1, y1, x2, y2, pat, c) {
    pat &= 0xff;
    let dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1), sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1, err = dx + dy, bit = 0;
    for (;;) {
      if ((pat >> (bit++ & 7)) & 1) this.pixel(x1, y1, c);
      if (x1 === x2 && y1 === y2) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x1 += sx; }
      if (e2 <= dx) { err += dx; y1 += sy; }
    }
  }

  // line clipped to a box (Cohen-Sutherland, inclusive bounds)
  lineClipped(x1, y1, x2, y2, xmin, xmax, ymin, ymax, pat, c) {
    const code = (x, y) => (x < xmin ? 1 : x > xmax ? 2 : 0) | (y < ymin ? 4 : y > ymax ? 8 : 0);
    let c1 = code(x1, y1), c2 = code(x2, y2);
    for (;;) {
      if (!(c1 | c2)) break;
      if (c1 & c2) return;
      const co = c1 || c2; let x, y;
      if (co & 8) { x = x1 + (x2 - x1) * (ymax - y1) / (y2 - y1); y = ymax; }
      else if (co & 4) { x = x1 + (x2 - x1) * (ymin - y1) / (y2 - y1); y = ymin; }
      else if (co & 2) { y = y1 + (y2 - y1) * (xmax - x1) / (x2 - x1); x = xmax; }
      else { y = y1 + (y2 - y1) * (xmin - x1) / (x2 - x1); x = xmin; }
      if (co === c1) { x1 = x; y1 = y; c1 = code(x1, y1); } else { x2 = x; y2 = y; c2 = code(x2, y2); }
    }
    this.line(Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2), pat, c);
  }

  // Artificial-horizon "ground". Direct port of drawHudRectangle() in EdgeTX radio/src/lua/api_colorlcd.cpp
  // (C float->int conversions truncate toward zero, hence the Math.trunc calls).
  hudRect(pitch, roll, xmin, xmax, ymin, ymax, c) {
    const G = 0.017453293, T = Math.trunc;
    const dx = Math.sin(G * roll) * pitch, dy = Math.cos(G * roll) * pitch * 1.85;
    const angle = Math.tan(-G * roll);
    const ox = 0.5 * (xmin + xmax) + dx, oy = 0.5 * (ymin + ymax) + dy;
    const ywidth = ymax - ymin;
    const hline = (x, y, w) => { for (let i = 0; i < w; i++) this.pixel(x + i, y, c); };
    const rect = (x, y, w, h) => { for (let j = 0; j < h; j++) hline(x, y + j, w); };
    if (roll === 0) {
      rect(xmin, Math.max(ymin, ymin + (T(ywidth / 2) + T(dy))), xmax - xmin, Math.max(0, Math.min(ywidth, T(ywidth / 2) - T(dy))));
    } else if (Math.abs(roll) >= 180) {
      rect(xmin, ymin, xmax - xmin, Math.min(ywidth, T(ywidth / 2) + T(Math.abs(dy))));
    } else {
      const inverted = Math.abs(roll) > 90;
      let fillNeeded = false, ybot = inverted ? 0 : this.h;
      for (let s = 0; s < ywidth; s++) {
        const yy = ymin + s, xx = T(ox + (yy - oy) / angle);
        if (roll > 0) {
          if (xx >= xmin && xx <= xmax) hline(xx, yy, xmax - xx + 1);
          else if (xx < xmin) { ybot = inverted ? Math.max(yy, ybot) + 1 : Math.min(yy, ybot); fillNeeded = true; }
        } else {
          if (xx >= xmin && xx <= xmax) hline(xmin, yy, xx - xmin);
          else if (xx > xmax) { ybot = inverted ? Math.max(yy, ybot) + 1 : Math.min(yy, ybot); fillNeeded = true; }
        }
      }
      if (fillNeeded) rect(xmin, inverted ? ymin : ybot, xmax - xmin, inverted ? ybot - ymin : ymax - ybot);
    }
  }

  // ---- shapes: ports of EdgeTX bitmapbuffer_draw_extra.cpp (LVGL anti-aliasing approximated by pixel coverage) ----
  _ringCoverage(px, py, cx, cy, rOut, rIn) {
    const d = Math.hypot(px - cx, py - cy);
    const o = Math.min(1, Math.max(0, rOut + 1 - d)), i = rIn > 0 ? Math.min(1, Math.max(0, rIn + 1 - d)) : 0;
    return o - i;
  }
  circle(x, y, r, c, thickness = 1) {
    for (let py = y - r - 1; py <= y + r + 1; py++) for (let px = x - r - 1; px <= x + r + 1; px++) {
      const a = this._ringCoverage(px, py, x, y, r, r - thickness); if (a > 0) this.blend(px, py, c, Math.round(a * 255));
    }
  }
  filledCircle(x, y, r, c) {
    for (let py = y - r - 1; py <= y + r + 1; py++) for (let px = x - r - 1; px <= x + r + 1; px++) {
      const a = this._ringCoverage(px, py, x, y, r, 0); if (a > 0) this.blend(px, py, c, Math.round(a * 255));
    }
  }
  // LVGL arc: angles in degrees measured clockwise from 12 o'clock (EdgeTX subtracts 90 for LVGL's 3 o'clock zero)
  annulusSector(x, y, rIn, rOut, start, end, c) {
    if (end === start) end += 1;
    start = ((start % 360) + 360) % 360; end = ((end % 360) + 360) % 360;
    const R = rOut;
    for (let py = y - R - 1; py <= y + R + 1; py++) for (let px = x - R - 1; px <= x + R + 1; px++) {
      let a = this._ringCoverage(px, py, x, y, rOut, rIn); if (a <= 0) continue;
      let ang = (Math.atan2(px - x, -(py - y)) * 180) / Math.PI; if (ang < 0) ang += 360; // 0 = up, clockwise
      const inside = start <= end ? ang >= start && ang <= end : ang >= start || ang <= end;
      if (inside) this.blend(px, py, c, Math.round(a * 255));
    }
  }
  triangle(x1, y1, x2, y2, x3, y3, c) { this.line(x1, y1, x2, y2, 0xff, c); this.line(x2, y2, x3, y3, 0xff, c); this.line(x3, y3, x1, y1, 0xff, c); }
  filledTriangle(x0, y0, x1, y1, x2, y2, c, opacity = 0) { // exact port (integer math, C division truncates)
    const T = Math.trunc, hl = (x, y, w) => { for (let i = 0; i < w; i++) opacity ? this.blend(x + i, y, c, (opacity & 15) * 17) : this.pixel(x + i, y, c); };
    let a, b;
    if (y0 > y1) { [y0, y1] = [y1, y0]; [x0, x1] = [x1, x0]; }
    if (y1 > y2) { [y2, y1] = [y1, y2]; [x2, x1] = [x1, x2]; }
    if (y0 > y1) { [y0, y1] = [y1, y0]; [x0, x1] = [x1, x0]; }
    if (y0 === y2) { a = b = x0; if (x1 < a) a = x1; else if (x1 > b) b = x1; if (x2 < a) a = x2; else if (x2 > b) b = x2; hl(a, y0, b - a + 1); return; }
    const dx01 = x1 - x0, dy01 = y1 - y0, dx02 = x2 - x0, dy02 = y2 - y0, dx12 = x2 - x1, dy12 = y2 - y1;
    let sa = 0, sb = 0, y; const last = y1 === y2 ? y1 : y1 - 1;
    for (y = y0; y <= last; y++) {
      a = x0 + T(sa / dy01); b = x0 + T(sb / dy02); sa += dx01; sb += dx02;
      if (a > b) [a, b] = [b, a]; hl(a, y, b - a + 1);
    }
    sa = dx12 * (y - y1); sb = dx02 * (y - y0);
    for (; y <= y2; y++) {
      a = x1 + T(sa / dy12); b = x0 + T(sb / dy02); sa += dx12; sb += dx02;
      if (a > b) [a, b] = [b, a]; hl(a, y, b - a + 1);
    }
  }
  // invertRect: pixel = bg + color - pixel per channel, bg = theme PRIMARY2 (port of BitmapBuffer::invertRect)
  invertRect(x, y, w, h, c) {
    const split = (p) => [p >> 11, (p >> 5) & 63, p & 31], bg = split(this.colorTable[COLOR_INDEX.PRIMARY2]), col = split(c);
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const o = yy * this.w + xx, p = split(this.fb[o]);
      const cl = (v, m) => Math.max(0, Math.min(m, v));
      this.fb[o] = (cl(bg[0] + col[0] - p[0], 31) << 11) | (cl(bg[1] + col[1] - p[1], 63) << 5) | cl(bg[2] + col[2] - p[2], 31);
    }
  }
  // word-wrapping text (port of BitmapBuffer::drawTextLines); returns [maxX, maxY]
  textLines(left, top, width, height, str, flags, c) {
    const CORR = [-2, -2, -2, -2, -3, -5, -2, -2], line = this.fontHeight(flags) + CORR[(flags & 0x0f00) >> 8];
    const space = this.textWidth(' ', flags); let x = left, y = top, mx = 0, my = 0, i = 0;
    flags &= ~(FLAGS.VCENTER | FLAGS.CENTER | FLAGS.RIGHT);
    const SEP = '-/:({[';
    for (;;) {
      let j = i;
      while (j < str.length && str[j] !== ' ' && str[j] !== '\n') { if (SEP.includes(str[j])) { j++; break; } j++; }
      const word = this.textWidth(str.slice(i, j), flags);
      if (x + word > left + width && x > left) { x = left; y += line; my = y + line; } else mx = Math.max(mx, x + word);
      if (y + line > top + height) return [mx, my];
      this.drawTextRaw(x, y, str.slice(i, j), flags, c);
      x += word;
      if (j >= str.length) return [mx, my];
      if (str[j] === '\n') { x = left; y += line; my = y + line; j++; } else if (str[j] === ' ') { x += space; j++; }
      i = j;
    }
  }

  // ---- text ----
  drawText(x, y, text, flags = 0, invColorFlags) {
    text = String(text);
    let c = this.resolve(flags);
    if (flags & FLAGS.VCENTER) y -= this.fontHeight(flags) >> 1;
    const blinkOff = (flags & FLAGS.BLINK) && !this.blinkOn;
    if (flags & FLAGS.INVERS) {
      if (flags & FLAGS.BLINK && this.blinkOn) { /* inverted phase: draw plain */ }
      const boxColor = c;
      const col = invColorFlags === undefined ? from8(...to8(c).map((v) => 255 - v)) : this.resolve(invColorFlags);
      const wdt = this.textWidth(text, flags), m = 2;
      let ix = x - m; if (flags & FLAGS.RIGHT) ix -= wdt; else if (flags & FLAGS.CENTER) ix -= wdt >> 1;
      this.fillRect(ix, y - m, wdt + 2 * m, this.fontHeight(flags) + 2 * m, boxColor);
      c = col;
    } else {
      if (blinkOff) return;
      if (flags & FLAGS.SHADOWED) this.drawTextRaw(x + 1, y + 1, text, flags, this.colorTable[COLOR_INDEX.BLACK]);
    }
    this.drawTextRaw(x, y, text, flags, c);
  }
  drawTextRaw(x, y, text, flags, c) {
    const font = this.font(flags);
    const wdt = font.textWidth(text);
    if (flags & FLAGS.RIGHT) x -= wdt; else if (flags & FLAGS.CENTER) x -= wdt >> 1;
    const cps = [...text].map((ch) => ch.codePointAt(0));
    let pen = x;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i], gid = font.glyphId(cp === 9 ? 32 : cp);
      if (gid) {
        const [, , bw, bh, ox, oy] = font.glyphs[gid];
        const gy = y + font.lineHeight - font.baseLine - (oy + bh);
        for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
          const cov = font.glyphCoverage(gid, xx, yy);
          if (cov) this.blend(pen + ox + xx, gy + yy, c, cov * 17);
        }
      }
      const adv = font.advance(cp, cps[i + 1] || 0);
      if (adv !== null) pen += adv;
    }
  }
  numberString(val, flags) {
    const prec = ((flags & 0x30) === 0x30) ? 2 : ((flags & 0x30) === 0x20) ? 1 : 0;
    const neg = val < 0; let s = String(Math.abs(Math.trunc(val)));
    if (prec) { s = s.padStart(prec + 1, '0'); s = `${s.slice(0, -prec)}.${s.slice(-prec)}`; }
    return (neg ? '-' : '') + s;
  }
  timerString(t, flags) {
    const neg = t < 0; t = Math.abs(t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60, p2 = (n) => String(n).padStart(2, '0');
    let out;
    if (flags & FLAGS.TIMEHOUR) out = `${p2(h)}:${p2(m)}`; else out = h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
    return (neg ? '-' : '') + out;
  }

  // ---- bitmaps ----
  drawBitmap(bmp, x, y, scalePercent = 0) {
    const sc = scalePercent ? scalePercent / 100 : 1;
    const dw = Math.round(bmp.w * sc), dh = Math.round(bmp.h * sc);
    for (let yy = 0; yy < dh; yy++) for (let xx = 0; xx < dw; xx++) {
      const sx = Math.min(bmp.w - 1, Math.floor(xx / sc)), sy = Math.min(bmp.h - 1, Math.floor(yy / sc)), o = (sy * bmp.w + sx) * 4;
      const a = bmp.rgba[o + 3];
      if (a) this.blend(x + xx, y + yy, from8(bmp.rgba[o], bmp.rgba[o + 1], bmp.rgba[o + 2]), a);
    }
  }

  // Record a call to a drawing function we have not implemented yet.
  noteUnsupported(name) { this.unsupported.set(name, (this.unsupported.get(name) || 0) + 1); }

  // RGBA bytes for a canvas / PNG
  toRGBA(out = new Uint8ClampedArray(this.w * this.h * 4)) {
    for (let i = 0; i < this.fb.length; i++) { const [r, g, b] = to8(this.fb[i]); out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255; }
    return out;
  }
}

export async function loadFonts(loadJson) {
  const fonts = {};
  for (const n of FONT_NAMES) fonts[n] = new LvglFont(await loadJson(n));
  return fonts;
}
