# EdgeTX Lua Lab

A free, open-source **editor and simulator for EdgeTX Lua scripts** that runs in a web browser
(and later as a Windows app). Edit a widget/tool script, see what it draws on a simulated radio
screen, and feed it fake telemetry, switches and sticks - without a radio or the full Companion
simulator.

Status: **milestone 1 in progress** - proving that a browser preview can match the real EdgeTX
simulator pixel-for-pixel using the Yaapu telemetry widget as the test script.

## Goals
1. Edit a Lua script and see the result in a simulated radio screen (color radios first, then every
   radio the Yaapu widget supports).
2. Help people write new scripts: templates for each script type, autocomplete and docs, and later
   a visual designer for the LVGL UI toolkit.
3. Stay accurate: real EdgeTX fonts, real screen sizes, golden screenshots from Companion's own
   simulator to test against.

## Not goals
Emulating the whole EdgeTX firmware. (A WASM build of the real firmware is a possible later
collaboration with the EdgeTX project.)

## License
GPL-3.0, matching EdgeTX and Yaapu. See `LICENSE`.

See `docs/NOTES.md` for research notes and `docs/MILESTONE1.md` for the current plan.

## Easiest: one file, no install
Open `dist/edgetx-lua-lab.html` in a browser (double-click). It contains everything: editor, Lua engine, fonts, API help.
Rebuild it after changing the source with `node tools/build-single.mjs` (needs Node; uses `npx esbuild` only while building).

## Or run from source (needs only Node to serve the files)
```
node tools/serve.mjs 8130
```
- `demo/editor.html` - write a widget / telemetry / plain script and see the simulated radio screen; radio keys + touchscreen input; **Design mode**: click/drag/resize things on the screen and the edits are written into your Lua code (or type code and watch the screen)
- EdgeTX 2.11+ **LVGL** scripts (`lvgl.build`, `lvgl.label`, buttons, sliders, toggles, boxes with flex layout, arcs...) run too, and the Design mode drags them by rewriting their table fields (`x = ..., y = ...`). Template: "LVGL tool script". Not drawn yet: image, qrcode, pickers, pages, dialogs.
- `demo/yaapu.html` - the real Yaapu widget flying on simulated ArduPilot telemetry
- `demo/lab.html` - the original minimal editor prototype
