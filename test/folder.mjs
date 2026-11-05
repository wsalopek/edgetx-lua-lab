// Mapping a picked folder onto the simulated SD card, and running a multi-file widget from it.
import { buildMount, chunkId } from '../src/folder.js';
import { Lcd } from '../src/lcd.js';
import { LuaHost } from '../src/host.js';
import { loadFengari, loadFontsNode } from '../tools/node-env.mjs';
let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `\n   got  ${JSON.stringify(g)}\n   want ${JSON.stringify(w)}`}`); };

const widget = [
  { rel: 'main.lua', text: 'local lib = loadScript("/WIDGETS/demo/lib/util.lua")()\nlocal function create(zone, o) return {z=zone} end\nlocal function refresh(w) lcd.clear(COLOR_THEME_SECONDARY3); lcd.drawText(10, 10, lib.greet("sd"), MIDSIZE + COLOR_THEME_PRIMARY1) end\nreturn { name="Demo", options={}, create=create, update=function() end, refresh=refresh }' },
  { rel: 'lib/util.lua', text: 'return { greet = function(n) return "hello " .. n end }' },
  { rel: 'images/a.png', bitmap: { w: 2, h: 2, rgba: new Uint8ClampedArray(16) } },
];
let m = buildMount('demo', widget);
eq('widget folder mounts under /WIDGETS/<name>/', m.docs.map((d) => d.path), ['/WIDGETS/demo/lib/util.lua', '/WIDGETS/demo/main.lua']);
eq('image goes to bitmaps', Object.keys(m.bitmaps), ['/WIDGETS/demo/images/a.png']);
eq('entry is main.lua', m.entry, '/WIDGETS/demo/main.lua');

m = buildMount('SD', [{ rel: 'WIDGETS/a/main.lua', text: '' }, { rel: 'WIDGETS/b/main.lua', text: '' }, { rel: 'WIDGETS/b/x.lua', text: '' }, { rel: 'SCRIPTS/TOOLS/t.lua', text: '' }]);
eq('SD root keeps its own paths', m.docs.map((d) => d.path), ['/SCRIPTS/TOOLS/t.lua', '/WIDGETS/a/main.lua', '/WIDGETS/b/main.lua', '/WIDGETS/b/x.lua']);
eq('SD root lists every startable script', m.candidates, ['/SCRIPTS/TOOLS/t.lua', '/WIDGETS/a/main.lua', '/WIDGETS/b/main.lua']);
m = buildMount('scripts', [{ rel: 'b.lua', text: '' }, { rel: 'a.lua', text: '' }]);
eq('plain folder of scripts: pick any .lua', m.candidates, ['/WIDGETS/scripts/a.lua', '/WIDGETS/scripts/b.lua']);
eq('chunkId short', chunkId('/WIDGETS/x/main.lua'), '/WIDGETS/x/main.lua');
eq('chunkId long is truncated like Lua', chunkId('/WIDGETS/' + 'a'.repeat(70) + '.lua').startsWith('...'), true);

// run it: the widget loads its helper from a sibling file
m = buildMount('demo', widget);
const files = Object.fromEntries(m.docs.map((d) => [d.path, d.text]));
const lcd = new Lcd(480, 272, await loadFontsNode());
const host = new LuaHost({ fengari: loadFengari(), lcd, files, bitmaps: m.bitmaps });
const r = host.loadWidget('/WIDGETS/demo/main.lua', { w: 480, h: 272 }, {});
eq('widget loads with its lib', r.ok ? 'ok' : r.error, 'ok');
host.record = true; host.recordChunk = chunkId('/WIDGETS/demo/main.lua'); host.items = [];
eq('refresh runs', host.callWidget('refresh', 'default').ok, true);
eq('draw call recorded with its line in the entry file', host.items.map((i) => [i.fn, i.line]), [['drawText', 3]]);
// a helper that fails: the error names the file
files['/WIDGETS/demo/lib/util.lua'] = 'return { greet = function(n) return nil .. n end }';
const h2 = new LuaHost({ fengari: loadFengari(), lcd, files, bitmaps: m.bitmaps });
h2.loadWidget('/WIDGETS/demo/main.lua', { w: 480, h: 272 }, {});
const bad = h2.callWidget('refresh', 'default');
eq('error mentions the library file and line', /util\.lua:1:/.test(bad.error || ''), true);
console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);
