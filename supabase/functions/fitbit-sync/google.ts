// Lectura de la Google Health API v4 (https://developers.google.com/health) y conversión a un renglón por día.
// Sin dependencias de Deno para poder probarlo con Node (`node --test`).

export const API = "https://health.googleapis.com/v4/users/me";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPES = ["sleep.readonly", "activity_and_fitness.readonly", "health_metrics_and_measurements.readonly"]
  .map((s) => `https://www.googleapis.com/auth/googlehealth.${s}`);

export type Sueno = {
  inicio: string; fin: string; offset: number;
  enCama: number | null; dormido: number | null; despierto: number | null; latencia: number | null;
  etapas: Record<string, number>; despertares: number | null; tipo: string;
  hipnograma: [string, string, string][];
};
export type Dia = {
  fecha: string; pasos?: number; azm?: number; fc_reposo?: number; vfc?: number; spo2?: number; resp?: number;
  temp?: number; temp_base?: number; sueno?: Sueno; crudo: Record<string, unknown>;
};
// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

const pad = (n: number) => String(n).padStart(2, "0");
// Los int64 vienen como string ("count": "40")
export const num = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
export const fechaDe = (d?: Obj) => (d && d.year ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : "");
// Duraciones protobuf: "-21600s"
export const segundos = (dur?: string) => (dur ? Number(String(dur).replace(/s$/, "")) || 0 : 0);
export const fechaLocal = (iso: string, offset?: string) => new Date(Date.parse(iso) + segundos(offset) * 1000).toISOString().slice(0, 10);
export const sumarDias = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const civil = (iso: string) => { const [year, month, day] = iso.split("-").map(Number); return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }; };

// Tipos diarios: tipo en la URL (kebab), llave del payload, nombre para filtros (snake) y cómo sacar los valores
export const DIARIOS: { tipo: string; llave: string; leer: (o: Obj) => Partial<Dia> }[] = [
  { tipo: "daily-resting-heart-rate", llave: "dailyRestingHeartRate", leer: (o) => ({ fc_reposo: num(o.beatsPerMinute) }) },
  { tipo: "daily-heart-rate-variability", llave: "dailyHeartRateVariability", leer: (o) => ({ vfc: num(o.averageHeartRateVariabilityMilliseconds) ?? num(o.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds) }) },
  { tipo: "daily-oxygen-saturation", llave: "dailyOxygenSaturation", leer: (o) => ({ spo2: num(o.averagePercentage) }) },
  { tipo: "daily-respiratory-rate", llave: "dailyRespiratoryRate", leer: (o) => ({ resp: num(o.breathsPerMinute) }) },
  { tipo: "daily-sleep-temperature-derivations", llave: "dailySleepTemperatureDerivations", leer: (o) => ({ temp: num(o.nightlyTemperatureCelsius), temp_base: num(o.baselineTemperatureCelsius) }) },
];
export const snake = (tipo: string) => tipo.replaceAll("-", "_");
export const filtroDiario = (tipo: string, desde: string, hasta: string) => `${snake(tipo)}.date >= "${desde}" AND ${snake(tipo)}.date < "${hasta}"`;

export class Dias {
  m = new Map<string, Dia>();
  de(fecha: string) { let d = this.m.get(fecha); if (!d) { d = { fecha, crudo: {} }; this.m.set(fecha, d); } return d; }
  poner(fecha: string, valores: Partial<Dia>) {
    if (!fecha) return;
    const d = this.de(fecha);
    for (const [k, v] of Object.entries(valores)) if (v !== undefined) (d as Obj)[k] = v;
  }
  lista() { return [...this.m.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)); }
}

export function leerDiario(dias: Dias, puntos: Obj[], def: (typeof DIARIOS)[number]) {
  for (const p of puntos) {
    const o = p[def.llave]; if (!o) continue;
    const fecha = fechaDe(o.date);
    dias.poner(fecha, def.leer(o));
    if (fecha) dias.de(fecha).crudo[def.llave] = o;
  }
}

// dailyRollUp de steps: { civilStartTime: { date }, steps: { countSum: "3822" } }
export function leerPasos(dias: Dias, rollups: Obj[]) {
  for (const r of rollups) {
    const n = num(r.steps?.countSum);
    if (n !== undefined) dias.poner(fechaDe(r.civilStartTime?.date), { pasos: n });
  }
}

// active-zone-minutes llega por intervalos (un punto por minuto en zona); se suma por día local
export function leerAzm(dias: Dias, puntos: Obj[]) {
  const tot = new Map<string, number>();
  for (const p of puntos) {
    const o = p.activeZoneMinutes; if (!o) continue;
    const i = o.interval || {};
    const fecha = fechaDe(i.civilStartTime?.date) || (i.startTime ? fechaLocal(i.startTime, i.startUtcOffset) : "");
    if (fecha) tot.set(fecha, (tot.get(fecha) || 0) + (num(o.activeZoneMinutes) || 0));
  }
  for (const [fecha, azm] of tot) dias.poner(fecha, { azm });
}

