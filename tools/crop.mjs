// node tools/crop.mjs in.png x y w h out.png
import fs from 'node:fs';
import { readPng, writePng } from './node-env.mjs';
const [, , inp, x, y, w, h, out] = process.argv;
const { w: W, rgba } = readPng(fs.readFileSync(inp));
const o = new Uint8ClampedArray(w * h * 4);
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let c = 0; c < 4; c++) o[(j * w + i) * 4 + c] = rgba[((+y + j) * W + (+x + i)) * 4 + c];
writePng(out, +w, +h, o);
