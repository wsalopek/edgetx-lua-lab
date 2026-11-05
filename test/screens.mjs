// The real Yaapu widget must load and draw on every colour screen EdgeTX supports, with that screen's font set.
// Needs Bill's Yaapu fork checked out next to this repo (skips a size whose SD folder is missing).
import fs from 'node:fs';
import path from 'node:path';
import { Lcd } from '../src/lcd.js';
import { LuaHost } from '../src/host.js';
import { SCREENS } from '../src/screens.js';
import { Passthrough, feed } from '../src/passthrough.js';
import { loadFengari, loadFontsNode, loadSdTree } from '../tools/node-env.mjs';
let fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `  got ${JSON.stringify(g)} want ${JSON.stringify(w)}`}`); };
const base = 'C:/Users/Bill/dev/FrskyTelemetryScript-custom/OTX_ETX/';
const F = loadFengari();
const fontCache = {};
for (const [key, scr] of Object.entries(SCREENS)) {
  const dir = path.join(base, scr.yaapu, 'SD', 'WIDGETS', 'yaapu');
  if (!fs.existsSync(dir)) { console.log(`skip ${key}: no Yaapu folder`); continue; }
  const { files, bitmaps } = loadSdTree(dir, '/WIDGETS/yaapu/');
  const lcd = new Lcd(scr.w, scr.h, (fontCache[scr.fonts] ||= await loadFontsNode(scr.fonts)));
  let t = 1000;
  const host = new LuaHost({ fengari: F, lcd, files, bitmaps, now: () => t });
  const pt = new Passthrough({ roll: 18, pitch: 6, yaw: 135, vspeed: 1.2, hspeed: 11 });
  let r = host.loadWidget('/WIDGETS/yaapu/main.lua', { w: scr.w, h: scr.h }, { 'Screen Type': 1 });
  for (let i = 0; i < 120 && r.ok; i++) {
    t += 10; if (i % 3 === 0) feed(host, pt);
    r = host.callWidget('background', 'default'); if (r.ok && i % 4 === 0) r = host.callWidget('refresh', 'default');
  }
  eq(`${key}: Yaapu runs`, r.ok ? 'ok' : r.error, 'ok');
  eq(`${key}: nothing unsupported`, [...lcd.unsupported.keys()], []);
  eq(`${key}: LCD size`, [lcd.w, lcd.h], [scr.w, scr.h]);
  const colours = new Set(lcd.fb); // a real screen has many colours, a failed one is blank
  eq(`${key}: something was drawn`, colours.size > 20, true);
}
console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);
