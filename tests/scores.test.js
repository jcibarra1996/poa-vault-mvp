const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../fitbit-air/scores.js");

// 40 días estables con una noche de 7.5 h
function serie(n = 40, f = () => ({})) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const fecha = P.sumarDias("2026-09-01", i);
    out.push({ fecha, fc_reposo: 58 + (i % 3) - 1, vfc: 45 + (i % 5) - 2, resp: 14.5, temp: 34, temp_base: 34, pasos: 8000 + (i % 4) * 500, azm: i % 2 ? 30 : 5,
      sueno: { inicio: `${fecha}T05:30:00Z`, fin: `${fecha}T13:30:00Z`, offset: -21600, enCama: 480, dormido: 450, latencia: 10, etapas: { DEEP: 90, REM: 100, LIGHT: 260, AWAKE: 30 }, despertares: 6 }, ...f(i, fecha) });
  }
  return out;
}

test("z-score a puntos", () => {
  assert.equal(P.desdeZ(0), 80);
  assert.equal(P.desdeZ(1), 95);
  assert.equal(P.desdeZ(-2), 36);
  assert.equal(P.desdeZ(5), 100);
});

test("buena noche puntúa alto", () => {
  const s = P.sueno(serie(1)[0].sueno);
  assert.ok(s.total >= 90, `total ${s.total}`);
  assert.equal(s.contribuyentes.find((c) => c.key === "horario").pts, 100); // punto medio 03:30 local
});

test("noche corta puntúa bajo", () => {
  const s = P.sueno({ dormido: 260, enCama: 330, latencia: 45, etapas: { DEEP: 20, REM: 25 }, despertares: 15 });
  assert.ok(s.total < 40, `total ${s.total}`);
});

test("sin datos no inventa puntuación", () => {
  assert.equal(P.sueno(null).total, null);
  const r = P.recuperacion(P.indice([]), "2026-10-01");
  assert.equal(r.total, null);
  assert.equal(r.calibrando, true);
});

test("recuperación cae con FC alta, VFC baja y fiebre", () => {
  const normal = serie();
  const malo = serie(40, (i) => (i >= 37 ? { fc_reposo: 66, vfc: 30, temp: 34.9, resp: 16.5 } : {}));
  const ult = normal.at(-1).fecha;
  const a = P.recuperacion(P.indice(normal), ult);
  const b = P.recuperacion(P.indice(malo), ult);
  assert.equal(a.calibrando, false);
  assert.ok(a.total >= 75, `normal ${a.total}`);
  assert.ok(b.total < 60, `malo ${b.total}`);
  assert.ok(b.total < a.total);
});

test("actividad", () => {
  const dias = serie();
  const ult = dias.at(-1).fecha;
  const a = P.actividad(P.indice(dias), ult);
  assert.ok(a.total >= 80, `activo ${a.total}`);
  const quieto = serie(40, (i) => (i >= 33 ? { pasos: 1500, azm: 0 } : {}));
  assert.ok(P.actividad(P.indice(quieto), ult).total < 30);
});

test("calcular recorre todos los días", () => {
  const out = P.calcular(serie(10));
  assert.equal(out.length, 10);
  assert.ok(out[9].sueno.total > 0);
  assert.equal(P.banda(90).key, "optima");
  assert.equal(P.banda(72).key, "buena");
  assert.equal(P.banda(50).key, "atencion");
});
