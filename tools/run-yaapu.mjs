// Runs the real Yaapu widget headless with simulated flight telemetry and saves what it draws.
// Usage: node tools/run-yaapu.mjs [sdDir] [out.png]      (env PAGE=1..6 picks the Yaapu screen)
import path from 'node:path';
import { Lcd } from '../src/lcd.js';
import { LuaHost } from '../src/host.js';
import { Passthrough, feed } from '../src/passthrough.js';
import { loadFengari, loadFontsNode, writePng, loadSdTree, root } from './node-env.mjs';

const sd = process.argv[2] || 'C:/Users/Bill/dev/FrskyTelemetryScript-custom/OTX_ETX/c480x272/SD';
const out = process.argv[3] || path.join(root, 'test', 'yaapu-flying.png');
const { files, bitmaps } = loadSdTree(path.join(sd, 'WIDGETS', 'yaapu'), '/WIDGETS/yaapu/');
const lcd = new Lcd(480, 272, await loadFontsNode());
let t = 1000;
const host = new LuaHost({ fengari: loadFengari(), lcd, files, bitmaps, now: () => t, modelName: 'Endurance', onLog: (l) => console.log('lua>', l) });
const pt = new Passthrough({ roll: 18, pitch: 6, yaw: 135, vspeed: 1.2, hspeed: 11 });
let r = host.loadWidget('/WIDGETS/yaapu/main.lua', { w: 480, h: 272 }, { 'Screen Type': Number(process.env.PAGE || 1) });
console.log('create:', r.ok ? 'ok' : r.error);
const msgs = [['Yaapu Telemetry Widget', 7], ['EKF3 IMU0 is using GPS', 6], ['PreArm: Compass not calibrated', 4], ['Flight plan received', 6]];
for (let i = 0; i < 400 && r.ok; i++) {
  t += 10; // 100 ms per loop => 40 s of flight
  if (i === 20) for (const [m, sev] of msgs) host.sportQueue.push(...pt.messageFrames(m, sev));
  if (i % 3 === 0) feed(host, pt);
  r = host.callWidget('background'); if (!r.ok) { console.log('background:', r.error); break; }
  if (i % 4 === 0) { r = host.callWidget('refresh'); if (!r.ok) { console.log('refresh:', r.error); break; } }
}
console.log('unsupported:', [...lcd.unsupported].map(([k, v]) => `${k}×${v}`).join(', ') || 'none');
writePng(out, lcd.w, lcd.h, lcd.toRGBA());
console.log('wrote', out);