export function resumirSueno(s: Obj): Sueno {
  const i = s.interval || {};
  const sum = s.summary || {};
  const stages: Obj[] = s.stages || [];
  const etapas: Record<string, number> = {};
  let despertares: number | null = null;
  if (Array.isArray(sum.stagesSummary) && sum.stagesSummary.length) {
    for (const e of sum.stagesSummary) {
      etapas[e.type] = num(e.minutes) || 0;
      if (e.type === "AWAKE") despertares = num(e.count) ?? null;
    }
  } else {
    for (const e of stages) etapas[e.type] = (etapas[e.type] || 0) + (Date.parse(e.endTime) - Date.parse(e.startTime)) / 60000;
    despertares = stages.filter((e) => e.type === "AWAKE").length || null;
  }
  return {
    inicio: i.startTime, fin: i.endTime, offset: segundos(i.endUtcOffset),
    enCama: num(sum.minutesInSleepPeriod) ?? null, dormido: num(sum.minutesAsleep) ?? null,
    despierto: num(sum.minutesAwake) ?? null, latencia: num(sum.minutesToFallAsleep) ?? null,
    etapas, despertares, tipo: s.type || "",
    hipnograma: stages.map((e) => [e.type, e.startTime, e.endTime]),
  };
}

// Una noche por día (el día en que despiertas): la principal, o la más larga si no viene marcada
export function leerSueno(dias: Dias, puntos: Obj[]) {
  const elegido = new Map<string, Obj>();
  const largo = (s: Obj) => Date.parse(s.interval?.endTime) - Date.parse(s.interval?.startTime);
  for (const p of puntos) {
    const s = p.sleep; if (!s?.interval?.endTime) continue;
    const fecha = fechaLocal(s.interval.endTime, s.interval.endUtcOffset);
    const prev = elegido.get(fecha);
    const principal = (x: Obj) => x.metadata?.main === true;
    if (!prev || (principal(s) && !principal(prev)) || (principal(s) === principal(prev) && largo(s) > largo(prev))) elegido.set(fecha, s);
  }
  for (const [fecha, s] of elegido) {
    dias.poner(fecha, { sueno: resumirSueno(s) });
    dias.de(fecha).crudo.sleep = { summary: s.summary, metadata: s.metadata, type: s.type };
  }
}

// heart-rate (Sample): { sampleTime: { physicalTime }, beatsPerMinute: "72" } → último dato y promedio por minuto
export function resumirFc(puntos: Obj[]) {
  const porMin = new Map<number, number[]>();
  let ultimo: { t: string; lpm: number } | null = null;
  for (const p of puntos) {
    const t = p.heartRate?.sampleTime?.physicalTime, lpm = num(p.heartRate?.beatsPerMinute);
    if (!t || lpm === undefined) continue;
    const ms = Date.parse(t), m = Math.floor(ms / 60000) * 60000;
    if (!porMin.has(m)) porMin.set(m, []);
    porMin.get(m)!.push(lpm);
    if (!ultimo || ms > Date.parse(ultimo.t)) ultimo = { t, lpm };
  }
  const serie = [...porMin.entries()].sort((a, b) => a[0] - b[0])
    .map(([m, xs]) => ({ t: new Date(m).toISOString(), lpm: Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) }));
  return { ultimo, serie };
}

// Sesión de medición: muestras de pulso (y VFC si el reloj la registró) entre inicio y fin.
// `completa` indica si el Fitbit ya sincronizó hasta el final de la sesión.
export function resumirSesion(fcs: Obj[], vfcs: Obj[], inicio: string, fin: string) {
  const a = Date.parse(inicio), b = Date.parse(fin);
  let ultima = 0;
  const dentro: { ms: number; lpm: number }[] = [];
  for (const p of fcs) {
    const ms = Date.parse(p.heartRate?.sampleTime?.physicalTime), lpm = num(p.heartRate?.beatsPerMinute);
    if (!ms || lpm === undefined) continue;
    ultima = Math.max(ultima, ms);
    if (ms >= a && ms < b) dentro.push({ ms, lpm });
  }
  dentro.sort((x, y) => x.ms - y.ms);
  const lpms = dentro.map((d) => d.lpm);
  const rmssd = vfcs.map((p) => ({ ms: Date.parse(p.heartRateVariability?.sampleTime?.physicalTime), v: num(p.heartRateVariability?.rootMeanSquareOfSuccessiveDifferencesMilliseconds) }))
    .filter((x) => x.ms >= a && x.ms < b && x.v !== undefined).map((x) => x.v as number);
  // Serie en bloques de 15 s para la gráfica
  const bloques = new Map<number, number[]>();
  for (const d of dentro) { const k = Math.floor((d.ms - a) / 15000); if (!bloques.has(k)) bloques.set(k, []); bloques.get(k)!.push(d.lpm); }
  const prom = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return {
    muestras: dentro.length,
    fc: lpms.length ? Math.round(prom(lpms)) : null,
    fcMin: lpms.length ? Math.min(...lpms) : null,
    fcMax: lpms.length ? Math.max(...lpms) : null,
    vfc: rmssd.length ? Math.round(prom(rmssd)) : null,
    serie: [...bloques.entries()].sort((x, y) => x[0] - y[0]).map(([k, xs]) => ({ t: new Date(a + k * 15000).toISOString(), lpm: Math.round(prom(xs)) })),
    ultimaMuestra: ultima ? new Date(ultima).toISOString() : null,
    completa: ultima >= b - 30000,
  };
}

// Fusiona lo nuevo sobre lo que ya estaba guardado: un tipo que falló no borra el valor anterior
export function fusionar(viejo: Obj | undefined, nuevo: Dia): Obj {
  const out: Obj = { ...(viejo || {}) };
  for (const [k, v] of Object.entries(nuevo)) if (k !== "crudo" && v !== undefined) out[k] = v;
  out.crudo = { ...(viejo?.crudo || {}), ...nuevo.crudo };
  return out;
}
