(() => {
  const P = window.Puntuaciones;
  const state = { dias: [], puntos: new Map(), fecha: "", tab: "hoy", rango: 30, conexion: null, cargado: false, ocupado: false, mediciones: [], fcReciente: null, puntaje: "recuperacion" };
  try { const t = localStorage.getItem("salud-tab"); if (t) state.tab = t; const pz = localStorage.getItem("salud-puntaje"); if (pz) state.puntaje = pz; const r = Number(localStorage.getItem("salud-rango")); if (r) state.rango = r; } catch (e) {}

  // ---------- Utilidades ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3200); };
  const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const fechaLarga = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const fechaCorta = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
  const horaLocal = (ms, offset) => { const d = new Date(ms + offset * 1000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
  const fmtNum = (v, dec = 0) => (v == null ? "—" : Number(v).toLocaleString("es-MX", { maximumFractionDigits: dec, minimumFractionDigits: dec }));
  const tempDelta = (d) => { const t = num(d?.temp), b = num(d?.temp_base); return t != null && b != null ? t - b : null; };
  const signo = (x, dec = 1) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`);
  const media = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  // ---------- Supabase ----------
  const sb = window.supabase.createClient(window.IQ_CONFIG.supabaseUrl, window.IQ_CONFIG.supabaseKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } });

  async function funcion(body) {
    const { data, error } = await sb.functions.invoke("fitbit-sync", { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    return data;
  }

  async function cargarDatos() {
    const { data, error } = await sb.from("salud_dias").select("fecha,pasos,azm,fc_reposo,vfc,spo2,resp,temp,temp_base,sueno,spo2_noche").order("fecha");
    if (error) throw error;
    state.dias = data || [];
    state.puntos = new Map(P.calcular(state.dias).map((p) => [p.fecha, p]));
    if (!state.fecha || !state.dias.some((d) => d.fecha === state.fecha)) state.fecha = state.dias.at(-1)?.fecha || hoyISO();
  }

  async function cargar() {
    try {
      const [estado] = await Promise.all([funcion({ accion: "estado" }).catch((e) => ({ conectado: false, error: e.message, sinFuncion: true })), cargarDatos(), cargarMediciones()]);
      state.conexion = estado;
    } catch (e) {
      banner("No se pudieron cargar los datos: " + e.message, true);
    }
    state.cargado = true;
    render();
    retomarSesion();
    const ult = state.conexion?.ultimaSync ? Date.parse(state.conexion.ultimaSync) : 0;
    if (state.conexion?.conectado && Date.now() - ult > 2 * 3600 * 1000) sincronizar(state.dias.length ? 7 : 45, true);
  }

  async function sincronizar(dias = 7, silencioso = false) {
    if (state.ocupado) return;
    state.ocupado = true; renderEstado();
    try {
      const r = await funcion({ accion: "sincronizar", dias });
      await cargarDatos();
      state.conexion = { ...state.conexion, ultimaSync: new Date().toISOString(), error: r.errores?.join(" · ") || "" };
      if (!silencioso) toast(`Sincronizado: ${r.dias} días`);
    } catch (e) {
      state.conexion = { ...state.conexion, error: e.message };
      if (!silencioso) toast("No se pudo sincronizar");
    }
    state.ocupado = false;
    render();
  }

  // ---------- Render ----------
  function banner(texto, err = false) { const b = $("#banner"); b.hidden = !texto; b.textContent = texto || ""; b.classList.toggle("err", err); }

  function renderEstado() {
    const c = state.conexion;
    $("#btnSync").hidden = !c?.conectado; $("#btnDesc").hidden = !c?.conectado;
    $("#btnSync").disabled = state.ocupado; $("#btnSync").classList.toggle("girando", state.ocupado);
    $("#conectar").hidden = !state.cargado || !!c?.conectado;
    const sync = c?.ultimaSync ? `Sincronizado ${new Date(c.ultimaSync).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "";
    $("#status").textContent = state.ocupado ? "Sincronizando…" : sync; $("#statusMenu").textContent = sync || "Sin sincronizar";
    $("#btnConectar").disabled = !!c?.faltaConfig?.length;
    if (c?.sinFuncion) banner("La función fitbit-sync no responde. Revisa que esté desplegada (ver README).", true);
    else if (c?.faltaConfig?.length && !c.conectado) banner(`Falta dar de alta el cliente de Google en Supabase (${c.faltaConfig.join(", ")}). Ver README.`, true);
    else if (c?.error) banner(c.error, true);
  }

  function render() {
    renderEstado();
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
    const v = $("#view");
    if (!state.cargado) { v.innerHTML = `<div class="empty">Cargando…</div>`; return; }
    if (state.tab === "medir") {
      v.innerHTML = vistaMedir();
      if (state.conexion?.conectado && state.fcReciente === null) { state.fcReciente = undefined; actualizarFcReciente(); }
      return;
    }
    if (!state.dias.length) { v.innerHTML = `<div class="empty">${state.conexion?.conectado ? "Todavía no hay datos. Sincroniza tu Fitbit Air con la app Google Health y luego presiona Sincronizar." : "Conecta tu cuenta para ver tus datos."}</div>`; return; }
    v.innerHTML = state.tab === "tendencias" ? vistaTendencias() : state.tab === "tabla" ? vistaTabla() : vistaDia();
  }

  const NOMBRES = { recuperacion: "Recuperación", sueno: "Sueño", actividad: "Actividad" };
  const PALABRA = { optima: "Óptimo", buena: "Bueno", atencion: "Atención" };

  function anillo(total) {
    const r = 50, C = 2 * Math.PI * r;
    const off = total == null ? C : C * (1 - total / 100);
    return `<svg class="ring" viewBox="0 0 120 120" role="img" aria-label="${total == null ? "Sin puntuación" : `${total} de 100`}">
      <circle class="bg" cx="60" cy="60" r="${r}" fill="none" stroke-width="9"/>
      <circle class="fg" cx="60" cy="60" r="${r}" fill="none" stroke="url(#gradAnillo)" stroke-width="9" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"/>
      <text x="60" y="71" text-anchor="middle">${total ?? "—"}</text></svg>`;
  }

  // Una frase que explica la puntuación: el factor más bajo si preocupa, o el que más ayuda
  function insight(key, p) {
    if (!p || p.total == null) return key === "recuperacion" && p?.calibrando ? "Calibrando: con 7 días de datos empiezo a comparar contra tu línea base." : "Todavía no hay datos suficientes para este día.";
    const ok = p.contribuyentes.filter((c) => c.pts != null).sort((a, b) => a.pts - b.pts);
    const peor = ok[0], mejor = ok[ok.length - 1];
    if (peor && peor.pts < 70) return `Presta atención a ${peor.label.toLowerCase()} (${peor.valor}); es lo que más baja tu ${NOMBRES[key].toLowerCase()}.`;
    return mejor ? `Vas bien. Lo que más te ayuda hoy: ${mejor.label.toLowerCase()} (${mejor.valor}).` : "";
  }

  function tile(label, valor, delta) { return `<div class="tile"><span class="lbl">${label}</span><span class="val">${valor}</span>${delta ? `<span class="delta">${delta}</span>` : ""}</div>`; }
  const conUnidad = (v, u) => (v == null || v === "—" ? "—" : `${v}<small>${u}</small>`);
  const horasMin = (min) => (min == null ? "—" : `${Math.floor(min / 60)}<small>h</small> ${String(Math.round(min % 60)).padStart(2, "0")}<small>min</small>`);

  function vistaDia() {
    const d = state.dias.find((x) => x.fecha === state.fecha) || { fecha: state.fecha };
    const p = state.puntos.get(state.fecha);
    const i = state.dias.findIndex((x) => x.fecha === state.fecha);
    const previos = state.dias.slice(Math.max(0, i - 30), i);
    const base = (k) => media(previos.map((x) => num(x[k])).filter((x) => x != null));
    const vsBase = (k, dec, u) => { const b = base(k), v = num(d[k]); return b == null || v == null ? "" : `${signo(v - b, dec)} ${u} vs. tu promedio`; };
    const sel = state.puntaje || "recuperacion";
    const ps = p?.[sel];
    const esHoy = state.fecha === hoyISO();
    const [dia, ...resto] = fechaLarga(state.fecha).split(", ");
    const s = d.sueno;
    return `<div class="dia">
      <div class="daynav">
        <button class="nav" data-dia="-1" ${i <= 0 ? "disabled" : ""} aria-label="Día anterior">‹</button>
        <div class="fecha"><span class="eyebrow">${esHoy ? "Hoy" : esc(dia)}</span><h1>${esc(resto.join(", ") || dia)}</h1></div>
        ${i < state.dias.length - 1 ? `<button class="btn sm" data-dia="ultimo">Hoy</button>` : ""}
        <button class="nav" data-dia="1" ${i < 0 || i >= state.dias.length - 1 ? "disabled" : ""} aria-label="Día siguiente">›</button>
      </div>
      <div class="anillos">${Object.keys(NOMBRES).map((k) => {
        const sc = p?.[k], b = P.banda(sc?.total);
        return `<button class="anillo-btn" data-puntaje="${k}" aria-pressed="${k === sel}">${anillo(sc?.total ?? null)}
          <span class="nombre">${NOMBRES[k]}</span><span class="estado est ${b?.key || "nd"}">${b ? PALABRA[b.key] : k === "recuperacion" && sc?.calibrando ? "Calibrando" : "Sin datos"}</span></button>`;
      }).join("")}</div>
      <section class="box detalle">
        <h2>${NOMBRES[sel]}</h2>
        <p class="insight">${esc(insight(sel, ps))}</p>
        <div class="contribs">${(ps?.contribuyentes || []).map((c) => {
          const b = P.banda(c.pts);
          return `<div class="contrib ${c.pts == null ? "na" : ""}"><span>${esc(c.label)}</span>
            <span class="der"><span class="v">${esc(c.valor)}</span>${b ? `<span class="est ${b.key}">${PALABRA[b.key]}</span>` : ""}</span>
            <span class="bar" role="img" aria-label="${c.pts == null ? "sin dato" : `${c.pts} de 100`}"><i class="${b?.key || ""}" style="width:${c.pts ?? 0}%"></i></span></div>`;
        }).join("")}</div>
      </section>
      <h2 class="seccion">Métricas</h2>
      <div class="tiles">
        ${tile("FC en reposo", conUnidad(fmtNum(d.fc_reposo), "lpm"), vsBase("fc_reposo", 0, "lpm"))}
        ${tile("VFC", conUnidad(fmtNum(d.vfc), "ms"), vsBase("vfc", 0, "ms"))}
        ${tile("SpO2", conUnidad(fmtNum(d.spo2, 1), "%"), vsBase("spo2", 1, "pts"))}
        ${tile("Respiración", conUnidad(fmtNum(d.resp, 1), "rpm"), vsBase("resp", 1, "rpm"))}
        ${tile("Temperatura", conUnidad(tempDelta(d) == null ? null : signo(tempDelta(d)), "°C"), tempDelta(d) != null ? "vs. tu línea base" : "")}
        ${tile("Sueño total", horasMin(s?.dormido ?? null), s?.enCama ? `${P.hm(s.enCama)} en cama` : "")}
        ${tile("Pasos", fmtNum(d.pasos), vsBase("pasos", 0, ""))}
        ${tile("Minutos en zona", fmtNum(d.azm), "")}
      </div>
      ${s?.hipnograma?.length || d.spo2_noche || d.spo2 != null ? `<h2 class="seccion">Noche</h2>` : ""}
      ${s?.hipnograma?.length ? hipnograma(s) : ""}
      ${oxigenoNoche(d)}
    </div>`;
  }

  const ETAPAS_FASES = [["AWAKE", "Despierto", "--awake"], ["REM", "REM", "--rem"], ["LIGHT", "Ligero", "--light"], ["DEEP", "Profundo", "--deep"]];
  // Registro clásico (sin fases): pasa cuando la noche se edita a mano o el reloj no logró calcular fases
  const ETAPAS_CLASICO = [["AWAKE", "Despierto", "--awake"], ["RESTLESS", "Inquieto", "--rem"], ["ASLEEP", "Dormido", "--light"]];
  function hipnograma(s) {
    const conFases = s.hipnograma.some(([k]) => ["DEEP", "REM", "LIGHT"].includes(k));
    const ETAPAS = conFases ? ETAPAS_FASES : ETAPAS_CLASICO;
    const W = 640, rowH = 32, gutter = 78, top = 6, H = top + rowH * ETAPAS.length + 26;
    const t0 = Date.parse(s.inicio), t1 = Date.parse(s.fin), span = Math.max(1, t1 - t0);
    const x = (ms) => gutter + ((ms - t0) / span) * (W - gutter - 24);
    const fila = Object.fromEntries(ETAPAS.map(([k], i) => [k, i]));
    const segs = s.hipnograma.filter(([k]) => k in fila).map(([k, a, b]) => {
      const x0 = x(Date.parse(a)), x1 = x(Date.parse(b)), et = ETAPAS[fila[k]];
      return `<rect x="${x0.toFixed(1)}" y="${top + fila[k] * rowH + 5}" width="${Math.max(1, x1 - x0 - 1).toFixed(1)}" height="${rowH - 10}" rx="4" fill="var(${et[2]})"><title>${et[1]} · ${horaLocal(Date.parse(a), s.offset)}–${horaLocal(Date.parse(b), s.offset)}</title></rect>`;
    }).join("");
    const horas = [];
    const primera = Math.ceil((t0 + s.offset * 1000) / 3600000) * 3600000 - s.offset * 1000;
    for (let t = primera; t < t1; t += 3600000) horas.push(t);
    const paso = horas.length > 8 ? 2 : 1;
    const ejes = horas.filter((_, i) => i % paso === 0).map((t) => `<line class="grid-svg" x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${top + rowH * ETAPAS.length}"/><text class="lbl-svg" x="${x(t)}" y="${H - 6}" text-anchor="middle">${horaLocal(t, s.offset)}</text>`).join("");
    const filas = ETAPAS.map(([, lbl], i) => `<text class="lbl-svg" x="0" y="${top + i * rowH + rowH / 2 + 5}">${lbl}</text>`).join("");
    const et = s.etapas || {};
    return `<section class="box hypno">
      <h3>${conFases ? "Etapas de sueño" : "Sueño"} · ${horaLocal(t0, s.offset)} a ${horaLocal(t1, s.offset)}${s.siesta ? " · siesta" : ""}</h3>
      ${!conFases ? `<p class="small muted">${s.editado ? "Esta noche se editó a mano en la app Google Health, así que Google ya no guarda sus fases (profundo, REM, ligero)." : "El Fitbit no calculó fases para esta noche; pasa si duermes menos de 3 h o el reloj está flojo."}</p>` : ""}
      <div class="scroll"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hipnograma de la noche">${ejes}${filas}${segs}</svg></div>
      <div class="legend">${ETAPAS.map(([k, lbl, c]) => `<span><i style="background:var(${c})"></i>${lbl} ${et[k] != null ? `· ${P.hm(et[k])}` : ""}</span>`).join("")}</div>
    </section>`;
  }

  // SpO2 de la noche: resumen y curva minuto a minuto con el umbral de 90%
  function oxigenoNoche(d) {
    const o = d.spo2_noche;
    if (!o) return d.spo2 != null ? `<section class="box oxi"><h3>Oxígeno en la sangre</h3><p class="muted">Promedio de la noche: <b>${fmtNum(d.spo2, 1)}%</b>. El detalle minuto a minuto aparece cuando el Fitbit lo registra durante el sueño.</p></section>` : "";
    const offset = d.sueno?.offset || 0, t0 = Date.parse(o.inicio);
    const puntos = o.valores.map((v, k) => ({ fecha: t0 + k * o.paso * 1000, v }));
    const lo = Math.min(88, Math.floor(o.minimo) - 1);
    return `<section class="box oxi">
      <h3>Oxígeno en la sangre</h3>
      <div class="stats">
        <div><b>${fmtNum(o.promedio, 1)}%</b><span>Promedio</span></div>
        <div><b>${fmtNum(o.minimo, 0)}%</b><span>Mínimo</span></div>
        <div><b>${fmtNum(o.bajo90)} min</b><span>Debajo de 90%</span></div>
        <div><b>${fmtNum(o.indice, 1)}</b><span>Caídas por hora</span></div>
      </div>
      ${grafica("oxi", "SpO2", puntos, { sinCaja: true, W: 640, H: 170, escala: [lo, 100], refs: [90], unidad: "%", fmt: (v) => fmtNum(v, v % 1 ? 1 : 0), fmtX: (ms) => horaLocal(ms, offset), marcar: (v) => v < 90 })}
      <p class="small muted">Caídas: bajadas de 3 puntos o más respecto a los 10 minutos previos. Lo normal es estar arriba de 95% y con menos de 5 caídas por hora; no es un diagnóstico.</p>
    </section>`;
  }

  // ---------- Tendencias ----------
  const series = {};
  function grafica(id, titulo, puntos, { fmt = (v) => fmtNum(v), fmtX = fechaCorta, escala = null, refs = [], banda = false, unidad = "", sinCaja = false, marcar = null, W = 360, H = 150 } = {}) {
    const L = 36, R = 8, T = 10, B = 22;
    const vals = puntos.map((p) => p.v).filter((v) => v != null);
    if (!vals.length) return `<section class="box chart"><h3>${titulo}</h3><div class="empty">Sin datos en este periodo</div></section>`;
    let [lo, hi] = escala || [Math.min(...vals), Math.max(...vals)];
    if (!escala) { const m = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1; lo -= m; hi += m; }
    const x = (i) => L + (puntos.length < 2 ? (W - L - R) / 2 : (i / (puntos.length - 1)) * (W - L - R));
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let d = "", abierto = false;
    puntos.forEach((p, i) => { if (p.v == null) { abierto = false; return; } d += `${abierto ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`; abierto = true; });
    const m = media(vals), sd = Math.sqrt(media(vals.map((v) => (v - m) ** 2)));
    // Marcas del eje redondeadas a 2 cifras significativas (0/50/100 en puntuaciones)
    const redondo = (v) => { const e = 10 ** (Math.floor(Math.log10(Math.max(1e-9, hi - lo))) - 1); return Math.round(v / e) * e; };
    const ticks = escala ? [lo, (lo + hi) / 2, hi] : [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1].map(redondo);
    const ultimo = [...puntos].reverse().find((p) => p.v != null);
    series[id] = { puntos, x, y, fmt, fmtX, W, H, unidad };
    // Marca puntos fuera de rango (p. ej. SpO2 < 90%) para que no se pierdan en la línea
    const marcas = marcar ? puntos.map((p, i) => (p.v != null && marcar(p.v) ? `<circle class="bajo" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5"/>` : "")).join("") : "";
    const cabeza = sinCaja ? "" : `<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><h3>${titulo}</h3>
        <span class="small muted">promedio ${fmt(m)}${unidad}</span></div>
      <div class="big">${fmt(ultimo.v)}${unidad} <span class="small muted">${fmtX(ultimo.fecha)}</span></div>`;
    return `<${sinCaja ? "div" : "section"} class="${sinCaja ? "" : "box "}chart" data-chart="${id}">
      ${cabeza}
      <div style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}: ${puntos.length} días, promedio ${fmt(m)}${unidad}">
        ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 5}" y="${y(t) + 3}" text-anchor="end">${fmt(t)}</text>`).join("")}
        ${banda && sd ? `<rect class="baseband" x="${L}" width="${W - L - R}" y="${y(Math.min(hi, m + sd))}" height="${Math.max(0, y(Math.max(lo, m - sd)) - y(Math.min(hi, m + sd)))}"><title>Tu rango habitual (promedio ± 1 desviación)</title></rect>` : ""}
        ${refs.filter((r) => r > lo && r < hi).map((r) => `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(r)}" y2="${y(r)}"/>`).join("")}
        <path class="line" d="${d}"/>${marcas}
        ${puntos.length > 1 ? [0, Math.floor((puntos.length - 1) / 2), puntos.length - 1].map((i) => `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === puntos.length - 1 ? "end" : "middle"}">${fmtX(puntos[i].fecha)}</text>`).join("") : ""}
        <line class="cross" y1="${T}" y2="${H - B}" visibility="hidden"/><circle class="dot" r="4.5" visibility="hidden"/>
        <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent" data-hover="${id}"/>
      </svg><div class="tip" hidden></div></div>
    </${sinCaja ? "div" : "section"}>`;
  }

  function vistaTendencias() {
    const fin = state.dias.at(-1).fecha;
    const fechas = Array.from({ length: state.rango }, (_, i) => P.sumarDias(fin, i - state.rango + 1));
    const idx = new Map(state.dias.map((d) => [d.fecha, d]));
    const serie = (f) => fechas.map((fecha) => ({ fecha, v: f(idx.get(fecha), state.puntos.get(fecha)) }));
    const score = { escala: [0, 100], refs: [70, 85] };
    return `<div style="display:grid;gap:12px">
      <div class="toolbar"><label class="small muted" for="selRango">Periodo</label>
        <select id="selRango" style="width:auto">${[14, 30, 90].map((n) => `<option value="${n}" ${state.rango === n ? "selected" : ""}>Últimos ${n} días</option>`).join("")}</select>
        <span class="small muted">Líneas punteadas: 70 (bueno) y 85 (óptimo). Franja azul: tu rango habitual.</span></div>
      <div class="charts">
        ${grafica("rec", "Recuperación", serie((d, p) => p?.recuperacion.total ?? null), score)}
        ${grafica("sue", "Sueño", serie((d, p) => p?.sueno.total ?? null), score)}
        ${grafica("act", "Actividad", serie((d, p) => p?.actividad.total ?? null), score)}
        ${grafica("vfc", "VFC", serie((d) => num(d?.vfc)), { banda: true, unidad: " ms" })}
        ${grafica("fc", "FC en reposo", serie((d) => num(d?.fc_reposo)), { banda: true, unidad: " lpm" })}
        ${grafica("hrs", "Sueño total", serie((d) => (d?.sueno?.dormido != null ? d.sueno.dormido / 60 : null)), { banda: true, fmt: (v) => fmtNum(v, 1), unidad: " h" })}
        ${grafica("tmp", "Temperatura vs. base", serie((d) => tempDelta(d)), { fmt: (v) => signo(v), unidad: " °C", refs: [0] })}
        ${grafica("spo", "SpO2 nocturna", serie((d) => num(d?.spo2)), { escala: [88, 100], refs: [90], banda: true, unidad: "%", fmt: (v) => fmtNum(v, v % 1 ? 1 : 0) })}
        ${grafica("cai", "Caídas de oxígeno por hora", serie((d) => num(d?.spo2_noche?.indice)), { refs: [5], unidad: "/h", fmt: (v) => fmtNum(v, 1) })}
        ${grafica("pas", "Pasos", serie((d) => num(d?.pasos)), { refs: [8000] })}
      </div></div>`;
  }

  function vistaTabla() {
    const filas = [...state.dias].reverse().map((d) => {
      const p = state.puntos.get(d.fecha) || {};
      return `<tr><td>${esc(fechaCorta(d.fecha))}</td><td class="num">${p.recuperacion?.total ?? "—"}</td><td class="num">${p.sueno?.total ?? "—"}</td><td class="num">${p.actividad?.total ?? "—"}</td>
        <td class="num">${d.sueno?.dormido != null ? P.hm(d.sueno.dormido) : "—"}</td><td class="num">${fmtNum(d.fc_reposo)}</td><td class="num">${fmtNum(d.vfc)}</td>
        <td class="num">${fmtNum(d.spo2, 1)}</td><td class="num">${fmtNum(d.spo2_noche?.minimo)}</td><td class="num">${fmtNum(d.resp, 1)}</td><td class="num">${signo(tempDelta(d))}</td><td class="num">${fmtNum(d.pasos)}</td><td class="num">${fmtNum(d.azm)}</td></tr>`;
    }).join("");
    return `<div class="toolbar" style="justify-content:space-between"><span class="small muted">${state.dias.length} días · se sincroniza solo a las 5:30 y 21:40</span><button class="btn" id="btnCsv">Descargar CSV</button></div>
      <div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th class="num">Recup.</th><th class="num">Sueño</th><th class="num">Activ.</th><th class="num">Dormido</th><th class="num">FC rep.</th><th class="num">VFC ms</th><th class="num">SpO2 %</th><th class="num">SpO2 mín.</th><th class="num">Resp.</th><th class="num">Temp Δ</th><th class="num">Pasos</th><th class="num">Min. zona</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  }

  // CSV con un renglón por día para analizar en Excel o Sheets (separador coma, punto decimal)
  function descargarCsv() {
    const cols = [
      ["fecha", (d) => d.fecha], ["recuperacion", (d, p) => p.recuperacion?.total], ["sueno_puntos", (d, p) => p.sueno?.total], ["actividad", (d, p) => p.actividad?.total],
      ["dormido_min", (d) => d.sueno?.dormido], ["en_cama_min", (d) => d.sueno?.enCama], ["profundo_min", (d) => d.sueno?.etapas?.DEEP], ["rem_min", (d) => d.sueno?.etapas?.REM],
      ["ligero_min", (d) => d.sueno?.etapas?.LIGHT], ["despierto_min", (d) => d.sueno?.etapas?.AWAKE], ["inicio_sueno", (d) => d.sueno?.inicio], ["fin_sueno", (d) => d.sueno?.fin],
      ["fc_reposo", (d) => d.fc_reposo], ["vfc_ms", (d) => d.vfc], ["spo2", (d) => d.spo2], ["spo2_min", (d) => d.spo2_noche?.minimo], ["spo2_bajo90_min", (d) => d.spo2_noche?.bajo90],
      ["caidas_spo2_hora", (d) => d.spo2_noche?.indice], ["resp_rpm", (d) => d.resp], ["temp_delta_c", (d) => { const t = tempDelta(d); return t == null ? null : Math.round(t * 100) / 100; }],
      ["pasos", (d) => d.pasos], ["minutos_zona", (d) => d.azm],
    ];
    const celda = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
    const filas = state.dias.map((d) => { const p = state.puntos.get(d.fecha) || {}; return cols.map(([, f]) => celda(f(d, p))).join(","); });
    const blob = new Blob(["\ufeff" + [cols.map(([k]) => k).join(","), ...filas].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `fitbit-air-${hoyISO()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Medir (sesión con el Fitbit Air) ----------
  // El Fitbit Air no transmite en vivo: la sesión marca una ventana de tiempo y, cuando la app Google Health sincroniza,
  // se toman del Fitbit las muestras de pulso de esa ventana. La FR solo la calcula durante el sueño.
  const DURACIONES = [1, 3, 5];
  const horaCorta = (iso) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  const haceCuanto = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;
  const leerSesion = () => { try { return JSON.parse(localStorage.getItem("salud-sesion") || "null"); } catch (e) { return null; } };
  const guardarSesionLocal = (s) => { try { s ? localStorage.setItem("salud-sesion", JSON.stringify(s)) : localStorage.removeItem("salud-sesion"); } catch (e) {} };
  const frNoche = () => { const d = [...state.dias].reverse().find((x) => num(x.resp) != null); return d ? { fr: num(d.resp), fecha: d.fecha } : null; };

  async function cargarMediciones() {
    const { data, error } = await sb.from("salud_mediciones").select("*").order("creado", { ascending: false }).limit(50);
    if (!error) state.mediciones = data || [];
  }

  async function actualizarFcReciente() {
    const b = $("#btnFcReciente"); if (b) { b.disabled = true; b.textContent = "Consultando…"; }
    try { state.fcReciente = await funcion({ accion: "fcReciente" }); }
    catch (e) { state.fcReciente = { error: e.message }; }
    if (state.tab === "medir") render();
  }

  function vistaMedir() {
    const dur = state.duracion || 3;
    const pendiente = leerSesion();
    const f = state.fcReciente;
    const fitbit = !f ? `<p class="muted">Consultando tu Fitbit Air…</p>`
      : f.error ? `<p class="banner err">${esc(f.error)}</p>`
      : !f.ultimo ? `<p class="muted">Sin datos de pulso en las últimas 24 h. Abre la app Google Health para que sincronice.</p>`
      : `<div class="fc-ahora"><b class="mono">${f.ultimo.lpm}</b><span>lpm · ${haceCuanto(f.ultimo.t)} (${horaCorta(f.ultimo.t)})</span></div>
         ${f.serie.length > 2 ? grafica("fcrec", `Últimas ${f.horas} h`, f.serie.map((p) => ({ fecha: p.t, v: p.lpm })), { fmtX: horaCorta, unidad: " lpm" }) : ""}`;
    const filas = state.mediciones.map((m) => `<tr>
      <td>${esc(new Date(m.inicio || m.creado).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</td>
      <td class="num">${m.duracion ? `${Math.round(m.duracion / 60)} min` : "—"}</td>
      <td class="num">${fmtNum(m.fc)}</td><td class="num">${m.fc_min != null ? `${fmtNum(m.fc_min)}–${fmtNum(m.fc_max)}` : "—"}</td>
      <td class="num">${fmtNum(m.vfc)}</td><td class="num">${fmtNum(m.fr, 1)}</td><td>${m.fuente === "bluetooth" ? "En vivo" : "Momento"}</td>
      <td><button class="btn sm" data-borrar-med="${m.id}" aria-label="Borrar medición">Borrar</button></td></tr>`).join("");
    if (!state.conexion?.conectado) return `<div class="empty">Conecta tu cuenta de Google Health para medir con tu Fitbit Air.</div>`;
    return `<div class="medir">
      <section class="box momento">
        <div class="eyebrow">Medir</div>
        <h2>Tu pulso, con el Fitbit Air</h2>
        <div class="opciones">
          <div class="opcion">
            <h3>En vivo <span class="etiqueta">Bluetooth</span></h3>
            <p class="small">Pulso latido a latido directo del Fitbit, con VFC y frecuencia respiratoria estimada.</p>
            <ol class="pasos small"><li>En la app Google Health: Conexiones → Fitbit Air → <b>Compartir frecuencia cardiaca</b>.</li><li>Presiona Conectar y elige tu Fitbit Air.</li></ol>
            <div><button class="btn primary" id="btnVivo" ${hayBluetooth() ? "" : "disabled"}>Conectar en vivo</button></div>
            ${hayBluetooth() ? "" : `<p class="small">Este navegador no tiene Bluetooth web. Abre la página en Chrome (Android o computadora); en iPhone, con la app Bluefy.</p>`}
          </div>
          <div class="opcion">
            <h3>Momento <span class="etiqueta">Guiado</span></h3>
            <p class="small">Quédate quieto y respira con la guía. Al terminar, cuando la app Google Health sincroniza, se trae del Fitbit tu pulso de esos minutos.</p>
            ${pendiente ? `<p class="small"><b>Tienes una sesión de las ${horaCorta(pendiente.inicio)} esperando datos del Fitbit.</b></p><div><button class="btn primary" id="btnVerSesion">Ver resultado</button></div>`
              : `<div class="chips" role="radiogroup" aria-label="Duración">${DURACIONES.map((d) => `<button class="chip" role="radio" aria-checked="${d === dur}" data-dur="${d}">${d} min</button>`).join("")}</div>
                 <div><button class="btn" id="btnMedir">Empezar</button></div>`}
          </div>
        </div>
      </section>
      <section class="box">
        <div class="toolbar" style="justify-content:space-between"><h2>Pulso del Fitbit Air</h2><button class="btn" id="btnFcReciente">Actualizar</button></div>
        ${fitbit}
        <p class="small muted">El Fitbit Air manda sus datos cuando la app Google Health sincroniza; ábrela un momento para tener lo más reciente.</p>
      </section>
      <section class="box">
        <h2>Tus sesiones</h2>
        ${filas ? `<div class="tbl-wrap"><table style="min-width:600px"><thead><tr><th>Fecha</th><th class="num">Duración</th><th class="num">FC prom.</th><th class="num">Mín–máx</th><th class="num">VFC ms</th><th class="num">FR rpm</th><th>Modo</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>` : `<div class="empty">Aún no hay sesiones.</div>`}
      </section>
    </div>`;
  }

  // Pantalla de sesión (siempre oscura, como una pantalla de enfoque)
  const ses = { timer: 0, sondeo: 0, wake: null, resultado: null, esperandoDesde: 0 };

  function abrirSesion(modo) {
    $("#sesion").hidden = false; document.body.style.overflow = "hidden";
    for (const id of ["sesCorriendo", "sesEsperando", "sesVivo", "sesResult"]) $("#" + id).hidden = id !== modo;
    if (modo !== "sesResult") $("#sesTitulo").textContent = modo === "sesVivo" ? "En vivo" : "Momento";
  }

  async function iniciarSesion() {
    const dur = (state.duracion || 3) * 60;
    const inicio = new Date();
    const s = { inicio: inicio.toISOString(), fin: new Date(+inicio + dur * 1000).toISOString(), duracion: dur };
    guardarSesionLocal(s);
    correr(s);
  }

  async function correr(s) {
    ses.resultado = null;
    abrirSesion("sesCorriendo");
    try { ses.wake = await navigator.wakeLock?.request("screen"); } catch (e) {}
    clearInterval(ses.timer);
    // Alinea la animación del círculo con el texto Inhala/Exhala aunque la sesión se retome a la mitad
    $(".ses-respira").style.animationDelay = `-${(((Date.now() - Date.parse(s.inicio)) / 1000) % 10).toFixed(2)}s`;
    const C = 2 * Math.PI * 108;
    const tick = () => {
      const total = s.duracion, resta = Math.max(0, (Date.parse(s.fin) - Date.now()) / 1000);
      $("#sesProg").setAttribute("stroke-dasharray", C.toFixed(1));
      $("#sesProg").setAttribute("stroke-dashoffset", (C * (resta / total)).toFixed(1));
      $("#sesReloj").textContent = mmss(Math.ceil(resta));
      // Guía de respiración: 4 s inhalar, 6 s exhalar (6 respiraciones por minuto)
      const ciclo = ((Date.now() - Date.parse(s.inicio)) / 1000) % 10;
      $("#sesGuia").textContent = ciclo < 4 ? "Inhala" : "Exhala";
      if (resta <= 0) { clearInterval(ses.timer); try { ses.wake?.release(); } catch (e) {} esperar(s); }
    };
    tick();
    ses.timer = setInterval(tick, 250);
  }

  // Espera a que el Fitbit sincronice la ventana de la sesión y consulta cada 20 s (hasta 15 min)
  function esperar(s) {
    ses.resultado = null;
    abrirSesion("sesEsperando");
    $("#sesEspera").textContent = "Abre la app Google Health en tu teléfono para que tu Fitbit Air sincronice, y regresa aquí.";
    ses.esperandoDesde = Date.now();
    clearInterval(ses.sondeo);
    consultarSesion(s);
    ses.sondeo = setInterval(() => {
      if (Date.now() - ses.esperandoDesde > 15 * 60 * 1000) { clearInterval(ses.sondeo); $("#sesEspera").textContent = "Todavía no llegan los datos. Abre la app Google Health y presiona Consultar."; return; }
      consultarSesion(s);
    }, 20000);
  }

  async function consultarSesion(s = leerSesion()) {
    if (!s) return;
    $("#sesDetalle").textContent = "Consultando al Fitbit…";
    let r;
    try { r = await funcion({ accion: "sesion", inicio: s.inicio, fin: s.fin }); }
    catch (e) { $("#sesDetalle").textContent = "No se pudo consultar: " + e.message; return; }
    if (r.completa && r.muestras >= 3) { clearInterval(ses.sondeo); mostrarResultado(s, r); return; }
    $("#sesDetalle").textContent = r.ultimaMuestra
      ? `Último dato del Fitbit: ${haceCuanto(r.ultimaMuestra)} · ${r.muestras} muestras de la sesión hasta ahora`
      : "Aún no llegan datos del Fitbit de esta sesión";
  }

  function mostrarResultado(s, r) {
    ses.resultado = { s, r };
    abrirSesion("sesResult");
    const vivoBt = s.fuente === "bluetooth";
    const fr = vivoBt ? (s.fr != null ? { fr: s.fr } : null) : frNoche();
    const W = 320, H = 90, xs = r.serie, lo = Math.min(...xs.map((p) => p.lpm)) - 3, hi = Math.max(...xs.map((p) => p.lpm)) + 3;
    const pts = xs.map((p, i) => `${(xs.length < 2 ? W / 2 : (i / (xs.length - 1)) * W).toFixed(1)},${(H - ((p.lpm - lo) / (hi - lo || 1)) * H).toFixed(1)}`).join(" ");
    $("#sesResult").innerHTML = `
      <div class="eyebrow">Resultado · ${horaCorta(s.inicio)}–${horaCorta(s.fin)}</div>
      <div class="ses-grande"><b>${r.fc}</b><span>lpm promedio</span></div>
      ${xs.length > 1 ? `<svg class="ses-curva" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pulso durante la sesión, de ${r.fcMin} a ${r.fcMax} lpm"><polyline points="${pts}" fill="none" stroke="#b3c6ff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>` : ""}
      <div class="ses-stats">
        <div><b>${r.fcMin}–${r.fcMax}</b><span>lpm</span><small>Mínima y máxima</small></div>
        <div><b>${r.vfc ?? "—"}</b><span>ms</span><small>VFC</small></div>
        <div><b>${fr ? fmtNum(fr.fr, vivoBt ? 0 : 1) : "—"}</b><span>rpm</span><small>${vivoBt ? "FR estimada" : `FR ${fr ? `(noche del ${fechaCorta(fr.fecha)})` : "nocturna"}`}</small></div>
      </div>
      <p class="ses-nota">${vivoBt
        ? `${r.muestras} lecturas en vivo del Fitbit Air. ${s.conRr ? "La FR se estima por cómo cambia tu ritmo al respirar; necesita al menos 40 segundos quieto." : "El Fitbit no mandó intervalos entre latidos, así que no hay VFC ni FR."}`
        : `${r.muestras} muestras del Fitbit Air. ${r.vfc == null ? "El Fitbit no registró VFC en esta ventana; la mide sobre todo mientras duermes. " : ""}La frecuencia respiratoria el Fitbit Air solo la calcula durante el sueño.`}</p>
      <div class="ses-botones"><button class="ses-btn primario" id="sesGuardar">Guardar</button><button class="ses-btn" id="sesDescartar">Descartar</button></div>`;
  }

  async function guardarMedicion() {
    if (!ses.resultado) return;
    const { s, r } = ses.resultado, vivoBt = s.fuente === "bluetooth";
    const fr = vivoBt ? s.fr : frNoche()?.fr;
    const { error } = await sb.from("salud_mediciones").insert({ inicio: s.inicio, fin: s.fin, duracion: s.duracion, fc: r.fc, fc_min: r.fcMin, fc_max: r.fcMax, vfc: r.vfc, fr: fr ?? null, muestras: r.muestras, fuente: vivoBt ? "bluetooth" : "fitbit" });
    if (error) { toast("No se pudo guardar: " + error.message); return; }
    if (!vivoBt) guardarSesionLocal(null);
    cerrarSesion();
    await cargarMediciones();
    state.tab = "medir"; render();
    toast("Sesión guardada");
  }

  async function borrarMedicion(id) {
    if (!confirm("¿Borrar esta sesión?")) return;
    const { error } = await sb.from("salud_mediciones").delete().eq("id", id);
    if (error) { toast("No se pudo borrar"); return; }
    await cargarMediciones(); render();
  }

  function cerrarSesion(descartar = false) {
    clearInterval(ses.timer); clearInterval(ses.sondeo);
    vivo.terminado = true; detenerVivo();
    try { ses.wake?.release(); } catch (e) {}
    // Descartar una medición en vivo no toca la sesión de Momento que pudiera estar esperando datos
    if (descartar && ses.resultado?.s?.fuente !== "bluetooth" && $("#sesVivo").hidden) guardarSesionLocal(null);
    $("#sesion").hidden = true; document.body.style.overflow = "";
    if (state.tab === "medir") render();
  }

  // Al volver de la app Google Health (o recargar), retoma la sesión pendiente
  function retomarSesion() {
    const s = leerSesion();
    if (!s || !state.conexion?.conectado) return;
    if (Date.now() - Date.parse(s.fin) > 24 * 3600 * 1000) { guardarSesionLocal(null); return; }
    if (Date.now() < Date.parse(s.fin)) correr(s);
    else if ($("#sesion").hidden || !$("#sesEsperando").hidden) esperar(s);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && iniciado) retomarSesion(); });

  // ---------- En vivo por Bluetooth ----------
  // Con "Compartir frecuencia cardiaca" activo, el Fitbit Air transmite con el perfil estándar de ritmo cardiaco
  // (el mismo que usan las caminadoras y apps de ciclismo). Chrome lo lee con Web Bluetooth; Safari en iPhone no.
  const vivo = { device: null, char: null, inicio: 0, lpms: [], rr: [], timer: 0, terminado: false };
  const hayBluetooth = () => !!navigator.bluetooth;
  const estadoVivo = (t) => { $("#vivoEstado").textContent = t; };

  async function iniciarVivo() {
    if (!hayBluetooth()) { toast("Este navegador no tiene Bluetooth web. Usa Chrome en Android o en computadora."); return; }
    let device;
    try { device = await navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] }); }
    catch (e) { if (e.name !== "NotFoundError") toast("No se pudo abrir Bluetooth: " + e.message); return; }
    detenerVivo();
    ses.resultado = null;
    Object.assign(vivo, { device, char: null, inicio: 0, lpms: [], rr: [], terminado: false });
    abrirSesion("sesVivo");
    $("#sesTitulo").textContent = "En vivo";
    $("#vivoLpm").textContent = "--"; $("#vivoVfc").textContent = "—"; $("#vivoFr").textContent = "—"; $("#vivoTiempo").textContent = "0:00";
    $("#vivoCurva").innerHTML = ""; $("#vivoLatido").classList.remove("latiendo");
    estadoVivo(`Conectando con ${device.name || "tu Fitbit Air"}…`);
    device.addEventListener("gattserverdisconnected", () => { if (!vivo.terminado) estadoVivo("Se perdió la conexión con el Fitbit. Presiona Terminar para ver lo medido o vuelve a conectar."); });
    try {
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService("heart_rate");
      vivo.char = await svc.getCharacteristic("heart_rate_measurement");
      vivo.char.addEventListener("characteristicvaluechanged", alMedir);
      await vivo.char.startNotifications();
      estadoVivo("Conectado. Quédate quieto y respira normal; con un minuto ya hay VFC y FR.");
      try { ses.wake = await navigator.wakeLock?.request("screen"); } catch (e) {}
      vivo.timer = setInterval(tickVivo, 1000);
    } catch (e) {
      estadoVivo(`No se pudo conectar (${e.message}). Revisa que "Compartir frecuencia cardiaca" esté activo en la app Google Health.`);
    }
  }

  function alMedir(ev) {
    const m = Vivo.leerMedicion(ev.target.value);
    const ahora = Date.now();
    if (!vivo.inicio) vivo.inicio = ahora;
    if (m.lpm > 0) {
      vivo.lpms.push({ t: ahora, lpm: m.lpm });
      $("#vivoLpm").textContent = m.lpm;
      $("#vivoLatido").classList.add("latiendo");
      $("#vivoLatido .ses-corazon").style.animationDuration = `${(60 / m.lpm).toFixed(2)}s`;
    }
    vivo.rr.push(...m.rr);
    dibujarVivo();
  }

  function tickVivo() {
    if (!vivo.inicio) return;
    const seg = (Date.now() - vivo.inicio) / 1000;
    $("#vivoTiempo").textContent = mmss(seg);
    const rr = vivo.rr.slice(-240);
    const vfc = Vivo.rmssd(rr), fr = Vivo.frDesdeRr(rr);
    if (vfc != null) $("#vivoVfc").textContent = vfc;
    if (fr != null) $("#vivoFr").textContent = fr;
    if (seg > 20 && !vivo.rr.length) estadoVivo("Tu Fitbit manda el pulso pero no los intervalos entre latidos, así que solo se mide la FC.");
  }

  // Últimos 2 minutos de pulso como línea
  function dibujarVivo() {
    const xs = vivo.lpms.filter((p) => p.t >= Date.now() - 120000);
    if (xs.length < 2) return;
    const W = 320, H = 110, lo = Math.min(...xs.map((p) => p.lpm)) - 4, hi = Math.max(...xs.map((p) => p.lpm)) + 4, t0 = xs[0].t, span = Math.max(1, xs[xs.length - 1].t - t0);
    const pts = xs.map((p) => `${(((p.t - t0) / span) * W).toFixed(1)},${(H - ((p.lpm - lo) / (hi - lo)) * H).toFixed(1)}`).join(" ");
    $("#vivoCurva").innerHTML = `<polyline points="${pts}" fill="none" stroke="#b3c6ff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  }

  function detenerVivo() {
    clearInterval(vivo.timer);
    try { vivo.char?.stopNotifications(); } catch (e) {}
    try { if (vivo.device?.gatt?.connected) vivo.device.gatt.disconnect(); } catch (e) {}
  }

  function terminarVivo() {
    vivo.terminado = true;
    detenerVivo();
    const xs = vivo.lpms;
    if (xs.length < 10) { estadoVivo("Muy pocos datos para un resultado. Mide al menos 30 segundos."); return; }
    const lpms = xs.map((p) => p.lpm);
    const inicio = new Date(xs[0].t).toISOString(), fin = new Date(xs[xs.length - 1].t).toISOString();
    // Serie en bloques de 5 s para la gráfica del resultado
    const bloques = new Map();
    for (const p of xs) { const k = Math.floor((p.t - xs[0].t) / 5000); if (!bloques.has(k)) bloques.set(k, []); bloques.get(k).push(p.lpm); }
    const r = {
      fc: Math.round(media(lpms)), fcMin: Math.min(...lpms), fcMax: Math.max(...lpms), vfc: Vivo.rmssd(vivo.rr), muestras: xs.length,
      serie: [...bloques.entries()].map(([k, v]) => ({ t: new Date(xs[0].t + k * 5000).toISOString(), lpm: Math.round(media(v)) })),
    };
    mostrarResultado({ inicio, fin, duracion: Math.round((xs[xs.length - 1].t - xs[0].t) / 1000), fuente: "bluetooth", fr: Vivo.frDesdeRr(vivo.rr), conRr: vivo.rr.length > 0 }, r);
  }

  // ---------- Eventos ----------
  document.addEventListener("click", async (e) => {
    if (e.target.closest("#btnMedir")) { iniciarSesion(); return; }
    if (e.target.closest("#btnCsv")) { descargarCsv(); return; }
    if (e.target.closest("#btnVivo")) { iniciarVivo(); return; }
    if (e.target.closest("#vivoTerminar")) { terminarVivo(); return; }
    if (e.target.closest("#btnVerSesion")) { retomarSesion(); if ($("#sesion").hidden) esperar(leerSesion()); return; }
    if (e.target.closest("#sesConsultar")) { consultarSesion(); return; }
    if (e.target.closest("#btnFcReciente")) { actualizarFcReciente(); return; }
    const chip = e.target.closest("[data-dur]");
    if (chip) { state.duracion = Number(chip.dataset.dur); render(); return; }
    if (e.target.closest("#sesCancelar")) { if (confirm("¿Cancelar la sesión?")) cerrarSesion(true); return; }
    if (e.target.closest("#sesDescartar")) { cerrarSesion(true); return; }
    if (e.target.closest("#sesCerrar")) { cerrarSesion(); return; }
    if (e.target.closest("#sesGuardar")) { guardarMedicion(); return; }
    const borrar = e.target.closest("[data-borrar-med]");
    if (borrar) { borrarMedicion(borrar.dataset.borrarMed); return; }
    document.querySelectorAll("details.menu[open]").forEach((m) => { if (!m.contains(e.target) || e.target.closest(".menu-list button")) m.removeAttribute("open"); });
    const pz = e.target.closest("[data-puntaje]");
    if (pz) { state.puntaje = pz.dataset.puntaje; try { localStorage.setItem("salud-puntaje", state.puntaje); } catch (err) {} render(); return; }
    const t = e.target.closest("[data-tab],[data-dia]");
    if (!t) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; try { localStorage.setItem("salud-tab", state.tab); } catch (err) {} render(); return; }
    const i = state.dias.findIndex((x) => x.fecha === state.fecha);
    const j = t.dataset.dia === "ultimo" ? state.dias.length - 1 : i + Number(t.dataset.dia);
    if (state.dias[j]) { state.fecha = state.dias[j].fecha; render(); }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "selRango") { state.rango = Number(e.target.value); try { localStorage.setItem("salud-rango", state.rango); } catch (err) {} render(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#sesion").hidden) { cerrarSesion(); return; }
    if (state.tab !== "hoy" || /INPUT|SELECT/.test(document.activeElement?.tagName)) return;
    if (e.key === "ArrowLeft") $("[data-dia='-1']")?.click();
    if (e.key === "ArrowRight") $("[data-dia='1']")?.click();
  });

  // Crosshair + tooltip en las gráficas de tendencia
  function hover(e) {
    const r = e.target.closest?.("[data-hover]");
    document.querySelectorAll(".chart .tip").forEach((tip) => { if (!r || !r.closest(".chart").contains(tip)) { tip.hidden = true; const svg = tip.previousElementSibling; svg.querySelector(".cross").setAttribute("visibility", "hidden"); svg.querySelector(".dot").setAttribute("visibility", "hidden"); } });
    if (!r) return;
    const s = series[r.dataset.hover]; const svg = r.ownerSVGElement;
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * s.W;
    let best = -1, dist = Infinity;
    s.puntos.forEach((p, i) => { if (p.v == null) return; const dd = Math.abs(s.x(i) - px); if (dd < dist) { dist = dd; best = i; } });
    if (best < 0) return;
    const p = s.puntos[best], cx = s.x(best), cy = s.y(p.v);
    const cross = svg.querySelector(".cross"), dot = svg.querySelector(".dot"), tip = svg.nextElementSibling;
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("visibility", "visible");
    tip.hidden = false; tip.textContent = `${s.fmtX(p.fecha)} · ${s.fmt(p.v)}${s.unidad}`;
    tip.style.left = `${(cx / s.W) * box.width}px`; tip.style.top = `${(cy / s.H) * box.height}px`;
  }
  document.addEventListener("pointermove", hover);
  document.addEventListener("pointerleave", () => hover({ target: document.body }));

  $("#btnSync").onclick = () => sincronizar(state.dias.length ? 14 : 45);
  $("#btnConectar").onclick = async () => {
    $("#btnConectar").disabled = true;
    try { const { url } = await funcion({ accion: "conectar" }); location.href = url; }
    catch (e) { toast("No se pudo iniciar la conexión: " + e.message); $("#btnConectar").disabled = false; }
  };
  $("#btnDesc").onclick = async () => {
    if (!confirm("¿Desconectar tu cuenta de Google Health? Se revoca el acceso.")) return;
    const borrar = confirm("¿Borrar también los datos ya guardados aquí? (Aceptar = borrar, Cancelar = conservarlos)");
    try { await funcion({ accion: "desconectar", borrarDatos: borrar }); state.conexion = { conectado: false }; if (borrar) state.dias = []; banner(""); render(); toast("Cuenta desconectada"); }
    catch (e) { toast("No se pudo desconectar: " + e.message); }
  };

  // Regreso de Google OAuth (la función redirige con ?fitbit=ok|error)
  const qs = new URLSearchParams(location.search);
  if (qs.has("fitbit")) {
    if (qs.get("fitbit") === "ok") { toast(`Cuenta conectada · ${qs.get("dias") || 0} días importados`); if (qs.get("aviso")) setTimeout(() => banner(qs.get("aviso")), 0); }
    else setTimeout(() => banner("No se pudo conectar: " + (qs.get("motivo") || "error desconocido"), true), 0);
    history.replaceState(null, "", location.pathname);
  }

  // ---------- Acceso ----------
  let iniciado = false;
  function mostrar(session) {
    $("#loginView").hidden = !!session;
    $("#appView").hidden = !session;
    if (session && !iniciado) { iniciado = true; render(); cargar(); }
    if (!session) { iniciado = false; state.cargado = false; state.dias = []; state.conexion = null; }
  }
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim(), password = $("#loginPass").value;
    if (!email || !password) return;
    $("#loginBtn").disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    $("#loginBtn").disabled = false;
    $("#loginMsg").textContent = error ? (error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : error.message) : "";
  };
  $("#btnSalir").onclick = () => sb.auth.signOut();
  sb.auth.onAuthStateChange((_ev, session) => mostrar(session));
  sb.auth.getSession().then(({ data }) => mostrar(data.session));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && iniciado && !state.ocupado) cargarDatos().then(render).catch(() => {}); });
})();
