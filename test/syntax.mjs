// The highlighter must keep the text exactly as typed (only add spans), or the overlay drifts.
import { highlight } from '../src/lua-syntax.js';
let fail = 0;
const eq = (n, g, w) => { const ok = g === w; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `\n   got  ${JSON.stringify(g)}\n   want ${JSON.stringify(w)}`}`); };
const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const known = new Set(['lcd.drawText', 'getValue']), consts = new Set(['WHITE', 'BOLD']);
const samples = [
  'local x = 10 -- hi <b> & co\nlcd.drawText(1, 2, "a\\"b", WHITE + BOLD)\nif x >= 0x1F then return nil end',
  '--[[ block\ncomment ]] local s = [[long\nstring]] print(1.5e3, .5)',
  'function refresh(w)\n\tlocal a = getValue("RSSI") < 5 and 1 or 2\nend',
  "'unterminated string\nnext line",
];
for (const [i, s] of samples.entries()) eq('text preserved #' + i, strip(highlight(s, known, consts)), s);
eq('keyword coloured', highlight('local', known, consts), '<span class="kw">local</span>');
eq('api name coloured', highlight('lcd.drawText(', known, consts), '<span class="api">lcd.drawText</span>(');
eq('constant coloured', highlight('WHITE', known, consts), '<span class="const">WHITE</span>');
eq('html escaped', highlight('a < b', known, consts), 'a &lt; b');
eq('comment span', highlight('-- x', known, consts), '<span class="com">-- x</span>');
console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);
