// Smoke test: Lua -> host -> LCD -> PNG, plus the Lua-side behaviours scripts rely on.
import path from 'node:path';
import { Lcd } from '../src/lcd.js';
import { LuaHost } from '../src/host.js';
import { loadFengari, loadFontsNode, writePng, root } from '../tools/node-env.mjs';

const fengari = loadFengari();
const lcd = new Lcd(480, 272, await loadFontsNode());
const host = new LuaHost({ fengari, lcd, telemetry: { RSSI: 99, 'Alt': 12.5 },
  files: { '/WIDGETS/demo/lib/util.lua': 'return { double = function(x) return x * 2 end }' } });

let failures = 0;
const check = (name, got, want) => { const ok = String(got) === String(want); if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  got=${got} want=${want}`}`); };
const val = (expr) => { const r = host.evalString(expr); return r.ok ? r.value : `ERR ${r.error}`; };

// Lua environment
check('Lua version', val('_VERSION'), 'Lua 5.3');
check('bit32.extract', val('bit32.extract(0xABCD, 4, 8)'), '188');          // 0xBC
check('bit32.band/lshift', val('bit32.band(bit32.lshift(1, 31), 0xFFFFFFFF)'), '2147483648.0');
check('flag math SMLSIZE+BOLD == MIDSIZE', val('SMLSIZE + BOLD == MIDSIZE'), 'true');
check('lcd.sizeText STD "Hello"', val('select(1, lcd.sizeText("Hello"))'), String(lcd.textWidth('Hello')));
check('lcd.RGB is RGB565 in upper bits + RGB_FLAG', val('lcd.RGB(255,0,0)'), String(((0xF800 << 16) | 0x8000) | 0));
check('math.pow shim', val('math.pow(2, 10)'), '1024.0');
check('getValue', val('getValue("RSSI")'), '99');
check('loadScript from virtual SD', val('loadScript("/WIDGETS/demo/lib/util.lua")().double(21)'), '42');
check('io.open missing file', val('io.open("/nope.txt", "r")'), 'nil');
host.exec('local f = io.open("/WIDGETS/demo/a.cfg", "w"); io.write(f, "PTP:2,L1:1"); io.close(f)');
check('io write then read', val('(function() local f = io.open("/WIDGETS/demo/a.cfg", "r"); local s = io.read(f, 4); io.close(f); return s end)()'), 'PTP:');

// Drawing
const script = `
  lcd.clear(COLOR_THEME_PRIMARY1)
  lcd.setColor(CUSTOM_COLOR, lcd.RGB(20, 40, 70))
  lcd.drawFilledRectangle(0, 0, 480, 20, CUSTOM_COLOR)
  lcd.drawText(2, 0, "Endurance", WHITE)
  lcd.drawText(478, 0, "RS: 99", WHITE + RIGHT)
  lcd.drawTimer(240, 0, 75, WHITE + CENTER)
  lcd.setColor(CUSTOM_COLOR, YELLOW)
  lcd.drawText(0, 40, "BOLD INF ArduPilot Ready", BOLD + CUSTOM_COLOR)
  lcd.drawText(0, 62, "SMLSIZE+BOLD is MIDSIZE", SMLSIZE + BOLD + WHITE)
  lcd.drawNumber(478, 100, 1234, DBLSIZE + PREC2 + RIGHT + WHITE)
  lcd.drawRectangle(10, 150, 100, 40, lcd.RGB(255, 80, 80), 2)
  lcd.drawLine(10, 200, 200, 260, SOLID, WHITE)
  lcd.drawGauge(250, 150, 120, 14, 60, 100, GREEN)
`;
const r = host.exec(script, '=draw');
check('draw script ran', r.ok, true); if (!r.ok) console.log(r.error);
const rgba = lcd.toRGBA();
const lit = Array.from({ length: lcd.w * lcd.h }, (_, i) => rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]).filter((v) => v > 60).length;
check('screen has drawn content', lit > 2000, true);
writePng(path.join(root, 'test', 'smoke.png'), lcd.w, lcd.h, rgba);
console.log(`unsupported calls so far: ${JSON.stringify([...lcd.unsupported])}`);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
