// Runs the real Yaapu widget headless and saves what it draws. Usage: node tools/run-yaapu.mjs [sdDir] [out.png]
import path from 'node:path';
import { Lcd } from '../src/lcd.js';
import { LuaHost } from '../src/host.js';
import { loadFengari, loadFontsNode, writePng, loadSdTree, root } from './node-env.mjs';

const sd = process.argv[2] || 'C:/Users/Bill/dev/FrskyTelemetryScript-custom/OTX_ETX/c480x272/SD';
const out = process.argv[3] || path.join(root, 'test', 'yaapu.png');
const { files, bitmaps } = loadSdTree(path.join(sd, 'WIDGETS', 'yaapu'), '/WIDGETS/yaapu/');
const lcd = new Lcd(480, 272, await loadFontsNode());
let t = 1000;
const host = new LuaHost({ fengari: loadFengari(), lcd, files, bitmaps, now: () => t, modelName: 'Endurance', onLog: (l) => console.log('lua>', l) });
console.log(`loaded ${Object.keys(files).length} files, ${Object.keys(bitmaps).length} images`);
let r = host.loadWidget('/WIDGETS/yaapu/main.lua', { w: 480, h: 272 }, { 'Screen Type': Number(process.env.PAGE || 1) });
console.log('create:', r.ok ? 'ok' : r.error);
for (let i = 0; i < 40 && r.ok; i++) { t += 10; r = host.callWidget('background'); if (!r.ok) { console.log('background:', r.error); break; } }
for (let i = 0; i < 12 && r.ok; i++) { t += 10; r = host.callWidget('refresh'); if (!r.ok) { console.log('refresh:', r.error); break; } }
console.log('unsupported:', [...lcd.unsupported].map(([k, v]) => `${k}×${v}`).join(', ') || 'none');
writePng(out, lcd.w, lcd.h, lcd.toRGBA());
console.log('wrote', out);
