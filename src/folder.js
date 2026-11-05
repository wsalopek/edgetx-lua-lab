// Turns "the files in a folder the user picked" into a simulated SD card for LuaHost.
// entries: [{ rel: 'lib/utils.lua', text: '...' } | { rel: 'images/a.png', bitmap: {w,h,rgba} }]  (rel = path inside the picked folder)
// A picked folder can be an SD-card root (has WIDGETS/ or SCRIPTS/), or one widget / script folder (has main.lua, or just .lua files).
export const TEXT_EXT = /\.(lua|txt|cfg|json|csv|md)$/i;
export const IMAGE_EXT = /\.(png)$/i;

export function buildMount(rootName, entries) {
  const rels = entries.map((e) => e.rel);
  const sdRoot = rels.some((r) => /^(WIDGETS|SCRIPTS)\//i.test(r));
  const mount = sdRoot ? '/' : `/WIDGETS/${rootName}/`; // one widget folder: behaves like /WIDGETS/<name>/ on the radio
  const docs = [], bitmaps = {};
  for (const e of entries) {
    const path = (mount + e.rel).replace(/\/+/g, '/');
    if (e.bitmap) bitmaps[path] = e.bitmap; else docs.push({ path, rel: e.rel, text: e.text, handle: e.handle });
  }
  docs.sort((a, b) => a.path.localeCompare(b.path));
  // scripts that EdgeTX would start on their own: widget main.lua files, tool and telemetry scripts
  let candidates = docs.filter((d) => /^\/WIDGETS\/[^/]+\/main\.lua$/i.test(d.path) || /^\/SCRIPTS\/(TOOLS|TELEMETRY)\/[^/]+\.lua$/i.test(d.path)).map((d) => d.path);
  if (!candidates.length) candidates = docs.filter((d) => /\.lua$/i.test(d.path)).map((d) => d.path);
  return { name: rootName, mount, sdRoot, docs, bitmaps, candidates, entry: candidates[0] || null };
}

// the name Lua reports for a chunk loaded as "@path" (LUA_IDSIZE = 60 truncates long names with a "..." prefix)
export function chunkId(path) { const max = 59; return path.length <= max ? path : '...' + path.slice(path.length - (max - 3)); }

// text files / images -> entries, from a directory handle (File System Access API) or a plain FileList (webkitdirectory fallback).
// `decodePng(blob)` -> {w,h,rgba}. Skips sounds and other binaries, hidden folders and anything over 2 MB.
export async function readDirectory(dirHandle, decodePng, limit = 6000) {
  const entries = []; let n = 0;
  async function walk(dir, rel) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (h.kind === 'directory') { await walk(h, rel + name + '/'); continue; }
      if (++n > limit) throw new Error(`more than ${limit} files - pick a smaller folder`);
      const file = await h.getFile(); if (file.size > 2e6) continue;
      if (TEXT_EXT.test(name)) entries.push({ rel: rel + name, text: await file.text(), handle: h });
      else if (IMAGE_EXT.test(name)) { try { entries.push({ rel: rel + name, bitmap: await decodePng(file) }); } catch { /* unreadable image: skip */ } }
    }
  }
  await walk(dirHandle, '');
  return entries;
}
export async function readFileList(files, decodePng) {
  const entries = []; let rootName = 'widget';
  for (const f of files) {
    const parts = f.webkitRelativePath.split('/'); rootName = parts[0]; const rel = parts.slice(1).join('/');
    if (parts.slice(1).some((p) => p.startsWith('.')) || f.size > 2e6) continue;
    if (TEXT_EXT.test(f.name)) entries.push({ rel, text: await f.text() });
    else if (IMAGE_EXT.test(f.name)) { try { entries.push({ rel, bitmap: await decodePng(f) }); } catch { /* skip */ } }
  }
  return { rootName, entries };
}
