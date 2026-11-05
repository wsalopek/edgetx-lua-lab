// LVGL support: builds a small UI, draws it, saves test/lvgl.png (look at it!) and checks positions / input.
import path from 'node:path';
import { Lcd } from '../src/lcd.js';
import { LuaHost } from '../src/host.js';
import { loadFengari, loadFontsNode, writePng, root } from '../tools/node-env.mjs';
let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `  got ${JSON.stringify(g)} want ${JSON.stringify(w)}`}`); };

const lcd = new Lcd(480, 272, await loadFontsNode());
const host = new LuaHost({ fengari: loadFengari(), lcd });
host.record = true; host.items = [];
const SRC = `
local clicks, on, level = 0, false, 40
local ui = lvgl.build({
  { type = "rectangle", x = 4, y = 4, w = 470, h = 262, color = COLOR_THEME_SECONDARY2, filled = true },
  { type = "label", x = 20, y = 14, text = "LVGL demo", font = MIDSIZE, color = COLOR_THEME_PRIMARY2 },
  { type = "label", x = 20, y = 50, text = function() return "clicks: " .. clicks end },
  { type = "button", x = 20, y = 80, w = 120, h = 36, text = "Press me", press = function() clicks = clicks + 1 end },
  { type = "toggle", x = 160, y = 80, w = 56, h = 32, get = function() return on end, set = function(v) on = (v == 1) end },
  { type = "slider", x = 20, y = 130, w = 200, h = 32, min = 0, max = 100, get = function() return level end, set = function(v) level = v end },
  { type = "box", x = 250, y = 20, w = 200, h = 150, flexFlow = lvgl.FLOW_COLUMN, color = COLOR_THEME_SECONDARY3, children = {
      { type = "label", text = "one" }, { type = "label", text = "two" }, { type = "button", text = "three", w = 80, h = 30 } } },
  { type = "circle", x = 20, y = 180, radius = 30, filled = true, color = RED },
  { type = "arc", x = 100, y = 180, radius = 30, thickness = 8, startAngle = 0, endAngle = 270, color = GREEN, bgColor = GREY, bgOpacity = 255 },
  { type = "hline", x = 20, y = 250, w = 200, h = 2, color = WHITE },
  { type = "triangle", pts = { {400, 240}, {440, 240}, {420, 200} }, color = YELLOW },
  { type = "line", pts = { {250, 200}, {300, 230}, {350, 200} }, thickness = 3, color = BLUE },
})
function getClicks() return clicks end
function isOn() return on end
function getLevel() return level end
`;
const r = host.exec(SRC, '=script'); eq('script loads', r.ok ? 'ok' : r.error, 'ok');
host.lvglFullscreen(true);
lcd.clear(0);
const d = host.drawLvgl(); eq('draw ok', d.ok ? 'ok' : d.error, 'ok');
eq('error log empty', host.lvglError(), null);
const items = host.items;
eq('15 objects drawn (12 top level + 3 inside the box)', items.length, 15);
const by = (fn, i = 0) => items.filter((it) => it.fn === fn)[i];
eq('button bbox', by('lvgl.button', 0).bbox, [20, 80, 120, 36]);
// flex column: children stack top to bottom starting at the box padding (2px outline)
const lab = items.filter((it) => it.fn === 'lvgl.label');
eq('flex child one at box padding', lab[2].bbox.slice(0, 2), [252, 22]);
eq('flex child two below one', lab[3].bbox[0], 252);
eq('flex child two is lower', lab[3].bbox[1] > lab[2].bbox[1], true);
eq('p0 holds literal x', by('lvgl.button', 0).p0.x, 20);
eq('circle bbox is its 2r square', by('lvgl.circle').bbox, [20, 180, 60, 60]);

// input: tap the button twice, flip the toggle, drag the slider
const tap = (x, y) => { host.lvglTouch('down', x, y); host.lvglTouch('up', x, y); };
tap(60, 98); tap(60, 98);
eq('button pressed twice', host.evalString('getClicks()').value, '2');
tap(185, 96);
eq('toggle on', host.evalString('isOn()').value, 'true');
host.lvglTouch('down', 20 + 6 + 94, 146); host.lvglTouch('up', 120, 146);
eq('slider near the middle', Math.abs(+host.evalString('getLevel()').value - 50) <= 2, true);
host.items = []; lcd.clear(0); host.drawLvgl();
writePng(path.join(root, 'test', 'lvgl.png'), lcd.w, lcd.h, lcd.toRGBA());
console.log('unsupported:', [...lcd.unsupported.keys()].join(', ') || 'none');

// controls must not exist in a normal (non-fullscreen) widget
const h2 = new LuaHost({ fengari: loadFengari(), lcd: new Lcd(480, 272, await loadFontsNode()) });
h2.lvglFullscreen(false);
h2.exec('b = lvgl.button({ text = "x" }); l = lvgl.label({ text = "y" })', '=s');
eq('button is nil outside fullscreen', h2.evalString('b').value, 'nil');
eq('label still created', h2.evalString('type(l)').value, 'table');
console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);
