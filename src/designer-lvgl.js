// Visual editing for EdgeTX 2.11+ LVGL objects.
// They are described by Lua *tables* ({ type = "label", x = 20, y = 10, text = "Hi" } inside lvgl.build, or the table passed to
// lvgl.label({...})), so a drag rewrites `key = value` fields inside that table. Same idea as designer.js, different shape.
import { scan, shifted, addStatement } from './designer.js';

// which size keys the corner handle changes, per object type
export const LV_RESIZE = {
  label: ['w', 'h'], rectangle: ['w', 'h'], box: ['w', 'h'], button: ['w', 'h'], momentaryButton: ['w', 'h'], toggle: ['w', 'h'], textEdit: ['w', 'h'],
  numberEdit: ['w', 'h'], choice: ['w', 'h'], image: ['w', 'h'], qrcode: ['w', 'h'], slider: ['w'], verticalSlider: ['h'], hline: ['w'], vline: ['h'],
  circle: ['radius'], arc: ['radius'],
};
export const LV_NOMOVE = new Set(['line', 'triangle']); // positioned by point lists, not x / y
export const lvType = (it) => it.fn.replace(/^lvgl\./, '');
const LITERAL = /^(-?\d+(\.\d+)?|true|false|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/;
const litValue = (t) => (/^-?\d/.test(t) ? +t : t === 'true' ? true : t === 'false' ? false : t.slice(1, -1));

// split the top level of the table that starts at `open` ("{") into fields: { close, fields: {key: {text, vstart, vend}} }
export function parseTable(src, open) {
  const fields = {}; let depth = 0, segStart = open + 1, close = -1;
  const take = (end) => {
    const seg = src.slice(segStart, end), m = /^\s*([A-Za-z_]\w*)\s*=(?!=)\s*/.exec(seg);
    if (m) { const vstart = segStart + m[0].length, text = src.slice(vstart, end).trimEnd(); fields[m[1]] = { text, vstart, vend: vstart + text.length }; }
  };
  scan(src, open, (i, c) => {
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) { close = i; take(i); return false; } }
    else if ((c === ',' || c === ';') && depth === 1) { take(i); segStart = i + 1; }
    return true;
  });
  return close < 0 ? null : { close, fields };
}

