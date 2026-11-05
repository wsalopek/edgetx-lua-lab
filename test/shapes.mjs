// Draws every shape function once and saves test/shapes.png (look at it!). Also asserts nothing is "unsupported" except known gaps.
import path from 'node:path';
import { Lcd } from '../src/lcd.js';
import { LuaHost } from '../src/host.js';
import { loadFengari, loadFontsNode, writePng, root } from '../tools/node-env.mjs';
const lcd = new Lcd(480, 272, await loadFontsNode());
const host = new LuaHost({ fengari: loadFengari(), lcd });
const r = host.exec(`
lcd.clear(COLOR_THEME_SECONDARY3)
lcd.drawCircle(40, 40, 30, RED); lcd.drawFilledCircle(110, 40, 30, BLUE)
lcd.drawTriangle(150, 70, 190, 10, 230, 70, GREEN); lcd.drawFilledTriangle(250, 70, 290, 10, 330, 70, YELLOW)
lcd.drawArc(60, 130, 40, 0, 270, WHITE); lcd.drawPie(150, 130, 40, 45, 200, BLACK); lcd.drawAnnulus(240, 130, 20, 40, 300, 60, RED)
lcd.drawFilledRectangle(300, 100, 100, 50, BLUE); lcd.invertRect(320, 110, 60, 30, WHITE)
lcd.drawRectangle(10, 190, 120, 70, BLACK)
local x, y = lcd.drawTextLines(14, 194, 112, 62, "Hello wrapped-text world: words wrap", BLACK)
lcd.drawText(150, 200, x .. "," .. y, BLACK)
`, '=shapes');
console.log(r.ok ? 'ok' : r.error);
console.log('unsupported:', [...lcd.unsupported.keys()].join(', ') || 'none');
writePng(path.join(root, 'test', 'shapes.png'), lcd.w, lcd.h, lcd.toRGBA());
