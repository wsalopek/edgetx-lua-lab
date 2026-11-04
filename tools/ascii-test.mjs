// Quick sanity check: draw text with an EdgeTX font as ASCII art and print text widths.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LvglFont, FONT_NAMES } from '../src/font.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fonts');
const load = (n) => new LvglFont(JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), 'utf8')));

const fontName = process.argv[2] || 'STD';
const text = process.argv[3] || 'Hello, Yaapu 0123';
const f = load(fontName);
const w = f.textWidth(text) + 4, h = f.lineHeight + 2;
const buf = new Uint8ClampedArray(w * h * 4);
f.drawText(buf, w, h, 2, 1, text, [255, 255, 255]);
for (let y = 0; y < h; y++) {
  let row = '';
  for (let x = 0; x < w; x++) { const v = buf[(y * w + x) * 4]; row += v > 170 ? '#' : v > 85 ? '+' : v > 20 ? '.' : ' '; }
  console.log(row);
}
console.log(`\nfont=${fontName} lineHeight=${f.lineHeight} width("${text}")=${f.textWidth(text)}px`);
console.log('widths of "00:00 INF u-blox 1 HW: 000A0000 SW: ROM SPG 5.10 (7b202e)":',
  FONT_NAMES.map((n) => `${n}=${load(n).textWidth('00:00 INF u-blox 1 HW: 000A0000 SW: ROM SPG 5.10 (7b202e)')}`).join('  '));
