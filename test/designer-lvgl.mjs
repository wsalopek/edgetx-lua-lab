// LVGL visual editing: objects are matched back to their tables in the source and edited there.
import { Lcd } from '../src/lcd.js';
import { LuaHost } from '../src/host.js';
import { lvglSites, matchSites, moveLvgl, resizeLvgl, deleteLvgl, addLvgl, setFields, lvType } from '../src/designer-lvgl.js';
import { loadFengari, loadFontsNode } from '../tools/node-env.mjs';
let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `\n   got  ${JSON.stringify(g)}\n   want ${JSON.stringify(w)}`}`); };
const fonts = await loadFontsNode(), F = loadFengari();

// run a script and return its drawn lvgl items
function draw(src) {
  const host = new LuaHost({ fengari: F, lcd: new Lcd(480, 272, fonts) });
  host.record = true; host.items = []; host.lvglFullscreen(true);
  const r = host.exec(src, '=script'); if (!r.ok) throw new Error(r.error);
  const d = host.drawLvgl(); if (!d.ok) throw new Error(d.error);
  return host.items.filter((i) => i.lv);
}
const SRC = `local n = 0
lvgl.build({
  { type = "label", x = 10, y = 10, text = "A" },
  { type = "label", x = 10, y = 40, text = "B" },
  { type = "rectangle", x = 100, y = 20, w = 80, h = 40, filled = true, color = RED },
  { type = "box", x = 200, y = 20, w = 150, h = 100, flexFlow = lvgl.FLOW_COLUMN, children = {
    { type = "label", text = "in box" },
  } },
})
lvgl.button({ x = 20 + 4, y = 120, w = 100, h = 36, text = "Go", press = function() n = n + 1 end })
`;
const items = draw(SRC);
const sites = lvglSites(SRC);
eq('finds 6 tables', sites.length, 6);
eq('site types', sites.map((s) => s.type), ['label', 'label', 'rectangle', 'box', 'label', 'button']);
const map = matchSites(sites, items);
eq('every drawn object matched', map.size, items.length);
const find = (type, i = 0) => items.filter((it) => lvType(it) === type)[i];
const apply = (src, it, f) => f(src, map.get(it.id));

// move: literal numbers are replaced in place
let out = apply(SRC, find('label', 1), (s, site) => moveLvgl(s, site, 5, -7));
eq('move label B', /text = "B"/.test(out) && /x = 15, y = 33, text = "B"/.test(out), true);
// computed expression: "+ N" is appended, not parenthesised
out = apply(SRC, find('button'), (s, site) => moveLvgl(s, site, 10, 0));
eq('move computed x (offsets merge)', /x = 20 \+ 14, y = 120/.test(out), true);
// resize
out = apply(SRC, find('rectangle'), (s, site) => resizeLvgl(s, site, 'rectangle', 20, 10, 80, 40));
eq('resize rectangle', /w = 100, h = 50, filled/.test(out), true);
// a child inside a flex box has no x/y; setFields inserts them
out = apply(SRC, find('label', 2), (s, site) => setFields(s, site, { w: '120' }));
eq('inserts a missing key', /\{ w = 120, type = "label", text = "in box" \}/.test(out) || /w = 120,/.test(out), true);
// the edited script must still run and the object must have moved
const moved = draw(apply(SRC, find('label', 1), (s, site) => moveLvgl(s, site, 5, -7)));
eq('moved on screen', moved.filter((i) => lvType(i) === 'label')[1].bbox.slice(0, 2), [15, 33]);
// delete: whole line; constructor statement; inline entry
out = apply(SRC, find('label', 0), (s, site) => deleteLvgl(s, site));
eq('delete table line', out.includes('text = "A"'), false);
eq('delete keeps the rest valid', draw(out).length, items.length - 1);
out = apply(SRC, find('button'), (s, site) => deleteLvgl(s, site));
eq('delete constructor statement', out.includes('lvgl.button'), false);
// add: new entry goes into the build table, before the closing brace, with commas fixed
const added = addLvgl(SRC, 'label', { x: 20, y: 200, text: '"New"' });
eq('add into build table', /\{ type = "label", x = 20, y = 200, text = "New" \},\n\}\)/.test(added.src), true);
eq('added script runs with one more object', draw(added.src).length, items.length + 1);
const added2 = addLvgl('local x = 1\nlvgl.button({ x = 1, y = 2 })\n', 'label', { x: 5, y: 6, text: '"t"' });
eq('add statement when there is no build table', /lvgl\.label\(\{ x = 5, y = 6, text = "t" \}\)/.test(added2.src), true);
// inline one-line build table
const one = 'lvgl.build({ { type = "label", x = 1, y = 2, text = "a" } })';
eq('add into one-line build table', draw(addLvgl(one, 'label', { x: 3, y: 4, text: '"b"' }).src).length, 2);
console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);
