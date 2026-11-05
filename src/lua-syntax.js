// Tiny Lua syntax highlighter: source text -> HTML (for a <pre> layered under the editor textarea).
// Output must have exactly the same characters, line breaks and widths as the input, or the text would drift out of alignment.
const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'for', 'function', 'goto', 'if', 'in', 'local', 'not', 'or', 'repeat', 'return', 'then', 'until', 'while']);
const LITERALS = new Set(['true', 'false', 'nil']);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls, s) => `<span class="${cls}">${esc(s)}</span>`;

// `known` = Set of API names (e.g. "lcd.drawText", "getValue") to colour as functions; `consts` = Set of constant names.
export function highlight(src, known = new Set(), consts = new Set()) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') { // comment (line or block)
      const m = /^--\[(=*)\[/.exec(src.slice(i, i + 12));
      let e;
      if (m) { e = src.indexOf(']' + m[1] + ']', i); e = e < 0 ? n : e + m[1].length + 2; }
      else { e = src.indexOf('\n', i); if (e < 0) e = n; }
      out += span('com', src.slice(i, e)); i = e; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      j = Math.min(n, j + 1); out += span('str', src.slice(i, j)); i = j; continue;
    }
    if (c === '[') {
      const m = /^\[(=*)\[/.exec(src.slice(i, i + 12));
      if (m) { let e = src.indexOf(']' + m[1] + ']', i); e = e < 0 ? n : e + m[1].length + 2; out += span('str', src.slice(i, e)); i = e; continue; }
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|\d*\.?\d+([eE][+-]?\d+)?)/.exec(src.slice(i, i + 40));
      out += span('num', m[0]); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w]*(\.[A-Za-z_]\w*)*/.exec(src.slice(i, i + 80)); // dotted name like lcd.drawText
      let word = m[0];
      if (known.has(word)) { out += span('api', word); i += word.length; continue; }
      const first = /^[A-Za-z_]\w*/.exec(word)[0]; // otherwise colour just the first identifier
      if (KEYWORDS.has(first)) out += span('kw', first);
      else if (LITERALS.has(first)) out += span('lit', first);
      else if (consts.has(first)) out += span('const', first);
      else out += esc(first);
      i += first.length; continue;
    }
    out += esc(c); i++;
  }
  return out;
}
