// Builds src/api-docs.json (names, signatures, one-line help) from the luadoc comments in EdgeTX's own source.
// Usage: node tools/gen-api-docs.mjs      (needs network; EdgeTX is GPL-2.0, see LICENSE notes)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['api_colorlcd', 'api_general', 'api_model', 'api_filesystem'];
const out = [];
for (const f of FILES) {
  const url = `https://raw.githubusercontent.com/EdgeTX/edgetx/main/radio/src/lua/${f}.cpp`;
  const text = await (await fetch(url)).text();
  for (const m of text.matchAll(/\/\*luadoc\s*\n@function ([^\n]+)\n([\s\S]*?)\*\//g)) {
    const head = /^([\w.]+)\s*\(([^)]*)\)/.exec(m[1].trim()); if (!head) continue;
    const body = m[2].split('\n');
    const para = [], params = []; let started = false, done = false;
    for (const l of body) {
      const t = l.trim();
      if (t.startsWith('@param')) { params.push(t.replace(/^@param\s+/, '')); done = true; continue; }
      if (t.startsWith('@')) { done = true; continue; }
      if (done) continue;
      if (t === '') { if (started) done = true; continue; }
      started = true; para.push(t);
    }
    out.push({ name: head[1], sig: head[2].trim(), doc: para.join(' ').replace(/`/g, '').slice(0, 220), params: params.slice(0, 10).map((p) => p.slice(0, 160)), src: f });
  }
}
out.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(root, 'src', 'api-docs.json'), JSON.stringify(out));
console.log(`${out.length} functions`, out.slice(0, 3).map((o) => o.name + '(' + o.sig + ')').join('  |  '));
