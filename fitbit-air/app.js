(() => {
  const P = window.Puntuaciones;
  const state = { dias: [], puntos: new Map(), fecha: "", tab: "hoy", rango: 30, conexion: null, cargado: false, ocupado: false, mediciones: [], fcReciente: null };
  try { const t = localStorage.getItem("salud-tab"); if (t) state.tab = t; const r = Number(localStorage.getItem("salud-rango")); if (r) state.rango = r; } catch (e) {}

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
  const signo = (x, dec = 1) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(dec)}`);
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
    const { data, error } = await sb.from("salud_dias").select("fecha,pasos,azm,fc_reposo,vfc,spo2,resp,temp,temp_base,sueno").order("fecha");
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
    $("#btnSync").disabled = state.ocupado; $("#btnSync").textContent = state.ocupado ? "Sincronizando…" : "Sincronizar";
    $("#conectar").hidden = !state.cargado || !!c?.conectado;
    $("#status").textContent = c?.ultimaSync ? `Sincronizado ${new Date(c.ultimaSync).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "";
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

  function anillo(total) {
    const r = 36, C = 2 * Math.PI * r;
    const off = total == null ? C : C * (1 - total / 100);
    return `<svg class="ring" viewBox="0 0 84 84" role="img" aria-label="${total == null ? "Sin puntuación" : `${total} de 100`}">
      <circle class="bg" cx="42" cy="42" r="${r}" fill="none" stroke-width="7"/>
      <circle class="fg" cx="42" cy="42" r="${r}" fill="none" stroke-width="7" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 42 42)"/>
      <text x="42" y="50" text-anchor="middle">${total ?? "—"}</text></svg>`;
  }

  function tarjeta(titulo, p, nota) {
    const b = P.banda(p?.total);
    return `<section class="box">
      <div class="score-head">${anillo(p?.total ?? null)}
        <div style="display:grid;gap:4px"><h2>${titulo}</h2>${b ? `<span class="band ${b.key}">${b.label}</span>` : `<span class="small muted">${nota || "Sin datos suficientes"}</span>`}</div></div>
      <div class="contribs">${(p?.contribuyentes || []).map((c) => `<div class="contrib ${c.pts == null ? "na" : ""}">
        <span>${esc(c.label)}</span><span class="v">${esc(c.valor)}</span>
        <span class="bar" role="img" aria-label="${c.pts == null ? "sin dato" : `${c.pts} de 100`}"><i style="width:${c.pts ?? 0}%"></i></span></div>`).join("")}</div>
    </section>`;
  }

  function tile(label, valor, delta) { return `<div class="tile"><span class="small muted">${label}</span><b>${valor}</b>${delta ? `<span class="delta">${delta}</span>` : ""}</div>`; }

  function vistaDia() {
    const d = state.dias.find((x) => x.fecha === state.fecha) || { fecha: state.fecha };
    const p = state.puntos.get(state.fecha);
    const i = state.dias.findIndex((x) => x.fecha === state.fecha);
    const previos = state.dias.slice(Math.max(0, i - 30), i);
    const base = (k) => media(previos.map((x) => num(x[k])).filter((x) => x != null));
    const vsBase = (k, dec, u) => { const b = base(k), v = num(d[k]); return b == null || v == null ? "" : `${signo(v - b, dec)} ${u} vs. tu promedio`; };
    const s = d.sueno;
    return `<div style="display:grid;gap:14px">
      <div class="daynav">
        <button class="btn" data-dia="-1" ${i <= 0 ? "disabled" : ""} aria-label="Día anterior">‹</button>
        <h2>${esc(fechaLarga(state.fecha))}</h2>
        <button class="btn" data-dia="1" ${i < 0 || i >= state.dias.length - 1 ? "disabled" : ""} aria-label="Día siguiente">›</button>
        <button class="btn" data-dia="ultimo" ${i === state.dias.length - 1 ? "hidden" : ""}>Hoy</button>
      </div>
      <div class="scores">
        ${tarjeta("Recuperación", p?.recuperacion, p?.recuperacion?.calibrando ? "Calibrando: faltan días de línea base" : "")}
        ${tarjeta("Sueño", p?.sueno, "Sin noche registrada")}
        ${tarjeta("Actividad", p?.actividad)}
      </div>
      <div class="tiles">
        ${tile("Sueño total", s?.dormido != null ? P.hm(s.dormido) : "—", s?.enCama ? `${P.hm(s.enCama)} en cama` : "")}
        ${tile("FC en reposo", d.fc_reposo != null ? `${fmtNum(d.fc_reposo)} lpm` : "—", vsBase("fc_reposo", 0, "lpm"))}
        ${tile("VFC", d.vfc != null ? `${fmtNum(d.vfc)} ms` : "—", vsBase("vfc", 0, "ms"))}
        ${tile("SpO2", d.spo2 != null ? `${fmtNum(d.spo2, 1)}%` : "—", "")}
        ${tile("Respiración", d.resp != null ? `${fmtNum(d.resp, 1)} rpm` : "—", vsBase("resp", 1, "rpm"))}
        ${tile("Temperatura", tempDelta(d) != null ? `${signo(tempDelta(d))} °C` : "—", tempDelta(d) != null ? "vs. tu línea base" : "")}
        ${tile("Pasos", fmtNum(d.pasos), "")}
        ${tile("Minutos en zona", fmtNum(d.azm), "")}
      </div>
      ${s?.hipnograma?.length ? hipnograma(s) : ""}
    </div>`;
  }

  const ETAPAS_FASES = [["AWAKE", "Despierto", "--awake"], ["REM", "REM", "--rem"], ["LIGHT", "Ligero", "--light"], ["DEEP", "Profundo", "--deep"]];
  // Registro clásico (sin fases): pasa cuando la noche se edita a mano o el reloj no logró calcular fases
  const ETAPAS_CLASICO = [["AWAKE", "Despierto", "--awake"], ["RESTLESS", "Inquieto", "--rem"], ["ASLEEP", "Dormido", "--light"]];
  function hipnograma(s) {
    const conFases = s.hipnograma.some(([k]) => ["DEEP", "REM", "LIGHT"].includes(k));
    const ETAPAS = conFases ? ETAPAS_FASES : ETAPAS_CLASICO;
    const W = 720, rowH = 30, gutter = 72, top = 6, H = top + rowH * ETAPAS.length + 24;
    const t0 = Date.parse(s.inicio), t1 = Date.parse(s.fin), span = Math.max(1, t1 - t0);
    const x = (ms) => gutter + ((ms - t0) / span) * (W - gutter - 24);
    const fila = Object.fromEntries(ETAPAS.map(([k], i) => [k, i]));
    const segs = s.hipnograma.filter(([k]) => k in fila).map(([k, a, b]) => {
      const x0 = x(Date.parse(a)), x1 = x(Date.parse(b)), et = ETAPAS[fila[k]];
      return `<rect x="${x0.toFixed(1)}" y="${top + fila[k] * rowH + 4}" width="${Math.max(1, x1 - x0 - 1).toFixed(1)}" height="${rowH - 8}" rx="2" fill="var(${et[2]})"><title>${et[1]} · ${horaLocal(Date.parse(a), s.offset)}–${horaLocal(Date.parse(b), s.offset)}</title></rect>`;
    }).join("");
    const horas = [];
    const primera = Math.ceil((t0 + s.offset * 1000) / 3600000) * 3600000 - s.offset * 1000;
    for (let t = primera; t < t1; t += 3600000) horas.push(t);
    const paso = horas.length > 8 ? 2 : 1;
    const ejes = horas.filter((_, i) => i % paso === 0).map((t) => `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${top + rowH * ETAPAS.length}"/><text class="lbl" x="${x(t)}" y="${H - 6}" text-anchor="middle">${horaLocal(t, s.offset)}</text>`).join("");
    const filas = ETAPAS.map(([, lbl], i) => `<text class="lbl" x="0" y="${top + i * rowH + rowH / 2 + 4}">${lbl}</text>`).join("");
    const et = s.etapas || {};
    return `<section class="box hypno">
      <h3>${conFases ? "Etapas de sueño" : "Sueño"} · ${horaLocal(t0, s.offset)} a ${horaLocal(t1, s.offset)}${s.siesta ? " · siesta" : ""}</h3>
      ${!conFases ? `<p class="small muted">${s.editado ? "Esta noche se editó a mano en la app Google Health, así que Google ya no guarda sus fases (profundo, REM, ligero)." : "El Fitbit no calculó fases para esta noche; pasa si duermes menos de 3 h o el reloj está flojo."}</p>` : ""}
      <div class="scroll"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hipnograma de la noche">${ejes}${filas}${segs}</svg></div>
      <div class="legend">${ETAPAS.map(([k, lbl, c]) => `<span><i style="background:var(${c})"></i>${lbl} ${et[k] != null ? `· ${P.hm(et[k])}` : ""}</span>`).join("")}</div>
    </section>`;
  }

  // ---------- Tendencias ----------
  const series = {};
  function grafica(id, titulo, puntos, { fmt = (v) => fmtNum(v), fmtX = fechaCorta, escala = null, refs = [], banda = false, unidad = "" } = {}) {
    const W = 360, H = 150, L = 36, R = 8, T = 10, B = 22;
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
    return `<section class="box chart" data-chart="${id}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><h3>${titulo}</h3>
        <span class="small muted">promedio <span class="mono">${fmt(m)}${unidad}</span></span></div>
      <div class="big">${fmt(ultimo.v)}${unidad} <span class="small muted">${fmtX(ultimo.fecha)}</span></div>
      <div style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}: ${puntos.length} días, promedio ${fmt(m)}${unidad}">
        ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 5}" y="${y(t) + 3}" text-anchor="end">${fmt(t)}</text>`).join("")}
        ${banda && sd ? `<rect class="baseband" x="${L}" width="${W - L - R}" y="${y(Math.min(hi, m + sd))}" height="${Math.max(0, y(Math.max(lo, m - sd)) - y(Math.min(hi, m + sd)))}"><title>Tu rango habitual (promedio ± 1 desviación)</title></rect>` : ""}
        ${refs.filter((r) => r > lo && r < hi).map((r) => `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(r)}" y2="${y(r)}"/>`).join("")}
        <path class="line" d="${d}"/>
        ${puntos.length > 1 ? [0, Math.floor((puntos.length - 1) / 2), puntos.length - 1].map((i) => `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === puntos.length - 1 ? "end" : "middle"}">${fmtX(puntos[i].fecha)}</text>`).join("") : ""}
        <line class="cross" y1="${T}" y2="${H - B}" visibility="hidden"/><circle class="dot" r="4.5" visibility="hidden"/>
        <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent" data-hover="${id}"/>
      </svg><div class="tip" hidden></div></div>
    </section>`;
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
        <span class="small muted">Líneas punteadas: 70 (buena) y 85 (óptima). Franja gris: tu rango habitual.</span></div>
      <div class="charts">
        ${grafica("rec", "Recuperación", serie((d, p) => p?.recuperacion.total ?? null), score)}
        ${grafica("sue", "Sueño", serie((d, p) => p?.sueno.total ?? null), score)}
        ${grafica("act", "Actividad", serie((d, p) => p?.actividad.total ?? null), score)}
        ${grafica("vfc", "VFC", serie((d) => num(d?.vfc)), { banda: true, unidad: " ms" })}
        ${grafica("fc", "FC en reposo", serie((d) => num(d?.fc_reposo)), { banda: true, unidad: " lpm" })}
        ${grafica("hrs", "Sueño total", serie((d) => (d?.sueno?.dormido != null ? d.sueno.dormido / 60 : null)), { banda: true, fmt: (v) => fmtNum(v, 1), unidad: " h" })}
        ${grafica("tmp", "Temperatura vs. base", serie((d) => tempDelta(d)), { fmt: (v) => signo(v), unidad: " °C", refs: [0] })}
        ${grafica("pas", "Pasos", serie((d) => num(d?.pasos)), { refs: [8000] })}
      </div></div>`;
  }

  function vistaTabla() {
    const filas = [...state.dias].reverse().map((d) => {
      const p = state.puntos.get(d.fecha) || {};
      return `<tr><td>${esc(fechaCorta(d.fecha))}</td><td class="num">${p.recuperacion?.total ?? "—"}</td><td class="num">${p.sueno?.total ?? "—"}</td><td class="num">${p.actividad?.total ?? "—"}</td>
        <td class="num">${d.sueno?.dormido != null ? P.hm(d.sueno.dormido) : "—"}</td><td class="num">${fmtNum(d.fc_reposo)}</td><td class="num">${fmtNum(d.vfc)}</td>
        <td class="num">${fmtNum(d.spo2, 1)}</td><td class="num">${fmtNum(d.resp, 1)}</td><td class="num">${signo(tempDelta(d))}</td><td class="num">${fmtNum(d.pasos)}</td><td class="num">${fmtNum(d.azm)}</td></tr>`;
    }).join("");
    return `<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th class="num">Recup.</th><th class="num">Sueño</th><th class="num">Activ.</th><th class="num">Dormido</th><th class="num">FC rep.</th><th class="num">VFC ms</th><th class="num">SpO2 %</th><th class="num">Resp.</th><th class="num">Temp Δ</th><th class="num">Pasos</th><th class="num">Min. zona</th></tr></thead><tbody>${filas}</tbody></table></div>`;
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
      <td class="num">${fmtNum(m.vfc)}</td><td class="num">${fmtNum(m.fr, 1)}</td>
      <td><button class="btn sm" data-borrar-med="${m.id}" aria-label="Borrar medición">Borrar</button></td></tr>`).join("");
    if (!state.conexion?.conectado) return `<div class="empty">Conecta tu cuenta de Google Health para medir con tu Fitbit Air.</div>`;
    return `<div class="medir">
      <section class="box momento">
        <div class="eyebrow">Momento</div>
        <h2>Mide tu pulso en reposo</h2>
        <p>Con tu Fitbit Air puesto, quédate quieto y respira con la guía. Al terminar, la app trae del Fitbit tu frecuencia cardiaca de esos minutos.</p>
        ${pendiente ? `<p><b>Tienes una sesión de las ${horaCorta(pendiente.inicio)} esperando datos del Fitbit.</b></p><div><button class="btn primary" id="btnVerSesion">Ver resultado</button></div>`
          : `<div class="chips" role="radiogroup" aria-label="Duración">${DURACIONES.map((d) => `<button class="chip" role="radio" aria-checked="${d === dur}" data-dur="${d}">${d} min</button>`).join("")}</div>
             <div><button class="btn primary" id="btnMedir">Empezar</button></div>`}
      </section>
      <section class="box">
        <div class="toolbar" style="justify-content:space-between"><h2>Pulso del Fitbit Air</h2><button class="btn" id="btnFcReciente">Actualizar</button></div>
        ${fitbit}
        <p class="small muted">El Fitbit Air manda sus datos cuando la app Google Health sincroniza; ábrela un momento para tener lo más reciente.</p>
      </section>
      <section class="box">
        <h2>Tus sesiones</h2>
        ${filas ? `<div class="tbl-wrap"><table style="min-width:600px"><thead><tr><th>Fecha</th><th class="num">Duración</th><th class="num">FC prom.</th><th class="num">Mín–máx</th><th class="num">VFC ms</th><th class="num">FR noche</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>` : `<div class="empty">Aún no hay sesiones.</div>`}
      </section>
    </div>`;
  }

  // Pantalla de sesión (siempre oscura, como una pantalla de enfoque)
  const ses = { timer: 0, sondeo: 0, wake: null, resultado: null, esperandoDesde: 0 };

  function abrirSesion(modo) {
    $("#sesion").hidden = false; document.body.style.overflow = "hidden";
    for (const id of ["sesCorriendo", "sesEsperando", "sesResult"]) $("#" + id).hidden = id !== modo;
  }

  async function iniciarSesion() {
    const dur = (state.duracion || 3) * 60;
    const inicio = new Date();
    const s = { inicio: inicio.toISOString(), fin: new Date(+inicio + dur * 1000).toISOString(), duracion: dur };
    guardarSesionLocal(s);
    correr(s);
  }

  async function correr(s) {
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
    const fr = frNoche();
    const W = 320, H = 90, xs = r.serie, lo = Math.min(...xs.map((p) => p.lpm)) - 3, hi = Math.max(...xs.map((p) => p.lpm)) + 3;
    const pts = xs.map((p, i) => `${(xs.length < 2 ? W / 2 : (i / (xs.length - 1)) * W).toFixed(1)},${(H - ((p.lpm - lo) / (hi - lo || 1)) * H).toFixed(1)}`).join(" ");
    $("#sesResult").innerHTML = `
      <div class="eyebrow">Resultado · ${horaCorta(s.inicio)}–${horaCorta(s.fin)}</div>
      <div class="ses-grande"><b>${r.fc}</b><span>lpm promedio</span></div>
      ${xs.length > 1 ? `<svg class="ses-curva" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pulso durante la sesión, de ${r.fcMin} a ${r.fcMax} lpm"><polyline points="${pts}" fill="none" stroke="#b3c6ff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>` : ""}
      <div class="ses-stats">
        <div><b>${r.fcMin}–${r.fcMax}</b><span>lpm</span><small>Mínima y máxima</small></div>
        <div><b>${r.vfc ?? "—"}</b><span>ms</span><small>VFC</small></div>
        <div><b>${fr ? fmtNum(fr.fr, 1) : "—"}</b><span>rpm</span><small>FR ${fr ? `(noche del ${fechaCorta(fr.fecha)})` : "nocturna"}</small></div>
      </div>
      <p class="ses-nota">${r.muestras} muestras del Fitbit Air. ${r.vfc == null ? "El Fitbit no registró VFC en esta ventana; la mide sobre todo mientras duermes. " : ""}La frecuencia respiratoria el Fitbit Air solo la calcula durante el sueño.</p>
      <div class="ses-botones"><button class="ses-btn primario" id="sesGuardar">Guardar</button><button class="ses-btn" id="sesDescartar">Descartar</button></div>`;
  }

  async function guardarMedicion() {
    if (!ses.resultado) return;
    const { s, r } = ses.resultado, fr = frNoche();
    const { error } = await sb.from("salud_mediciones").insert({ inicio: s.inicio, fin: s.fin, duracion: s.duracion, fc: r.fc, fc_min: r.fcMin, fc_max: r.fcMax, vfc: r.vfc, fr: fr?.fr ?? null, muestras: r.muestras, fuente: "fitbit" });
    if (error) { toast("No se pudo guardar: " + error.message); return; }
    guardarSesionLocal(null);
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
    try { ses.wake?.release(); } catch (e) {}
    if (descartar) guardarSesionLocal(null);
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

  // ---------- Eventos ----------
  document.addEventListener("click", async (e) => {
    if (e.target.closest("#btnMedir")) { iniciarSesion(); return; }
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
