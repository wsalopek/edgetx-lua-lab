// Visual-editing helpers: turn a drag / click on the simulated screen into an edit of the Lua source text.
// Works on the *call sites* of lcd.* functions: numbers are replaced in place; computed arguments get "+ N" appended.

// which arguments of each lcd.* function are positions / sizes (0-based)
export const SPEC = {
  drawText: { move: [[0, 1]] }, drawNumber: { move: [[0, 1]] }, drawTimer: { move: [[0, 1]] },
  drawRectangle: { move: [[0, 1]], size: [2, 3] }, drawFilledRectangle: { move: [[0, 1]], size: [2, 3] },
  drawGauge: { move: [[0, 1]], size: [2, 3] }, drawTextLines: { move: [[0, 1]], size: [2, 3] },
  drawLine: { move: [[0, 1], [2, 3]] },
  drawCircle: { move: [[0, 1]], radius: 2 }, drawFilledCircle: { move: [[0, 1]], radius: 2 },
  drawArc: { move: [[0, 1]], radius: 2 }, drawPie: { move: [[0, 1]], radius: 2 }, drawAnnulus: { move: [[0, 1]], radius: 3 },
  drawTriangle: { move: [[0, 1], [2, 3], [4, 5]] }, drawFilledTriangle: { move: [[0, 1], [2, 3], [4, 5]] },
  drawBitmap: { move: [[1, 2]] },
};
export const ARG_NAMES = {
  drawText: ['x', 'y', 'text', 'flags'], drawNumber: ['x', 'y', 'value', 'flags'], drawTimer: ['x', 'y', 'seconds', 'flags'],
  drawRectangle: ['x', 'y', 'w', 'h', 'color', 'thickness'], drawFilledRectangle: ['x', 'y', 'w', 'h', 'color', 'opacity'],
  drawGauge: ['x', 'y', 'w', 'h', 'fill', 'max', 'color'], drawLine: ['x1', 'y1', 'x2', 'y2', 'pattern', 'color'],
  drawCircle: ['x', 'y', 'r', 'color'], drawFilledCircle: ['x', 'y', 'r', 'color'], drawArc: ['x', 'y', 'r', 'start', 'end', 'color'],
  drawPie: ['x', 'y', 'r', 'start', 'end', 'color'], drawAnnulus: ['x', 'y', 'r1', 'r2', 'start', 'end', 'color'],
  drawTriangle: ['x1', 'y1', 'x2', 'y2', 'x3', 'y3', 'color'], drawFilledTriangle: ['x1', 'y1', 'x2', 'y2', 'x3', 'y3', 'color'],
  drawBitmap: ['bitmap', 'x', 'y', 'scale%'], drawTextLines: ['x', 'y', 'w', 'h', 'text', 'flags'],
};

// Skip strings, comments and long brackets while scanning; calls fn(i, ch) for each "code" character; fn returning false stops.
function scan(src, from, fn) {
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') { // comment
      const m = /^--\[(=*)\[/.exec(src.slice(i, i + 12));
      if (m) { const e = src.indexOf(']' + m[1] + ']', i); i = e < 0 ? src.length : e + m[1].length + 2; }
      else { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; }
      continue;
    }
    if (c === '"' || c === "'") { i++; while (i < src.length && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } i++; continue; }
    if (c === '[') {
      const m = /^\[(=*)\[/.exec(src.slice(i, i + 12));
      if (m) { const e = src.indexOf(']' + m[1] + ']', i); i = e < 0 ? src.length : e + m[1].length + 2; continue; }
    }
    if (fn(i, c) === false) return i;
    i++;
  }
  return -1;
}

// Find the nth `lcd.<fn>(` call on 1-based `line`; returns { start, open, close, args:[{text,start,end}] } or null.
export function findCall(src, line, fn, nth = 0) {
  const lines = src.split('\n'); if (line < 1 || line > lines.length) return null;
  let off = 0; for (let i = 0; i < line - 1; i++) off += lines[i].length + 1;
  const lineText = lines[line - 1], re = new RegExp('\\blcd\\.' + fn + '\\s*\\(', 'g'); let m, k = 0;
  while ((m = re.exec(lineText))) {
    if (k++ !== nth) continue;
    return parseArgs(src, off + m.index, off + m.index + m[0].length - 1);
  }
  return null;
}
function parseArgs(src, start, open) {
  const args = []; let depth = 0, argStart = open + 1, close = -1;
  scan(src, open, (i, c) => {
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) { close = i; if (src.slice(argStart, i).trim() !== '' || args.length) args.push({ start: argStart, end: i }); return false; }
    } else if (c === ',' && depth === 1) { args.push({ start: argStart, end: i }); argStart = i + 1; }
    return true;
  });
  if (close < 0) return null;
  for (const a of args) a.text = src.slice(a.start, a.end).trim();
  return { start, open, close, args };
}

