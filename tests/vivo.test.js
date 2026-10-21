const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../fitbit-air/vivo.js");

const dv = (bytes) => new DataView(Uint8Array.from(bytes).buffer);

test("medición uint8 sin RR", () => {
  assert.deepEqual(V.leerMedicion(dv([0x00, 72])), { lpm: 72, rr: [], contacto: null });
});

test("medición uint16 con contacto, energía y RR", () => {
  // flags: uint16 (0x01) + contacto detectado (0x06) + energía (0x08) + RR (0x10)
  const rr1 = 1024, rr2 = 820; // 1000 ms y ~801 ms
  const r = V.leerMedicion(dv([0x1f, 70, 0, 10, 0, rr1 & 255, rr1 >> 8, rr2 & 255, rr2 >> 8]));
  assert.equal(r.lpm, 70);
  assert.equal(r.contacto, true);
  assert.deepEqual(r.rr, [1000, 801]);
});

// RR sintéticos: 66 lpm con arritmia respiratoria a 12 rpm
function rrs(seg = 90, lpm = 66, rpm = 12) {
  const out = []; let t = 0;
  while (t < seg * 1000) { const base = 60000 / lpm; const x = Math.round(base * (1 + 0.05 * Math.sin((2 * Math.PI * rpm * t) / 60000))); out.push(x); t += x; }
  return out;
}

test("VFC y FR desde los RR", () => {
  const xs = rrs();
  assert.ok(V.rmssd(xs) > 5, `rmssd ${V.rmssd(xs)}`);
  assert.ok(Math.abs(V.frDesdeRr(xs) - 12) <= 2, `fr ${V.frDesdeRr(xs)}`);
  assert.ok(Math.abs(V.frDesdeRr(rrs(90, 80, 16)) - 16) <= 2);
});

test("pocos datos: sin FR ni VFC", () => {
  assert.equal(V.frDesdeRr(rrs(20)), null);
  assert.equal(V.rmssd([900, 910]), null);
});

test("limpia latidos imposibles", () => {
  const xs = [900, 905, 2500, 910, 200, 895, 900, 1500, 905];
  assert.deepEqual(V.limpiarRr(xs), [900, 905, 910, 895, 900, 905]);
});
