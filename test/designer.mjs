// Tests for the visual-editing source patcher (drag / resize / delete / add become edits of the Lua text).
import { findCall, moveItem, resizeItem, deleteItem, addStatement, shifted, functionEnd } from '../src/designer.js';
let fail = 0;
const eq = (n, g, w) => { const ok = g === w; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `\n   got  ${JSON.stringify(g)}\n   want ${JSON.stringify(w)}`}`); };
const src = [
  'local function refresh(w)',
  '  lcd.drawText(10, 20, "hi, there", BOLD + WHITE)',
  '  lcd.drawFilledRectangle(w.x, 40 + off, 100, 30, RED)',
  '  lcd.drawCircle(50, 90, 12, GREEN) lcd.drawCircle(80, 90, 12, GREEN)',
  '  lcd.drawLine(0, 0, 100, 100, SOLID, WHITE)',
  '  for i = 1, 3 do lcd.drawText(i * 10, 5, "x") end',
  'end',
  'return { refresh = refresh }',
  '',
].join('\n');
const L = (s, n) => s.split('\n')[n - 1];
eq('findCall args', findCall(src, 2, 'drawText').args.map((a) => a.text).join('|'), '10|20|"hi, there"|BOLD + WHITE');
eq('move literals', L(moveItem(src, 2, 'drawText', 0, 5, -3), 2), '  lcd.drawText(15, 17, "hi, there", BOLD + WHITE)');
eq('move expression', L(moveItem(src, 3, 'drawFilledRectangle', 0, 7, 2), 3), '  lcd.drawFilledRectangle(w.x + 7, 40 + off + 2, 100, 30, RED)');
const once = moveItem(src, 3, 'drawFilledRectangle', 0, 7, 2);
eq('merge back to original', L(moveItem(once, 3, 'drawFilledRectangle', 0, -7, -2), 3), '  lcd.drawFilledRectangle(w.x, 40 + off, 100, 30, RED)');
eq('second call on a line', L(moveItem(src, 4, 'drawCircle', 1, 10, 0), 4), '  lcd.drawCircle(50, 90, 12, GREEN) lcd.drawCircle(90, 90, 12, GREEN)');
eq('line moves both ends', L(moveItem(src, 5, 'drawLine', 0, 1, 1), 5), '  lcd.drawLine(1, 1, 101, 101, SOLID, WHITE)');
eq('computed arg in a loop', L(moveItem(src, 6, 'drawText', 0, 4, 0), 6), '  for i = 1, 3 do lcd.drawText(i * 10 + 4, 5, "x") end');
eq('resize rect', L(resizeItem(src, 3, 'drawFilledRectangle', 0, 20, 10), 3), '  lcd.drawFilledRectangle(w.x, 40 + off, 120, 40, RED)');
eq('resize circle', L(resizeItem(src, 4, 'drawCircle', 0, 4, 0), 4), '  lcd.drawCircle(50, 90, 16, GREEN) lcd.drawCircle(80, 90, 12, GREEN)');
eq('delete statement', deleteItem(src, 5, 'drawLine', 0).includes('drawLine'), false);
eq('no delete when line is shared', deleteItem(src, 4, 'drawCircle', 0), null);
eq('shifted negative literal', shifted('-5', 2), '-3');
eq('function end', src.slice(functionEnd(src, 0), functionEnd(src, 0) + 3), 'end');
const add = addStatement(src, 'lcd.drawText(10, 10, "new", WHITE)');
eq('add inside refresh', L(add.src, 7), '  lcd.drawText(10, 10, "new", WHITE)');
eq('added line number', add.line, 7);
eq('add to plain script', addStatement('lcd.clear()\n', 'lcd.drawLine(0,0,5,5,SOLID)').src, 'lcd.clear()\nlcd.drawLine(0,0,5,5,SOLID)\n');
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
