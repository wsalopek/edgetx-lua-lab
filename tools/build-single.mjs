// Builds dist/edgetx-lua-lab.html: the whole editor (code, fonts, API help, Lua engine) in ONE file you can open by double-click.
// Usage: node tools/build-single.mjs      (uses `npx esbuild` only as a build step; nothing is added to the repo)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'demo', 'editor.html'), 'utf8');

// 1. split the page into: head+body markup, the fengari <script src>, and the inline module
const modRe = /<script type="module">([\s\S]*?)<\/script>/;
const mod = modRe.exec(html);
if (!mod) throw new Error('inline module not found in demo/editor.html');
const tmp = path.join(root, 'demo', '.bundle-entry.mjs');
fs.writeFileSync(tmp, mod[1]);
let js;
try {
  js = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'esbuild', tmp, '--bundle', '--format=esm', '--target=es2022', '--minify'], { encoding: 'utf8', maxBuffer: 64e6, shell: process.platform === 'win32' });
} finally { fs.rmSync(tmp, { force: true }); }

// 2. data that the page normally fetches
const fonts = {};
for (const f of fs.readdirSync(path.join(root, 'src', 'fonts'))) if (f.endsWith('.json')) fonts[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(root, 'src', 'fonts', f), 'utf8'));
const docs = JSON.parse(fs.readFileSync(path.join(root, 'src', 'api-docs.json'), 'utf8'));
const fengari = fs.readFileSync(path.join(root, 'vendor', 'fengari', 'fengari-web.js'), 'utf8');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script'); // never let embedded text end the script early

let out = html.replace(/<script src="\.\.\/vendor\/fengari\/fengari-web\.js"><\/script>/, () => `<script>${safe(fengari)}</script>\n<script>window.__EMBED=${safe(JSON.stringify({ fonts, docs }))};</script>`);
out = out.replace(modRe, () => `<script type="module">${safe(js)}</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const dest = path.join(root, 'dist', 'edgetx-lua-lab.html');
fs.writeFileSync(dest, out);
console.log(`wrote ${path.relative(root, dest)}  ${(out.length / 1024).toFixed(0)} KB`);