const NUM = /^-?\d+(\.\d+)?$/;
// new text for an argument after adding `delta` to it
export function shifted(text, delta) {
  if (!delta) return text;
  const t = text.trim();
  if (NUM.test(t)) return String(Math.round((+t + delta) * 100) / 100);
  const m = /^(.*?)\s*([+-])\s*(\d+(?:\.\d+)?)$/.exec(t); // already "expr + 12" -> merge
  if (m && m[1] !== '' && !/[(\[{*/^%,]\s*$/.test(m[1])) {
    const total = (m[2] === '+' ? 1 : -1) * +m[3] + delta;
    return total === 0 ? m[1] : `${m[1]} ${total > 0 ? '+' : '-'} ${Math.abs(Math.round(total * 100) / 100)}`;
  }
  // safe to append "+ N" without parentheses unless the expression has lower-precedence operators, calls or strings
  const plain = !/\.\.|[<>=~&|(\[{"']|\b(and|or|not)\b/.test(t);
  return plain ? `${t} ${delta > 0 ? '+' : '-'} ${Math.abs(delta)}` : `(${t}) ${delta > 0 ? '+' : '-'} ${Math.abs(delta)}`;
}

// Apply several argument edits at once ({index: newText}); edits run right-to-left so offsets stay valid.
export function patchArgs(src, call, edits) {
  let out = src;
  for (const idx of Object.keys(edits).map(Number).sort((a, b) => b - a)) {
    const a = call.args[idx]; if (!a) continue;
    const lead = /^\s*/.exec(src.slice(a.start, a.end))[0];
    out = out.slice(0, a.start) + lead + edits[idx] + out.slice(a.end);
  }
  return out;
}

// move by (dx, dy). Returns new source or null when not possible.
export function moveItem(src, line, fn, nth, dx, dy) {
  const call = findCall(src, line, fn, nth), sp = SPEC[fn]; if (!call || !sp) return null;
  const edits = {};
  for (const [xi, yi] of sp.move) {
    if (call.args[xi]) edits[xi] = shifted(call.args[xi].text, dx);
    if (call.args[yi]) edits[yi] = shifted(call.args[yi].text, dy);
  }
  return patchArgs(src, call, edits);
}
// resize by (dw, dh); circles/arcs use the larger drag distance as radius change
export function resizeItem(src, line, fn, nth, dw, dh) {
  const call = findCall(src, line, fn, nth), sp = SPEC[fn]; if (!call || !sp) return null;
  const edits = {};
  if (sp.size) {
    if (call.args[sp.size[0]]) edits[sp.size[0]] = shifted(call.args[sp.size[0]].text, dw);
    if (call.args[sp.size[1]]) edits[sp.size[1]] = shifted(call.args[sp.size[1]].text, dh);
  } else if (sp.radius !== undefined && call.args[sp.radius]) {
    edits[sp.radius] = shifted(call.args[sp.radius].text, Math.abs(dw) >= Math.abs(dh) ? dw : dh);
  } else return null;
  return patchArgs(src, call, edits);
}
// delete a call that is a statement on its own line
export function deleteItem(src, line, fn, nth) {
  const call = findCall(src, line, fn, nth); if (!call) return null;
  const lines = src.split('\n'), t = lines[line - 1].trim();
  if (!new RegExp('^lcd\\.' + fn + '\\s*\\(').test(t) || src.slice(call.close + 1).split('\n')[0].trim() !== '') return null;
  lines.splice(line - 1, 1); return lines.join('\n');
}

// index of the `end` that closes the function starting at `fnStart` (simple block counter)
export function functionEnd(src, fnStart) {
  let depth = 0, started = false, endIdx = -1, pendingLoopDo = 0;
  const re = /(function|if|for|while|do|repeat|end|until)\b/y;
  scan(src, fnStart, (i, c) => {
    if (!/[a-z]/.test(c) || (i > 0 && /\w/.test(src[i - 1]))) return true;
    re.lastIndex = i; const m = re.exec(src); if (!m) return true;
    const w = m[1];
    if (w === 'function' || w === 'if' || w === 'repeat') { depth++; started = true; }
    else if (w === 'for' || w === 'while') { depth++; started = true; pendingLoopDo++; }
    else if (w === 'do') { if (pendingLoopDo > 0) pendingLoopDo--; else { depth++; started = true; } }
    else if (w === 'end' || w === 'until') { depth--; if (started && depth === 0) { endIdx = i; return false; } }
    return true;
  });
  return endIdx;
}

// insert a new statement at the end of the drawing function (refresh/run) or at the end of a plain script
export function addStatement(src, statement) {
  const m = /(?:function\s+(?:refresh|run)\s*\(|(?:refresh|run)\s*=\s*function\s*\()/.exec(src);
  if (m) {
    const e = functionEnd(src, m.index);
    if (e > 0) {
      const ls = src.lastIndexOf('\n', e - 1) + 1, before = src.slice(ls, e);
      const bodyIndent = before.trim() === '' ? before + '  ' : '  ';
      return { src: src.slice(0, ls) + bodyIndent + statement + '\n' + src.slice(ls), line: src.slice(0, ls).split('\n').length };
    }
  }
  const sep = src.endsWith('\n') ? '' : '\n';
  return { src: src + sep + statement + '\n', line: (src + sep).split('\n').length };
}
