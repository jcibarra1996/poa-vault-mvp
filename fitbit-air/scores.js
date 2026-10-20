// Puntuaciones estilo Oura (Recuperación, Sueño, Actividad) a partir de las métricas diarias del Fitbit Air.
// No son los algoritmos de Oura ni de Google: comparan cada métrica contra tu propia línea base de 30 días.
(function (root) {
  const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
  const media = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const desv = (xs) => { const m = media(xs); return Math.sqrt(media(xs.map((x) => (x - m) ** 2))); };
  const sumarDias = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const val = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

  const MIN_BASE = 7; // días mínimos para tener línea base
  // Piso de desviación estándar: evita que una métrica muy estable dispare la puntuación por variaciones mínimas
  const PISO = { fc_reposo: 1.5, vfc: 3, resp: 0.3, temp: 0.15, pasos: 800 };

  // z-score → 0-100: en tu promedio = 80, +1 desviación = 95, −1 = 58, −2 = 36
  const desdeZ = (z) => clamp(80 + (z >= 0 ? 15 : 22) * z);

  function indice(dias) { const m = new Map(); for (const d of dias) m.set(d.fecha, d); return m; }

  // Valores de `campo` en los `n` días anteriores a `fecha` (sin incluirla)
  function ventana(idx, fecha, campo, n, incluir = false) {
    const out = [];
    for (let i = incluir ? 0 : 1; i <= (incluir ? n - 1 : n); i++) {
      const d = idx.get(sumarDias(fecha, -i));
      const v = d ? (typeof campo === "function" ? campo(d) : val(d[campo])) : null;
      if (v != null) out.push(v);
    }
    return out;
  }

  function lineaBase(idx, fecha, campo, n = 30) {
    const xs = ventana(idx, fecha, campo, n);
    if (xs.length < MIN_BASE) return null;
    return { media: media(xs), sd: Math.max(desv(xs), PISO[campo] || 0.0001), n: xs.length };
  }

  function combinar(contribuyentes) {
    const ok = contribuyentes.filter((c) => c.pts != null);
    if (ok.length < 2) return { total: null, contribuyentes };
    const peso = ok.reduce((s, c) => s + c.peso, 0);
    return { total: Math.round(ok.reduce((s, c) => s + c.pts * c.peso, 0) / peso), contribuyentes };
  }

  const r = (x) => (x == null ? null : Math.round(x));
  const hm = (min) => (min == null ? "—" : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min`);

  // ---------- Sueño (una noche) ----------
  function sueno(s) {
    if (!s || s.dormido == null) return { total: null, contribuyentes: [] };
    const et = s.etapas || {};
    const conEtapas = et.DEEP != null || et.REM != null;
    const efic = s.enCama ? s.dormido / s.enCama : null;
    // Punto medio de la noche en hora local, en el rango −12..12 alrededor de medianoche
    let medio = null;
    if (s.inicio && s.fin) {
      const mid = (Date.parse(s.inicio) + Date.parse(s.fin)) / 2 + (s.offset || 0) * 1000;
      const d = new Date(mid);
      medio = ((d.getUTCHours() + d.getUTCMinutes() / 60 + 12) % 24) - 12;
    }
    const total = s.dormido < 240 ? 0 : s.dormido <= 420 ? ((s.dormido - 240) / 180) * 100 : s.dormido <= 540 ? 100 : 100 - (s.dormido - 540) / 3;
    return combinar([
      { key: "total", label: "Sueño total", peso: 0.35, pts: r(clamp(total)), valor: hm(s.dormido) },
      { key: "eficiencia", label: "Eficiencia", peso: 0.1, pts: efic == null ? null : r(clamp(((efic - 0.7) / 0.22) * 100)), valor: efic == null ? "—" : `${Math.round(efic * 100)}%` },
      { key: "latencia", label: "Latencia", peso: 0.1, pts: s.latencia == null ? null : r(s.latencia <= 20 ? 100 : clamp(100 - (s.latencia - 20) * 1.5)), valor: s.latencia == null ? "—" : `${s.latencia} min` },
      { key: "profundo", label: "Sueño profundo", peso: 0.15, pts: conEtapas ? r(clamp(((et.DEEP || 0) / 90) * 100)) : null, valor: conEtapas ? hm(et.DEEP || 0) : "—" },
      { key: "rem", label: "Sueño REM", peso: 0.15, pts: conEtapas ? r(clamp(((et.REM || 0) / 90) * 100)) : null, valor: conEtapas ? hm(et.REM || 0) : "—" },
      { key: "inquietud", label: "Inquietud", peso: 0.05, pts: s.despertares == null ? null : r(clamp(100 - Math.max(0, s.despertares - 5) * 5)), valor: s.despertares == null ? "—" : `${s.despertares} despertares` },
      { key: "horario", label: "Horario", peso: 0.1, pts: medio == null ? null : r(clamp(100 - 20 * (medio < 0 ? -medio : Math.max(0, medio - 3.5)))), valor: medio == null ? "—" : `punto medio ${String(Math.floor((medio + 24) % 24)).padStart(2, "0")}:${String(Math.round(((medio + 24) % 1) * 60) % 60).padStart(2, "0")}` },
    ]);
  }

  // ---------- Recuperación ----------
  function recuperacion(idx, fecha) {
    const d = idx.get(fecha) || {};
    const contrib = [];
    const bVfc = lineaBase(idx, sumarDias(fecha, -2), "vfc");
    const vfcReciente = ventana(idx, fecha, "vfc", 3, true);
    contrib.push({ key: "vfc", label: "Balance de VFC", peso: 0.25,
      pts: bVfc && vfcReciente.length ? r(desdeZ((media(vfcReciente) - bVfc.media) / bVfc.sd)) : null,
      valor: vfcReciente.length ? `${Math.round(media(vfcReciente))} ms${bVfc ? ` · base ${Math.round(bVfc.media)}` : ""}` : "—" });
    const bFc = lineaBase(idx, fecha, "fc_reposo"), fc = val(d.fc_reposo);
    contrib.push({ key: "fc", label: "FC en reposo", peso: 0.2, pts: bFc && fc != null ? r(desdeZ(-(fc - bFc.media) / bFc.sd)) : null,
      valor: fc == null ? "—" : `${fc} lpm${bFc ? ` · base ${Math.round(bFc.media)}` : ""}` });
    const s = sueno(d.sueno);
    contrib.push({ key: "noche", label: "Noche anterior", peso: 0.2, pts: s.total, valor: s.total == null ? "—" : `${s.total} pts` });
    const noches = ventana(idx, fecha, (x) => val(x.sueno?.dormido), 14, true);
    contrib.push({ key: "balance", label: "Balance de sueño (14 d)", peso: 0.15, pts: noches.length >= 3 ? r(clamp((media(noches) / 450) * 100)) : null,
      valor: noches.length ? `${hm(media(noches))} promedio` : "—" });
    const temp = val(d.temp), bTemp = val(d.temp_base) ?? lineaBase(idx, fecha, "temp")?.media ?? null;
    const dt = temp != null && bTemp != null ? temp - bTemp : null;
    contrib.push({ key: "temp", label: "Temperatura corporal", peso: 0.1, pts: dt == null ? null : r(clamp(100 - Math.max(0, Math.abs(dt) - 0.2) * 80)),
      valor: dt == null ? "—" : `${dt >= 0 ? "+" : "−"}${Math.abs(dt).toFixed(1)} °C` });
    const bResp = lineaBase(idx, fecha, "resp"), resp = val(d.resp);
    contrib.push({ key: "resp", label: "Respiración", peso: 0.1, pts: bResp && resp != null ? r(clamp(100 - 25 * Math.max(0, Math.abs((resp - bResp.media) / bResp.sd) - 0.5))) : null,
      valor: resp == null ? "—" : `${resp.toFixed(1)} rpm` });
    const out = combinar(contrib);
    out.calibrando = !bVfc && !bFc;
    return out;
  }

  // ---------- Actividad ----------
  function actividad(idx, fecha, metas = { pasos: 8000, azmSemana: 150 }) {
    const d = idx.get(fecha) || {};
    const pasos = val(d.pasos);
    const azm7 = ventana(idx, fecha, "azm", 7, true);
    const pasos7 = ventana(idx, fecha, "pasos", 7, true);
    const bPasos = lineaBase(idx, sumarDias(fecha, -6), "pasos");
    const diasEntreno = azm7.filter((x) => x >= 20).length;
    const ratio = bPasos && pasos7.length ? media(pasos7) / bPasos.media : null;
    return combinar([
      { key: "pasos", label: "Meta de pasos", peso: 0.35, pts: pasos == null ? null : r(clamp((pasos / metas.pasos) * 100)), valor: pasos == null ? "—" : `${pasos.toLocaleString("es-MX")} de ${metas.pasos.toLocaleString("es-MX")}` },
      { key: "azm", label: "Minutos en zona (7 d)", peso: 0.25, pts: azm7.length ? r(clamp((azm7.reduce((s, x) => s + x, 0) / metas.azmSemana) * 100)) : null, valor: azm7.length ? `${azm7.reduce((s, x) => s + x, 0)} de ${metas.azmSemana}` : "—" },
      { key: "frecuencia", label: "Frecuencia de entrenamiento", peso: 0.2, pts: azm7.length ? r(clamp((diasEntreno / 3) * 100)) : null, valor: azm7.length ? `${diasEntreno} días con 20+ min` : "—" },
      { key: "balance", label: "Balance de actividad", peso: 0.2, pts: ratio == null ? null : r(ratio >= 1 ? 100 : clamp(100 - (1 - ratio) * 150)), valor: ratio == null ? "—" : `${Math.round(ratio * 100)}% de tu promedio` },
    ]);
  }

  const banda = (x) => (x == null ? null : x >= 85 ? { key: "optima", label: "Óptima" } : x >= 70 ? { key: "buena", label: "Buena" } : { key: "atencion", label: "Atención" });

  function calcular(dias) {
    const idx = indice(dias);
    return dias.map((d) => ({ fecha: d.fecha, recuperacion: recuperacion(idx, d.fecha), sueno: sueno(d.sueno), actividad: actividad(idx, d.fecha) }));
  }

  const api = { calcular, sueno, recuperacion, actividad, indice, banda, desdeZ, sumarDias, hm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Puntuaciones = api;
})(typeof window !== "undefined" ? window : globalThis);
