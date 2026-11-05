// Lua host: runs EdgeTX Lua scripts on Fengari (Lua 5.3) with a simulated radio API.
// Works in the browser (global `fengari` from vendor/fengari/fengari-web.js) and in Node (tests).
import { EVENTS } from './events.js';
import { LVGL_LUA } from './lvgl.js';
import { FLAGS, COLOR_INDEX, THEME_COLOR_COUNT, colorToFlags, rgb565, Bitmap } from './lcd.js';

const norm = (p) => {
  const out = [];
  for (const seg of String(p).replace(/\\/g, '/').toLowerCase().split('/')) {
    if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
};

// Lua-side shims: things EdgeTX provides that plain Lua 5.3 lacks (io on a virtual SD card, old math names).
const SHIMS = `
math.pow = math.pow or function(x, y) return x ^ y end
math.atan2 = math.atan2 or function(y, x) return math.atan(y, x) end
math.log10 = math.log10 or function(x) return math.log(x, 10) end
math.ldexp = math.ldexp or function(m, e) return m * 2.0 ^ e end
string.gfind = string.gfind or string.gmatch
local _fmt = string.format
string.format = function(f, ...) -- EdgeTX tolerates floats for %d (truncates)
  local a = table.pack(...); local i = 0
  for spec in f:gmatch("%%[%-+ #0]*%d*%.?%d*([%a%%])") do
    if spec ~= "%" then i = i + 1
      if (spec == "d" or spec == "i" or spec == "x" or spec == "X" or spec == "c" or spec == "o" or spec == "u") and math.type(a[i]) == "float" then a[i] = math.floor(a[i]) end end
  end
  return _fmt(f, table.unpack(a, 1, a.n))
end
collectgarbage = function(opt) if opt == "count" then return 1024.0 end return 0 end -- fengari has no lua_gc
-- lcd.drawChannel: shows a telemetry value. Approximation: whole numbers as integers, others with one decimal (the radio uses each sensor's own unit and precision).
function lcd.drawChannel(x, y, source, flags)
  local v = getValue(source)
  if type(v) ~= "number" then return end
  local s = (v == math.floor(v)) and string.format("%d", v) or string.format("%.1f", v)
  lcd.drawText(x, y, s, flags or 0)
end
function lcd.exitFullScreen() end -- the simulator has no separate full-screen widget view
io = {}
local files = {}
function io.open(path, mode)
  mode = mode or "r"
  local f = { path = path, pos = 0, mode = mode, closed = false }
  if mode:sub(1,1) == "r" then
    local data = __fs_read(path)
    if data == nil then return nil, path .. ": No such file or directory" end
    f.data = data
  else
    f.data = (mode:sub(1,1) == "a") and (__fs_read(path) or "") or ""
    f.pos = #f.data
  end
  return f
end
function io.read(f, n)
  if f.closed then return nil end
  local s = f.data:sub(f.pos + 1, f.pos + (n or #f.data))
  f.pos = f.pos + #s
  return s
end
function io.write(f, ...)
  if f.closed then return nil end
  for _, v in ipairs({...}) do f.data = f.data:sub(1, f.pos) .. tostring(v); f.pos = #f.data end
  __fs_write(f.path, f.data)
  return #f.data
end
function io.seek(f, whence, off)
  off = off or 0
  if whence == "set" then f.pos = off elseif whence == "end" then f.pos = #f.data + off else f.pos = f.pos + off end
  if f.pos < 0 then f.pos = 0 end
  return f.pos
end
function io.close(f) f.closed = true; return true end
function io.lines() error("io.lines is not available on EdgeTX") end
`;

export class LuaHost {
  // opts: { fengari, lcd, files: {path: text}, bitmaps: {path: Bitmap}, telemetry: {name: number}, now: () => ticks(10ms), onLog }
  constructor(opts) {
    this.f = opts.fengari;
    this.lcd = opts.lcd;
    this.files = new Map(); this.bitmaps = new Map();
    for (const [p, t] of Object.entries(opts.files || {})) this.files.set(norm(p), t);
    for (const [p, b] of Object.entries(opts.bitmaps || {})) this.bitmaps.set(norm(p), b);
    this.telemetry = Object.assign({ 'tx-voltage': 7.9, RSSI: 100, 'RQly': 100, 'TQly': 100, 'TPWR': 0, 'RFMD': 0 }, opts.telemetry || {});
    this.now = opts.now || (() => Math.floor(Date.now() / 10));
    this.log = [];
    this.onLog = opts.onLog || (() => {});
    this.bitmapObjs = [];
    this.timers = [0, 1, 2].map(() => ({ mode: 0, start: 0, value: 0, countdownBeep: 0, minuteBeep: false, persistent: 0, switch: 0, name: '' }));
    this.modelName = opts.modelName || 'Simulated';
    this.general = Object.assign({ imperial: 0, language: 'EN', voice: 'EN', battMin: 6.0, battMax: 8.4 }, opts.general || {});
    this.events = []; // audio/haptic calls
    this.record = false; this.recordChunk = 'script'; this.items = [];
    this.unknownCalls = new Map(); // global API functions scripts called that we do not have
    const { lua, lauxlib, lualib } = this.f;
    this.L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(this.L);
    this._installConstants();
    this._installLcd();
    this._installGeneral();
    this._installModel();
    this._installBit32();
    this._installBitmap();
    const r = this.exec(SHIMS, '=shims');
    if (!r.ok) throw new Error('shim error: ' + r.error);
    this._installLvgl();
  }

  // ---- lvgl (EdgeTX 2.11+ retained UI objects): the object tree lives in Lua, painted by drawLvgl() after each frame ----
  _installLvgl() {
    const { lua, lauxlib, to_jsstring } = this.f; const L = this.L;
    this.lvItems = new Map(); this.lvCur = null;
    this._def(null, '__unsupported', () => { this.lcd.noteUnsupported(to_jsstring(lauxlib.luaL_checkstring(L, 1))); return 0; });
    this._def(null, '__lvgl_item', () => {
      const n = (i) => Math.trunc(lua.lua_tonumber(L, i));
      const it = { fn: 'lvgl.' + to_jsstring(lua.lua_tostring(L, 2)), lv: true, id: n(1), line: n(7), args: [], bbox: [n(3), n(4), n(5), n(6)], p0: {}, inFlex: !!lua.lua_toboolean(L, 8) };
      this.lvCur = it; this.lvItems.set(it.id, it); return 0;
    });
    this._def(null, '__lvgl_field', () => {
      const k = to_jsstring(lua.lua_tostring(L, 2)); const t = lua.lua_type(L, 3);
      const v = t === lua.LUA_TNUMBER ? lua.lua_tonumber(L, 3) : t === lua.LUA_TBOOLEAN ? !!lua.lua_toboolean(L, 3) : to_jsstring(lua.lua_tostring(L, 3));
      const it = this.lvItems.get(Math.trunc(lua.lua_tonumber(L, 1))); if (it) it.p0[k] = v; return 0;
    });
    const r = this.exec(LVGL_LUA, '=lvgl');
    if (!r.ok) throw new Error('lvgl prelude error: ' + r.error);
  }
  // true when the script made any lvgl objects
  hasLvgl() { return this.evalString('lvgl.__count()').value !== '0'; }
  lvglFullscreen(b) { this.exec('lvgl.__setFull(' + (b ? 'true' : 'false') + ')', '=lvgl'); }
  lvglError() { const v = this.evalString('lvgl.lastError'); return v.ok && v.value !== 'nil' ? v.value : null; }
  // paint the lvgl tree on top of whatever the script drew with lcd.*; adds one item per object for the visual designer
  drawLvgl() {
    if (!this.hasLvgl()) return { ok: true };
    this.lvItems = new Map();
    const r = this.exec('lvgl.__draw()', '=lvgl');
    if (this.record) for (const it of this.lvItems.values()) this.items.push(it);
    return r;
  }
  lvglTouch(kind, x, y) { return this.exec('lvgl.__touch(' + JSON.stringify(kind) + ',' + (x | 0) + ',' + (y | 0) + ')', '=lvgl'); }

  // ---- small fengari helpers ----
  get S() { return this.f.to_luastring; }
  _def(tbl, name, fn) {
    (this.apiNames ||= new Set()).add(tbl ? tbl + '.' + name : name);
    const raw = fn; fn = () => { try { return raw(); } catch (e) { if (e && e.message !== undefined && typeof e.message === 'string' && !(e instanceof Error === false)) { this.f.lauxlib.luaL_error(this.L, this.S((tbl ? tbl + '.' : '') + name + ': ' + e.message)); } throw e; } };
    const { lua } = this.f; const L = this.L;
    if (tbl) { lua.lua_getglobal(L, this.S(tbl)); lua.lua_pushjsfunction(L, fn); lua.lua_setfield(L, -2, this.S(name)); lua.lua_pop(L, 1); }
    else { lua.lua_pushjsfunction(L, fn); lua.lua_setglobal(L, this.S(name)); }
  }
  _newTable(name) { const { lua } = this.f; lua.lua_newtable(this.L); lua.lua_setglobal(this.L, this.S(name)); }
  _setGlobalInt(name, v) { const { lua } = this.f; lua.lua_pushinteger(this.L, v | 0); lua.lua_setglobal(this.L, this.S(name)); }
  _pushU32(L, v) { const { lua } = this.f; v = v >>> 0; if (v <= 0x7fffffff) lua.lua_pushinteger(L, v); else lua.lua_pushnumber(L, v); }
  _pushTable(obj) {
    const { lua } = this.f; const L = this.L;
    lua.lua_newtable(L);
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number') (Number.isInteger(v) ? lua.lua_pushinteger(L, v) : lua.lua_pushnumber(L, v));
      else if (typeof v === 'boolean') lua.lua_pushboolean(L, v);
      else lua.lua_pushstring(L, this.S(String(v)));
      lua.lua_setfield(L, -2, this.S(k));
    }
  }

  // names of everything scripts can use: { consts: [...numbers], funcs: ['getValue', 'lcd.drawText', ...] }
  globalNames() {
    const { lua, to_jsstring } = this.f; const L = this.L; const consts = [], funcs = [];
    const walk = (prefix, depth) => {
      lua.lua_pushnil(L);
      while (lua.lua_next(L, -2) !== 0) {
        if (lua.lua_type(L, -2) === lua.LUA_TSTRING) {
          const k = to_jsstring(lua.lua_tostring(L, -2)), t = lua.lua_type(L, -1), full = prefix + k;
          if (!k.startsWith('__')) {
            if (t === lua.LUA_TNUMBER) consts.push(full);
            else if (t === lua.LUA_TFUNCTION) funcs.push(full);
            else if (t === lua.LUA_TTABLE && depth === 0 && /^[A-Za-z][A-Za-z0-9_]*$/.test(k) && k !== 'package' && k !== '_G') { lua.lua_pushvalue(L, -1); walk(full + '.', 1); lua.lua_pop(L, 1); }
          }
        }
        lua.lua_pop(L, 1);
      }
    };
    lua.lua_pushglobaltable(L); lua.lua_pushvalue(L, -1); walk('', 0); lua.lua_pop(L, 2);
    return { consts, funcs };
  }

  // ---- running code ----
  exec(code, chunkName = '=chunk') {
    const { lua, lauxlib, to_jsstring } = this.f; const L = this.L;
    const buf = this.S(code);
    let st = lauxlib.luaL_loadbuffer(L, buf, buf.length, this.S(chunkName));
    if (st === lua.LUA_OK) st = lua.lua_pcall(L, 0, 0, 0);
    if (st !== lua.LUA_OK) { const e = lua.lua_tostring(L, -1); const error = e ? to_jsstring(e) : '(error value is not a string)'; lua.lua_pop(L, 1); return { ok: false, error }; }
    return { ok: true };
  }
  // ---- widgets: load main.lua, call create()/refresh() like EdgeTX does ----
  loadWidget(mainPath, zone, options = {}) {
    const { lua, lauxlib, to_jsstring } = this.f; const L = this.L;
    const text = this.files.get(norm(mainPath));
    if (text === undefined) return { ok: false, error: 'no such file ' + mainPath };
    const buf = this.S(text);
    let st = lauxlib.luaL_loadbuffer(L, buf, buf.length, this.S('@' + mainPath));
    if (st === lua.LUA_OK) st = lua.lua_pcall(L, 0, 1, 0);
    if (st !== lua.LUA_OK) { const error = to_jsstring(lua.lua_tostring(L, -1)); lua.lua_pop(L, 1); return { ok: false, error }; }
    lua.lua_setglobal(L, this.S('__widgetModule'));
    this.instances = new Set();
    return this.newInstance('default', zone, options);
  }
  // Load a user script given as text. Kinds: 'widget' (returns table with create), 'telemetry' (returns table with run),
  // 'plain' (just runs top to bottom). Returns { ok, kind, error }.
  loadModuleText(text, chunk = '=script') {
    const { lua, lauxlib, to_jsstring } = this.f; const L = this.L;
    this.instances = new Set(); lua.lua_pushnil(L); lua.lua_setglobal(L, this.S('__widgetModule')); lua.lua_pushnil(L); lua.lua_setglobal(L, this.S('__instances'));
    const buf = this.S(text);
    let st = lauxlib.luaL_loadbuffer(L, buf, buf.length, this.S(chunk));
    if (st === lua.LUA_OK) st = lua.lua_pcall(L, 0, 1, 0);
    if (st !== lua.LUA_OK) { const error = to_jsstring(lua.lua_tostring(L, -1)); lua.lua_pop(L, 1); return { ok: false, error }; }
    lua.lua_setglobal(L, this.S('__widgetModule'));
    const k = this.evalString("type(__widgetModule) == 'table' and (__widgetModule.create and 'widget' or __widgetModule.run and 'telemetry') or 'plain'");
    return { ok: true, kind: k.value };
  }
  // run a telemetry-script function: init() or run(event) / background()
  callTelemetry(fn, event = null, touch = null) {
    const a = fn === 'run' ? (this._ev(event === null ? 0 : event) + ', ' + this._touch(touch)) : '';
    if (fn === 'run' && this.hasLvgl()) this.lcd.clear(this.lcd.resolve(colorToFlags(COLOR_INDEX.SECONDARY3))); // lvgl scripts get the theme background
    const r = this.exec("if __widgetModule." + fn + " then local r = __widgetModule." + fn + "(" + a + ") if r == 2 then __done = true end end", '=' + fn);
    if (r.ok && fn === 'run') { const d = this.drawLvgl(); if (!d.ok) return d; }
    return r;
  }

  // EdgeTX can show the same widget on several screens; each gets its own create() but they share script state.
  newInstance(id, zone, options = {}) {
    this.instances.add(id);
    const opts = Object.entries(options).map(([k, v]) => `o[${JSON.stringify(k)}] = ${JSON.stringify(v)}`).join(String.fromCharCode(10));
    return this.exec(`
      __instances = __instances or {}
      local o = {}
      ${opts}
      __instances[${JSON.stringify(id)}] = __widgetModule.create({ x = 0, y = 0, w = ${zone.w}, h = ${zone.h} }, o)`, '=create');
  }
  callWidget(fn = 'refresh', id = 'default', event = null, touch = null) {
    if (fn === 'refresh' && this.hasLvgl()) this.lcd.clear(this.lcd.resolve(colorToFlags(COLOR_INDEX.SECONDARY3)));
    const r = this.exec("local w = __instances[" + JSON.stringify(id) + "]; if __widgetModule." + fn + " then __widgetModule." + fn + "(w, " + this._ev(event) + ", " + this._touch(touch) + ") end", '=' + fn);
    if (r.ok && fn === 'refresh') { const d = this.drawLvgl(); if (!d.ok) return d; }
    return r;
  }
  _ev(e) { return e == null ? 'nil' : String(e | 0); }
  _touch(t) { return t ? '{' + Object.entries(t).map(([k, v]) => k + '=' + (typeof v === 'boolean' ? v : Number(v) | 0)).join(',') + '}' : 'nil'; }

  // evaluate a Lua expression and return its tostring()
  evalString(expr) {
    const { lua, lauxlib, to_jsstring } = this.f; const L = this.L;
    const buf = this.S(`return tostring(${expr})`);
    let st = lauxlib.luaL_loadbuffer(L, buf, buf.length, this.S('=eval'));
    if (st === lua.LUA_OK) st = lua.lua_pcall(L, 0, 1, 0);
    const out = to_jsstring(lua.lua_tostring(L, -1)); lua.lua_pop(L, 1);
    return st === lua.LUA_OK ? { ok: true, value: out } : { ok: false, error: out };
  }

  // ---- constants ----
  _installConstants() {
    for (const [k, v] of Object.entries(FLAGS)) this._setGlobalInt(k, v);
    for (const [n, idx] of Object.entries(COLOR_INDEX)) {
      const name = idx < THEME_COLOR_COUNT ? (n === 'CUSTOM' ? 'CUSTOM_COLOR' : `COLOR_THEME_${n}`) : n;
      this._setGlobalInt(name, colorToFlags(idx));
    }
    this._setGlobalInt('LCD_W', this.lcd.w); this._setGlobalInt('LCD_H', this.lcd.h);
    this._setGlobalInt('FULLSCALE', 1024);
    for (const [k, v] of Object.entries(EVENTS)) this._setGlobalInt(k, v);
  }

  // ---- lcd.* ----
  _installLcd() {
    const { lua, lauxlib, to_jsstring } = this.f; const lcd = this.lcd;
    const L = this.L;
    this._newTable('lcd');
    // EdgeTX accepts floats for integer arguments (truncates), so scripts pass computed coordinates freely
    const I = (i) => Math.trunc(lauxlib.luaL_checknumber(L, i));
    const O = (i, d) => (lua.lua_isnoneornil(L, i) ? d : Math.trunc(lauxlib.luaL_checknumber(L, i)));
    const U = (i, d) => O(i, d) >>> 0;
    const str = (i) => to_jsstring(lauxlib.luaL_checkstring(L, i));
    const RECORD = new Set(['drawText', 'drawNumber', 'drawTimer', 'drawRectangle', 'drawFilledRectangle', 'drawGauge', 'drawTextLines', 'drawLine', 'drawCircle',
      'drawFilledCircle', 'drawArc', 'drawPie', 'drawAnnulus', 'drawTriangle', 'drawFilledTriangle', 'drawBitmap']);
    const def = (n, fn) => this._def('lcd', n, RECORD.has(n) ? () => { if (this.record) this._record(n); return fn(); } : fn);
    def('refresh', () => 0);
    def('resetBacklightTimeout', () => 0);
    def('clear', () => { lcd.clear(lcd.resolve(U(1, colorToFlags(COLOR_INDEX.SECONDARY3)))); return 0; });
    def('drawPoint', () => { lcd.pixel(I(1), I(2), lcd.resolve(U(3, 0))); return 0; });
    def('drawLine', () => {
      const x1 = I(1), y1 = I(2), x2 = I(3), y2 = I(4), pat = I(5), flags = U(6, 0);
      if (x1 > lcd.w || y1 > lcd.h || x2 > lcd.w || y2 > lcd.h) return 0;
      lcd.line(x1, y1, x2, y2, pat, lcd.resolve(flags)); return 0;
    });
    def('drawRectangle', () => { lcd.rect(I(1), I(2), I(3), I(4), lcd.resolve(U(5, 0)), O(6, 1), O(7, 0) & 15); return 0; });
    def('drawFilledRectangle', () => { lcd.fillRect(I(1), I(2), I(3), I(4), lcd.resolve(U(5, 0)), O(6, 0) & 15); return 0; });
    def('drawText', () => {
      const inv = lua.lua_isnoneornil(L, 5) ? undefined : (lauxlib.luaL_checkinteger(L, 5) >>> 0);
      lcd.drawText(I(1), I(2), str(3), U(4, 0), inv); return 0;
    });
    def('drawNumber', () => { const fl = U(4, 0); lcd.drawText(I(1), I(2), lcd.numberString(I(3), fl), fl); return 0; });
    def('drawTimer', () => { const fl = U(4, 0); lcd.drawText(I(1), I(2), lcd.timerString(I(3), fl), fl); return 0; });
    def('sizeText', () => { const fl = U(2, 0); lua.lua_pushinteger(L, lcd.textWidth(str(1), fl)); lua.lua_pushinteger(L, lcd.fontHeight(fl)); return 2; });
    def('drawGauge', () => {
      const x = I(1), y = I(2), w = I(3), h = I(4), num = I(5), den = I(6), c = lcd.resolve(U(7, 0));
      lcd.rect(x, y, w, h, c, 1);
      const len = Math.min(w, Math.max(1, Math.trunc((w * num) / den)));
      lcd.fillRect(x + 1, y + 1, len, h - 2, c); return 0;
    });
    def('drawBitmap', () => {
      const bmp = this._bitmapArg(1);
      if (bmp) lcd.drawBitmap(bmp, I(2), I(3), O(4, 0));
      return 0;
    });
    const rgb = () => {
      let r, g, b;
      if (lua.lua_gettop(L) === 1) { const c = I(1) >>> 0; r = (c >> 16) & 255; g = (c >> 8) & 255; b = c & 255; }
      else { r = I(1); g = I(2); b = I(3); }
      lua.lua_pushinteger(L, ((rgb565(r, g, b) << 16) | FLAGS.RGB_FLAG) | 0); return 1;
    };
    def('RGB', rgb);
    def('setColor', () => { lcd.setColor(U(1), U(2)); return 0; });
    def('getColor', () => {
      const fl = U(1);
      if ((fl & FLAGS.RGB_FLAG) || ((fl >>> 16) & 255) < THEME_COLOR_COUNT) lua.lua_pushinteger(L, ((lcd.resolve(fl) << 16) | FLAGS.RGB_FLAG) | 0);
      else lua.lua_pushnil(L);
      return 1;
    });
    def('drawLineWithClipping', () => { lcd.lineClipped(I(1), I(2), I(3), I(4), I(5), I(6), I(7), I(8), I(9), lcd.resolve(U(10, 0))); return 0; });
    def('drawHudRectangle', () => {
      lcd.hudRect(lauxlib.luaL_checknumber(L, 1), lauxlib.luaL_checknumber(L, 2), I(3), I(4), I(5), I(6), lcd.resolve(U(7, 0))); return 0;
    });
    const col = (i) => lcd.resolve(U(i, 0));
    def('drawCircle', () => { lcd.circle(I(1), I(2), I(3), col(4)); return 0; });
    def('drawFilledCircle', () => { lcd.filledCircle(I(1), I(2), I(3), col(4)); return 0; });
    def('drawTriangle', () => { lcd.triangle(I(1), I(2), I(3), I(4), I(5), I(6), col(7)); return 0; });
    def('drawFilledTriangle', () => { lcd.filledTriangle(I(1), I(2), I(3), I(4), I(5), I(6), col(7)); return 0; });
    def('drawArc', () => { lcd.annulusSector(I(1), I(2), I(3) - 1, I(3), I(4), I(5), col(6)); return 0; });
    def('drawPie', () => { lcd.annulusSector(I(1), I(2), 0, I(3), I(4), I(5), col(6)); return 0; });
    def('drawAnnulus', () => { lcd.annulusSector(I(1), I(2), I(3), I(4), I(5), I(6), col(7)); return 0; });
    def('invertRect', () => { lcd.invertRect(I(1), I(2), I(3), I(4), col(5)); return 0; });
    def('drawTextLines', () => {
      const x = I(1), y = I(2), w = I(3), hh = I(4), txt = str(5), fl = U(6, 0);
      const c = lcd.resolve(fl);
      if (fl & FLAGS.INVERS) lcd.fillRect(x, y, w, hh, c);
      const [mx, my] = lcd.textLines(x, y, w, hh, txt, fl, fl & FLAGS.INVERS ? lcd.resolve(U(7, colorToFlags(COLOR_INDEX.PRIMARY2))) : c);
      lua.lua_pushinteger(L, mx); lua.lua_pushinteger(L, my); return 2;
    });
    // not implemented yet: record the call so we know what scripts need
    for (const n of ['drawSwitch', 'drawSource', 'drawBitmapPattern', 'drawBitmapPatternPie']) { // need model switch/source names and bitmap masks: not modelled yet
      this._def('lcd', n, () => { lcd.noteUnsupported('lcd.' + n); return 0; });
    }
  }

  // Remember what a drawing call drew and where in the user's script it came from (for click-and-drag editing).
  _record(name) {
    const { lua, to_jsstring } = this.f; const L = this.L;
    const ar = new lua.lua_Debug();
    if (!lua.lua_getstack(L, 1, ar)) return;
    lua.lua_getinfo(L, this.S('Sl'), ar);
    if (to_jsstring(ar.short_src) !== this.recordChunk) return;
    const n = lua.lua_gettop(L), a = [];
    for (let i = 1; i <= n; i++) a.push(lua.lua_type(L, i) === lua.LUA_TNUMBER ? lua.lua_tonumber(L, i) : lua.lua_type(L, i) === lua.LUA_TSTRING ? to_jsstring(lua.lua_tostring(L, i)) : null);
    let bbox;
    if (name === 'drawBitmap') { const b = this._bitmapArg(1); const sc = (a[3] || 100) / 100; bbox = b ? [a[1], a[2], Math.round(b.w * sc), Math.round(b.h * sc)] : null; }
    else bbox = this.lcd.bboxFor(name, a);
    if (bbox) this.items.push({ fn: name, line: ar.currentline, args: a, bbox });
  }

  // ---- bitmaps ----
  _installBitmap() {
    const { lua, lauxlib, to_jsstring } = this.f; const L = this.L;
    this._newTable('Bitmap');
    this._def('Bitmap', 'open', () => {
      const p = norm(to_jsstring(lauxlib.luaL_checkstring(L, 1)));
      const bmp = this.bitmaps.get(p);
      if (!bmp) { this.lcd.noteUnsupported('Bitmap.open(missing:' + p + ')'); lua.lua_pushnil(L); return 1; }
      this.bitmapObjs.push(bmp);
      lua.lua_newtable(L); lua.lua_pushinteger(L, this.bitmapObjs.length - 1); lua.lua_setfield(L, -2, this.S('_id'));
      return 1;
    });
    this._def('Bitmap', 'getSize', () => {
      const b = this._bitmapArg(1); lua.lua_pushinteger(L, b ? b.w : 0); lua.lua_pushinteger(L, b ? b.h : 0); return 2;
    });
  }
  _bitmapArg(i) {
    const { lua, lauxlib } = this.f; const L = this.L;
    if (lua.lua_type(L, i) !== lua.LUA_TTABLE) return null;
    lua.lua_getfield(L, i, this.S('_id')); const id = lua.lua_tointeger(L, -1); lua.lua_pop(L, 1);
    return this.bitmapObjs[id] || null;
  }

  // ---- general API ----
  _installGeneral() {
    const { lua, lauxlib, to_jsstring } = this.f; const L = this.L;
    this._def(null, 'getTime', () => { lua.lua_pushinteger(L, this.now() & 0x7fffffff); return 1; });
    this._def(null, 'getValue', () => {
      let v = 0;
      if (lua.lua_type(L, 1) === lua.LUA_TSTRING) v = this.telemetry[to_jsstring(lua.lua_tostring(L, 1))] ?? 0;
      else { const id = lauxlib.luaL_checkinteger(L, 1); const nm = id >= 1000 ? Object.keys(this.telemetry)[id - 1000] : '#' + id; v = this.telemetry[nm] ?? 0; }
      if (typeof v === 'string' || (typeof v === 'object')) { this._pushTable(v); return 1; }
      Number.isInteger(v) ? lua.lua_pushinteger(L, v) : lua.lua_pushnumber(L, v); return 1;
    });
    this._def(null, 'getFieldInfo', () => {
      const name = to_jsstring(lauxlib.luaL_checkstring(L, 1));
      if (!(name in this.telemetry)) { lua.lua_pushnil(L); return 1; }
      this._pushTable({ id: 1000 + Object.keys(this.telemetry).indexOf(name), name, desc: name, unit: 0 }); return 1;
    });
    this._def(null, 'getGeneralSettings', () => { this._pushTable(this.general); return 1; });
    this._def(null, 'getDateTime', () => {
      const d = new Date(); this._pushTable({ year: d.getFullYear(), mon: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), min: d.getMinutes(), sec: d.getSeconds(), dst: false }); return 1;
    });
    this._def(null, 'getRSSI', () => { lua.lua_pushinteger(L, this.telemetry.RSSI ?? 100); lua.lua_pushinteger(L, 45); lua.lua_pushinteger(L, 42); return 3; });
    this._def(null, 'getVersion', () => {
      lua.lua_pushstring(L, this.S('2.12.0')); lua.lua_pushstring(L, this.S('tx16s-simu')); lua.lua_pushinteger(L, 2); lua.lua_pushinteger(L, 12); lua.lua_pushinteger(L, 0); lua.lua_pushstring(L, this.S('EdgeTX')); return 6;
    });
    this._def(null, 'getFlightMode', () => { lua.lua_pushinteger(L, 0); lua.lua_pushstring(L, this.S('FM0')); return 2; });
    this._def(null, 'getAvailableMemory', () => { lua.lua_pushinteger(L, 8 * 1024 * 1024); return 1; });
    this._def(null, 'getUsage', () => { lua.lua_pushinteger(L, 10); return 1; });
    this._def(null, 'getCpuLoad', () => { lua.lua_pushinteger(L, 10); return 1; });
    this._def(null, 'killEvents', () => 0);
    // telemetry frame queues: host.sportQueue.push([sensorId, frameId, dataId, value])
    this.sportQueue = []; this.crsfQueue = [];
    this._def(null, 'sportTelemetryPop', () => {
      const f = this.sportQueue.shift(); if (!f) { lua.lua_pushnil(L); return 1; }
      for (const v of f) lua.lua_pushnumber(L, v); return f.length; });
    this._def(null, 'crossfireTelemetryPop', () => { lua.lua_pushnil(L); return 1; });
    this._def(null, 'sportTelemetryPush', () => { lua.lua_pushboolean(L, true); return 1; });
    this._def(null, 'crossfireTelemetryPush', () => { lua.lua_pushboolean(L, true); return 1; });
    // setTelemetryValue(id, subId, instance, value, unit, decimals, name): creates/updates a sensor
    this._def(null, 'setTelemetryValue', () => {
      const val = lauxlib.luaL_checknumber(L, 4), dec = lua.lua_isnoneornil(L, 6) ? 0 : lauxlib.luaL_checknumber(L, 6);
      const name = lua.lua_isnoneornil(L, 7) ? '#' + lauxlib.luaL_checkinteger(L, 1) : to_jsstring(lauxlib.luaL_checkstring(L, 7));
      this.telemetry[name] = val / 10 ** dec; lua.lua_pushboolean(L, true); return 1;
    });
    this._def(null, 'popupWarning', () => 0); this._def(null, 'playTone', () => 0);
    for (const n of ['playFile', 'playNumber', 'playDuration', 'playTone', 'playHaptic', 'flushAudio']) {
      this._def(null, n, () => { this.events.push(n); return 0; });
    }
    this._def(null, 'loadScript', () => {
      const path = to_jsstring(lauxlib.luaL_checkstring(L, 1));
      const base = norm(path).replace(/\.luac$/, '.lua');
      const text = this.files.get(base) ?? this.files.get(base.replace(/\.lua$/, '') + '.lua');
      if (text === undefined) { lua.lua_pushnil(L); lua.lua_pushstring(L, this.S(`cannot open ${path}`)); return 2; }
      const buf = this.S(text);
      const st = lauxlib.luaL_loadbuffer(L, buf, buf.length, this.S('@' + path));
      if (st !== lua.LUA_OK) { lua.lua_pushnil(L); lua.lua_insert(L, -2); return 2; }
      return 1;
    });
    this._def(null, '__fs_read', () => {
      const p = norm(to_jsstring(lauxlib.luaL_checkstring(L, 1))); const t = this.files.get(p);
      if (t === undefined) lua.lua_pushnil(L); else lua.lua_pushstring(L, this.S(t)); return 1;
    });
    this._def(null, '__fs_write', () => {
      this.files.set(norm(to_jsstring(lauxlib.luaL_checkstring(L, 1))), to_jsstring(lauxlib.luaL_checkstring(L, 2))); return 0;
    });
    this._def(null, 'print', () => {
      const n = lua.lua_gettop(L); const parts = [];
      for (let i = 1; i <= n; i++) parts.push(to_jsstring(lauxlib.luaL_tolstring(L, i)));
      lua.lua_settop(L, n); const line = parts.join('\t'); this.log.push(line); this.onLog(line); return 0;
    });
  }

  // ---- model.* ----
  _installModel() {
    const { lua, lauxlib, to_jsstring } = this.f; const L = this.L;
    this._newTable('model');
    this._def('model', 'getInfo', () => { this._pushTable({ name: this.modelName, extendedLimits: false, bitmap: '', filename: 'model.yml' }); return 1; });
    this._def('model', 'getTimer', () => { this._pushTable(this.timers[lauxlib.luaL_checkinteger(L, 1)] || this.timers[0]); return 1; });
    this._def('model', 'setTimer', () => {
      const i = lauxlib.luaL_checkinteger(L, 1); const t = this.timers[i]; if (!t) return 0;
      for (const k of Object.keys(t)) { lua.lua_getfield(L, 2, this.S(k)); if (!lua.lua_isnil(L, -1)) t[k] = lua.lua_isboolean(L, -1) ? lua.lua_toboolean(L, -1) : (lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : to_jsstring(lua.lua_tostring(L, -1))); lua.lua_pop(L, 1); }
      return 0;
    });
    for (const n of ['getInputs', 'getOutput', 'getSwitchName']) this._def('model', n, () => { this.lcd.noteUnsupported('model.' + n); lua.lua_pushnil(L); return 1; });
  }

  // ---- bit32 (32-bit unsigned semantics, as on the radio) ----
  _installBit32() {
    const { lua, lauxlib } = this.f; const L = this.L;
    this._newTable('bit32');
    const args = () => { const n = lua.lua_gettop(L); const a = []; for (let i = 1; i <= n; i++) a.push(lauxlib.luaL_checknumber(L, i) >>> 0); return a; };
    const d = (name, fn) => this._def('bit32', name, () => { this._pushU32(L, fn()); return 1; });
    d('band', () => args().reduce((x, y) => (x & y) >>> 0, 0xffffffff));
    d('bor', () => args().reduce((x, y) => (x | y) >>> 0, 0));
    d('bxor', () => args().reduce((x, y) => (x ^ y) >>> 0, 0));
    d('bnot', () => (~args()[0]) >>> 0);
    d('lshift', () => { const [x] = args(); const n = lauxlib.luaL_checkinteger(L, 2); return n >= 32 || n <= -32 ? 0 : n >= 0 ? (x << n) >>> 0 : x >>> -n; });
    d('rshift', () => { const [x] = args(); const n = lauxlib.luaL_checkinteger(L, 2); return n >= 32 || n <= -32 ? 0 : n >= 0 ? x >>> n : (x << -n) >>> 0; });
    d('arshift', () => { const x = args()[0] | 0; const n = lauxlib.luaL_checkinteger(L, 2); return (n >= 0 ? x >> Math.min(n, 31) : x << -n) >>> 0; });
    d('extract', () => {
      const n = args()[0], field = lauxlib.luaL_checkinteger(L, 2), w = lauxlib.luaL_optinteger(L, 3, 1);
      if (field < 0 || w <= 0 || field + w > 32) lauxlib.luaL_error(L, this.S('trying to access non-existent bits'));
      return w === 32 ? n : ((n >>> field) & ((1 << w) - 1)) >>> 0;
    });
    d('replace', () => {
      const n = args()[0], v = lauxlib.luaL_checknumber(L, 2) >>> 0, field = lauxlib.luaL_checkinteger(L, 3), w = lauxlib.luaL_optinteger(L, 4, 1);
      if (field < 0 || w <= 0 || field + w > 32) lauxlib.luaL_error(L, this.S('trying to access non-existent bits'));
      const mask = w === 32 ? 0xffffffff : ((1 << w) - 1); return ((n & ~(mask << field)) | ((v & mask) << field)) >>> 0;
    });
    this._def('bit32', 'btest', () => { lua.lua_pushboolean(L, args().reduce((x, y) => (x & y) >>> 0, 0xffffffff) !== 0); return 1; });
    d('lrotate', () => { const [x] = args(); const n = ((lauxlib.luaL_checkinteger(L, 2) % 32) + 32) % 32; return ((x << n) | (x >>> (32 - n))) >>> 0; });
    d('rrotate', () => { const [x] = args(); const n = ((lauxlib.luaL_checkinteger(L, 2) % 32) + 32) % 32; return ((x >>> n) | (x << (32 - n))) >>> 0; });
  }
}