// every table in the source that describes an LVGL object, in source order: { type, open, close, fields, callStart, callEnd }
export function lvglSites(src) {
  const sites = [];
  scan(src, 0, (i, c) => {
    if (c !== '{') return true;
    const t = parseTable(src, i); if (!t) return true;
    let type = null, callStart = -1, callEnd = -1;
    const tf = t.fields.type;
    if (tf) { const m = /^["']([A-Za-z]+)["']$/.exec(tf.text) || /^lvgl\.([A-Z]+)$/.exec(tf.text); if (m) type = m[1]; }
    if (!type) { // lvgl.label({ ... }), lvgl.label(parent, { ... }) or lvgl.label{ ... }
      const before = src.slice(Math.max(0, i - 80), i), m = /lvgl\.([A-Za-z]+)\s*(\(\s*(?:[A-Za-z_][\w.]*\s*,\s*)?)?$/.exec(before);
      if (m && m[1] !== 'build' && m[1] !== 'set') {
        type = m[1]; callStart = i - (before.length - m.index); callEnd = t.close + 1;
        if (m[2]) { const e = /^\s*\)/.exec(src.slice(t.close + 1)); callEnd = e ? t.close + 1 + e[0].length : -1; }
      }
    }
    if (type) sites.push({ type, open: i, close: t.close, fields: t.fields, callStart, callEnd });
    return true; // keep scanning inside: nested `children` tables are sites too
  });
  return sites;
}

// pair each drawn object (items with .lv) with the table that defines it, comparing the literal fields. Returns Map(id -> site)
export function matchSites(sites, items) {
  const used = new Set(), map = new Map();
  for (const it of items.filter((x) => x.lv).sort((a, b) => a.id - b.id)) {
    const type = lvType(it).toLowerCase();
    for (const s of sites) {
      if (used.has(s) || s.type.toLowerCase() !== type) continue;
      let ok = true;
      for (const [k, f] of Object.entries(s.fields)) if (k !== 'type' && LITERAL.test(f.text) && it.p0[k] !== litValue(f.text)) { ok = false; break; }
      if (ok) { used.add(s); map.set(it.id, s); break; }
    }
  }
  return map;
}

// set several fields of one table at once ({key: newText}); existing values are replaced, missing keys are inserted after the "{"
export function setFields(src, site, edits) {
  const t = parseTable(src, site.open); if (!t) return null;
  const rep = Object.entries(edits).filter(([k]) => t.fields[k]), add = Object.entries(edits).filter(([k]) => !t.fields[k]);
  let out = src;
  for (const [k, text] of rep.sort((a, b) => t.fields[b[0]].vstart - t.fields[a[0]].vstart)) out = out.slice(0, t.fields[k].vstart) + text + out.slice(t.fields[k].vend);
  if (add.length) out = out.slice(0, site.open + 1) + ' ' + add.map(([k, text]) => `${k} = ${text},`).join(' ') + (/^[ \t]*\n/.test(src.slice(site.open + 1)) ? '' : ' ') + out.slice(site.open + 1);
  return out;
}
const base = (site, key, dflt) => (site.fields[key] ? site.fields[key].text : String(dflt));
export function moveLvgl(src, site, dx, dy) {
  const e = {}; if (dx) e.x = shifted(base(site, 'x', 0), dx); if (dy) e.y = shifted(base(site, 'y', 0), dy);
  return Object.keys(e).length ? setFields(src, site, e) : src;
}
// dw / dh = growth of the bounding box in pixels; bw / bh = its current size (used for keys the script has not written yet)
export function resizeLvgl(src, site, type, dw, dh, bw, bh) {
  const keys = LV_RESIZE[type]; if (!keys) return null;
  const e = {};
  if (keys[0] === 'radius') { const d = Math.round((Math.abs(dw) >= Math.abs(dh) ? dw : dh) / 2); if (d) e.radius = shifted(base(site, 'radius', Math.round(bw / 2)), d); }
  else {
    if (keys.includes('w') && dw) e.w = shifted(base(site, 'w', bw), dw);
    if (keys.includes('h') && dh) e.h = shifted(base(site, 'h', bh), dh);
  }
  return Object.keys(e).length ? setFields(src, site, e) : src;
}
// remove an object: its own lines when it stands alone, else just the table text plus a trailing comma. null = not safely possible
export function deleteLvgl(src, site) {
  const s = site.callStart >= 0 ? site.callStart : site.open, e = site.callStart >= 0 ? site.callEnd : site.close + 1;
  if (e < 0) return null;
  const ls = src.lastIndexOf('\n', s - 1) + 1, before = src.slice(ls, s), tail = /^[ \t]*,?[ \t]*(\n|$)/.exec(src.slice(e));
  if (before.trim() === '' && tail) return src.slice(0, ls) + src.slice(e + tail[0].length);
  if (site.callStart >= 0) return null; // the call is part of a bigger statement
  const c = /^\s*,/.exec(src.slice(e));
  return src.slice(0, s) + src.slice(e + (c ? c[0].length : 0)).replace(/^[ \t]+/, '');
}
// add a new object: appended to the first lvgl.build({...}) table, else into create()/init(), else the end of the script.
// Returns { src, line } (line = 1-based line of the new entry).
export function addLvgl(src, type, params) {
  const fields = Object.entries(params).map(([k, v]) => `${k} = ${v}`).join(', ');
  const bm = /lvgl\.build\s*\(\s*(?:[A-Za-z_][\w.]*\s*,\s*)?\{|lvgl\.build\s*\{/.exec(src);
  const t = bm && parseTable(src, bm.index + bm[0].length - 1);
  if (t) {
    const entry = `{ type = "${type}", ${fields} },`, ls = src.lastIndexOf('\n', t.close - 1) + 1;
    if (src.slice(ls, t.close).trim() === '') { // closing brace on its own line: new entry goes above it
      let pre = src.slice(0, ls); const indent = src.slice(ls, t.close) + '  ';
      if (!/[{,;]\s*$/.test(pre)) pre = pre.replace(/(\S)(\s*)$/, '$1,$2'); // previous entry needs a comma
      return { src: pre + indent + entry + '\n' + src.slice(ls), line: pre.split('\n').length };
    }
    const inner = src.slice(bm.index + bm[0].length, t.close).trim();
    const comma = inner === '' || /,$/.test(inner) ? '' : ',';
    return { src: src.slice(0, t.close).trimEnd() + comma + ' ' + entry + ' ' + src.slice(t.close), line: src.slice(0, t.close).split('\n').length };
  }
  return addStatement(src, `lvgl.${type}({ ${fields} })`, /(?:function\s+(?:create|init)\s*\(|(?:create|init)\s*=\s*function\s*\()/);
}
