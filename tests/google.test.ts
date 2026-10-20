import test from "node:test";
import assert from "node:assert/strict";
import { DIARIOS, Dias, fechaLocal, filtroDiario, fusionar, leerAzm, leerDiario, leerPasos, leerSueno } from "../supabase/functions/fitbit-sync/google.ts";

test("pasos desde dailyRollUp (countSum en string)", () => {
  const d = new Dias();
  leerPasos(d, [{ civilStartTime: { date: { year: 2026, month: 3, day: 4 } }, civilEndTime: {}, steps: { countSum: "3822" } }]);
  assert.equal(d.lista()[0].pasos, 3822);
  assert.equal(d.lista()[0].fecha, "2026-03-04");
});

test("tipos diarios", () => {
  const d = new Dias();
  const def = (t: string) => DIARIOS.find((x) => x.tipo === t)!;
  leerDiario(d, [{ dailyRestingHeartRate: { date: { year: 2026, month: 10, day: 1 }, beatsPerMinute: "58" } }], def("daily-resting-heart-rate"));
  leerDiario(d, [{ dailyHeartRateVariability: { date: { year: 2026, month: 10, day: 1 }, deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 41.5 } }], def("daily-heart-rate-variability"));
  leerDiario(d, [{ dailySleepTemperatureDerivations: { date: { year: 2026, month: 10, day: 1 }, nightlyTemperatureCelsius: 34.1, baselineTemperatureCelsius: 33.9 } }], def("daily-sleep-temperature-derivations"));
  const [dia] = d.lista();
  assert.equal(dia.fc_reposo, 58);
  assert.equal(dia.vfc, 41.5);
  assert.equal(dia.temp, 34.1);
  assert.equal(dia.temp_base, 33.9);
  assert.ok(dia.crudo.dailyRestingHeartRate);
});

test("filtro de tipo diario en snake_case", () => {
  assert.equal(filtroDiario("daily-resting-heart-rate", "2026-10-01", "2026-10-21"), 'daily_resting_heart_rate.date >= "2026-10-01" AND daily_resting_heart_rate.date < "2026-10-21"');
});

test("minutos en zona se suman por día local", () => {
  const d = new Dias();
  const p = (h: string, n: string) => ({ activeZoneMinutes: { interval: { startTime: `2026-10-02T${h}:00Z`, startUtcOffset: "-21600s" }, heartRateZone: "CARDIO", activeZoneMinutes: n } });
  leerAzm(d, [p("03:00", "2"), p("15:00", "2"), p("15:01", "1")]);
  assert.deepEqual(d.lista().map((x) => [x.fecha, x.azm]), [["2026-10-01", 2], ["2026-10-02", 3]]);
});

test("sueño: fecha local de despertar y noche principal", () => {
  assert.equal(fechaLocal("2026-03-04T04:41:30Z", "-21600s"), "2026-03-03");
  const d = new Dias();
  const siesta = { sleep: { interval: { startTime: "2026-03-04T19:00:00Z", endTime: "2026-03-04T19:40:00Z", endUtcOffset: "0s" }, metadata: { main: false }, summary: { minutesAsleep: "38" } } };
  const noche = { sleep: { interval: { startTime: "2026-03-03T22:57:30Z", endTime: "2026-03-04T06:41:30Z", endUtcOffset: "0s" }, type: "STAGES", metadata: { main: true },
    summary: { minutesInSleepPeriod: "464", minutesToFallAsleep: "0", minutesAsleep: "407", minutesAwake: "57",
      stagesSummary: [{ type: "AWAKE", minutes: "56", count: "12" }, { type: "LIGHT", minutes: "198", count: "19" }, { type: "DEEP", minutes: "114", count: "10" }, { type: "REM", minutes: "94", count: "4" }] },
    stages: [{ type: "AWAKE", startTime: "2026-03-03T22:57:30Z", endTime: "2026-03-03T22:59:30Z" }] } };
  leerSueno(d, [siesta, noche]);
  const s = d.lista()[0].sueno!;
  assert.equal(d.lista().length, 1);
  assert.equal(s.dormido, 407);
  assert.equal(s.etapas.DEEP, 114);
  assert.equal(s.despertares, 12);
  assert.equal(s.hipnograma.length, 1);
});

test("fusionar no borra lo que no llegó", () => {
  const out = fusionar({ fecha: "2026-10-01", pasos: 9000, vfc: 40, crudo: { a: 1 } }, { fecha: "2026-10-01", vfc: 45, crudo: { b: 2 } });
  assert.equal(out.pasos, 9000);
  assert.equal(out.vfc, 45);
  assert.deepEqual(out.crudo, { a: 1, b: 2 });
});
