// ArduPilot FrSky "passthrough" telemetry encoder: turns a flight state into the S.Port frames
// Yaapu decodes (the inverse of processTelemetry() in Yaapu's main.lua).
// A frame is [sensorId, frameId, dataId, value] as returned by sportTelemetryPop().

const put = (v, bits, shift) => (((Math.max(0, Math.round(v)) & ((2 ** bits) - 1)) >>> 0) * 2 ** shift);
// number + power-of-ten field: `bits` of mantissa at `shift`, `powBits` of exponent at `powShift`
function scaled(x, bits, shift, powBits, powShift) {
  x = Math.max(0, Math.abs(x)); let p = 0;
  while (Math.round(x / 10 ** p) > (2 ** bits) - 1 && p < (2 ** powBits) - 1) p++;
  return put(Math.round(x / 10 ** p), bits, shift) + put(p, powBits, powShift);
}
const bit = (b, shift) => (b ? 2 ** shift : 0);

export const DEFAULT_STATE = {
  mode: 5, armed: true, landComplete: false, failsafe: false, battFailsafe: false, ekf: 0, throttle: 45, imuTemp: 40,
  roll: 0, pitch: 0, yaw: 90, vspeed: 0, hspeed: 5,           // deg, deg, deg, m/s, m/s
  battV: 15.8, battA: 12.3, battMah: 850,                       // V, A, mAh
  sats: 14, gpsFix: 3, hdop: 0.9, gpsAlt: 120,                  // fix: 0 none, 1 no fix, 2 2D, 3 3D
  homeDist: 120, homeAlt: 35, homeAngle: 45,                    // m, m, deg
  lat: 47.6062, lon: -122.3321, rssi: 90,
};

// [state key, label, min, max, step] for the "simulated flight" sliders
export const FLIGHT_SLIDERS = [['roll', 'Roll', -90, 90, 1], ['pitch', 'Pitch', -45, 45, 1], ['yaw', 'Heading', 0, 359, 1], ['hspeed', 'Speed m/s', 0, 40, 1],
  ['vspeed', 'Climb m/s', -10, 10, 0.1], ['homeAlt', 'Alt (home) m', 0, 400, 1], ['homeDist', 'Home dist m', 0, 2000, 10], ['battV', 'Battery V', 12, 17, 0.1],
  ['battA', 'Current A', 0, 60, 0.5], ['battMah', 'Used mAh', 0, 5000, 10], ['sats', 'Satellites', 0, 15, 1], ['rssi', 'RSSI', 0, 100, 1]];

export class Passthrough {
  constructor(state = {}) { this.s = { ...DEFAULT_STATE, ...state }; }
  set(patch) { Object.assign(this.s, patch); }

  // the regular (non-message) frames, once around
  frames() {
    const s = this.s, F = (id, v) => [0x1b, 0x10, id, v];
    const thr = Math.round(Math.abs(s.throttle) / 1.58);
    return [
      F(0x5001, put(s.mode, 5, 0) + bit(s.landComplete, 7) + bit(s.armed, 8) + bit(s.battFailsafe, 9) + put(s.ekf, 2, 10) + bit(s.failsafe, 12)
        + put(thr, 6, 19) + bit(s.throttle < 0, 25) + put(s.imuTemp - 19, 6, 26)),
      F(0x5002, put(s.sats, 4, 0) + put(Math.min(s.gpsFix, 3), 2, 4) + scaled(s.hdop * 10, 7, 7, 1, 6) + scaled(Math.abs(s.gpsAlt) * 10, 7, 24, 2, 22) + bit(s.gpsAlt < 0, 31)),
      F(0x5003, put(s.battV * 10, 9, 0) + scaled(s.battA * 10, 7, 10, 1, 9) + put(s.battMah, 15, 17)),
      F(0x5004, scaled(s.homeDist, 10, 2, 2, 0) + scaled(Math.abs(s.homeAlt) * 10, 10, 14, 2, 12) + bit(s.homeAlt < 0, 24) + put(s.homeAngle / 3, 7, 25)),
      F(0x5005, scaled(Math.abs(s.vspeed) * 10, 7, 1, 1, 0) + bit(s.vspeed < 0, 8) + scaled(s.hspeed * 10, 7, 10, 1, 9) + put(s.yaw / 0.2, 11, 17)),
      F(0x5006, put(s.roll / 0.2 + 900, 11, 0) + put(s.pitch / 0.2 + 450, 10, 11)),
    ];
  }

  // a status text ("STABILIZE: ..."), severity 0..7, split into 4-character frames like ArduPilot does
  messageFrames(text, severity = 6) {
    const out = [], bytes = [...text].map((c) => c.charCodeAt(0) & 0x7f); bytes.push(0);
    while (bytes.length % 4) bytes.push(0);
    for (let i = 0; i < bytes.length; i += 4) {
      let v = 0; for (let j = 0; j < 4; j++) v += bytes[i + j] * 2 ** (24 - 8 * j);
      if (i + 4 >= bytes.length) v += bit(severity & 1, 7) + bit(severity & 2, 15) + bit(severity & 4, 23);
      out.push([0x1b, 0x10, 0x5000, v >>> 0]);
    }
    return out;
  }
}

// Fill a LuaHost with one full telemetry "tick": queue frames and set the plain sensors Yaapu reads with getValue().
export function feed(host, pt) {
  const s = pt.s;
  host.telemetry.RSSI = s.rssi; host.telemetry.GPS = { lat: s.lat, lon: s.lon };
  host.sportQueue.push(...pt.frames());
}
