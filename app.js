
(() => {
  // ---------- Modelo ----------
  const ETAPAS = {
    socio: ["Solicitud enviada", "Conectado", "Mensaje enviado", "En conversación", "Reunión", "Acuerdo firmado", "Refiriendo", "Frío", "Descartado"],
    cliente: ["Solicitud enviada", "Conectado", "Mensaje enviado", "En conversación", "Diagnóstico", "Propuesta", "Cliente", "Frío", "Descartado"],
  };
  // Acción y plazo por default al entrar a cada etapa (días desde hoy; null = sin seguimiento)
  const DEFAULTS = {
    "Solicitud enviada": [7, "Revisar si aceptó la solicitud"],
    "Conectado": [0, "Enviar mensaje de presentación"],
    "Mensaje enviado": [4, "Seguimiento 1 si no responde"],
    "En conversación": [2, "Dar seguimiento a la conversación / proponer reunión"],
    "Reunión": [1, "Preparar la reunión"],
    "Acuerdo firmado": [7, "Mandar material para referir y primer check-in"],
    "Refiriendo": [30, "Toque mensual"],
    "Diagnóstico": [3, "Enviar propuesta"],
    "Propuesta": [4, "Seguimiento a la propuesta"],
    "Cliente": [90, "Check-in trimestral y pedir referidos"],
    "Frío": [60, "Reintentar contacto"],
    "Descartado": [null, ""],
  };
  // Cadencia estándar sin respuesta: días desde el primer mensaje
  const CADENCIA = [4, 10, 21];
  const CERRADAS = ["Descartado"];
  // Estado del contacto, independiente del pipeline: qué tan lejos llegó la conversación
  const ESTADOS = [
    { key: "solicitud", label: "Solicitud enviada", corto: "Solicitud", desc: "No ha aceptado" },
    { key: "aceptado", label: "Aceptó, falta mensaje", corto: "Aceptó", desc: "Toca escribirle" },
    { key: "mensaje", label: "Mensaje sin respuesta", corto: "Sin respuesta", desc: "Esperando que conteste" },
    { key: "respondio", label: "Respondió", corto: "Respondió", desc: "Ya hay conversación" },
  ];
  const estadoDe = (c) => {
    if (c.etapa === "Descartado") return null;
    if (c.etapa === "Solicitud enviada") return "solicitud";
    if (c.etapa === "Conectado") return "aceptado";
    if (c.etapa === "Mensaje enviado") return "mensaje";
    if (c.etapa === "Frío") return c.fechaRespuesta || (c.historial || []).some((h) => h.texto === "Respondió") ? "respondio" : "mensaje";
    return "respondio";
  };
  const pillEstado = (c) => {
    const k = estadoDe(c); if (!k) return `<span class="pill stage">Descartado</span>`;
    const e = ESTADOS.find((x) => x.key === k);
    const extra = k === "mensaje" && c.toques ? ` · ${c.toques}/${CADENCIA.length}` : "";
    return `<span class="pill est-${k}">${e.corto}${extra}</span>`;
  };

  const state = { contactos: [], plantillas: [], referidos: [], tab: "prospectos", q: "", filtro: "", tipo: "", orden: "estado", abierto: null, db: null, cargado: false };
  try { const t = localStorage.getItem("iq-tab"); if (t) state.tab = t; } catch (e) {}

  // ---------- Utilidades ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`; };
  const diffDays = (a, b) => { const p = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(a) - p(b)) / 86400000); };
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const fmt = (iso) => { if (!iso) return "—"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MESES[m - 1]}`; };
  const money = (n) => (Number(n) || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
  const primerNombre = (n) => String(n || "").replace(/^(Arq\.|Lic\.|C\.P\.|Ing\.|Dr\.|Mtro\.)\s*/i, "").split(/\s+/)[0] || "";
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600); };
  const urgencia = (c) => {
    if (!c.proximaFecha || CERRADAS.includes(c.etapa)) return "none";
    const d = diffDays(c.proximaFecha, hoy());
    return d < 0 ? "due" : d === 0 ? "today" : d <= 7 ? "week" : "later";
  };
  const byId = (id) => state.contactos.find((c) => c.id === id);
  const socios = () => state.contactos.filter((c) => c.pipeline === "socio" && !CERRADAS.includes(c.etapa));

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); toast("Copiado al portapapeles"); }
    catch (e) {
      const ta = document.createElement("textarea"); ta.value = texto; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast("Copiado al portapapeles"); } catch (e2) { toast("Selecciona el texto y cópialo manualmente"); }
      ta.remove();
    }
  }

  // ---------- Escrituras ----------
  async function guardar(id, cambios, nota) {
    if (!state.db) { toast("Sin conexión a la base de datos"); return; }
    const c = byId(id);
    const data = { ...cambios, actualizado: hoy() };
    if (nota) data.historial = [...(c?.historial || []), { fecha: hoy(), texto: nota }];
    try { await state.db.collection("contactos").doc(id).update(data); }
    catch (e) { toast("No se pudo guardar: " + (e.code || e.message)); }
  }

  function cambiosDeEtapa(c, etapa) {
    const [dias, accion] = DEFAULTS[etapa] || [null, ""];
    const out = { etapa, proximaAccion: accion, proximaFecha: dias == null ? "" : addDays(hoy(), dias) };
    if (etapa !== "Mensaje enviado") { out.toques = 0; out.primerMensaje = ""; }
    return out;
  }

  async function moverEtapa(c, etapa, nota) {
    await guardar(c.id, cambiosDeEtapa(c, etapa), nota || `Etapa: ${c.etapa} → ${etapa}`);
  }

  async function mensajeEnviado(c) {
    const h = hoy();
    if (["Solicitud enviada", "Conectado", "Mensaje enviado", "Frío"].includes(c.etapa)) {
      const primer = c.etapa === "Mensaje enviado" && c.primerMensaje ? c.primerMensaje : h;
      const toques = c.etapa === "Mensaje enviado" ? (c.toques || 0) + 1 : 1;
      const idx = Math.min(toques, CADENCIA.length) - 1;
      let fecha = addDays(primer, CADENCIA[idx]);
      if (diffDays(fecha, h) < 1) fecha = addDays(h, 1);
      const accion = toques >= CADENCIA.length ? "Sin respuesta tras 3 mensajes: pasar a Frío" : `Seguimiento ${toques} si no responde`;
      await guardar(c.id, { etapa: "Mensaje enviado", primerMensaje: primer, toques, fechaMensaje: c.fechaMensaje || h, fechaAcepto: c.fechaAcepto || h, ultimoContacto: h, proximaFecha: fecha, proximaAccion: accion }, `Mensaje enviado (#${toques})`);
    } else {
      const dias = c.etapa === "Refiriendo" ? 30 : c.etapa === "Cliente" ? 90 : 4;
      const accion = c.etapa === "Refiriendo" ? "Toque mensual" : c.etapa === "Cliente" ? "Check-in trimestral y pedir referidos" : c.proximaAccion || "Dar seguimiento";
      await guardar(c.id, { ultimoContacto: h, proximaFecha: addDays(h, dias), proximaAccion: accion }, "Mensaje / toque enviado");
    }
    toast("Registrado. Próximo seguimiento agendado.");
  }

  async function respondio(c) {
    const temprana = ["Solicitud enviada", "Conectado", "Mensaje enviado", "Frío"].includes(c.etapa);
    const etapa = temprana ? "En conversación" : c.etapa;
    await guardar(c.id, { etapa, fechaRespuesta: c.fechaRespuesta || hoy(), fechaMensaje: c.fechaMensaje || c.primerMensaje || "", toques: 0, primerMensaje: "", ultimoContacto: hoy(), proximaFecha: addDays(hoy(), 1), proximaAccion: "Contestar y proponer reunión" }, "Respondió");
    toast("Marcado como respondió");
  }

  // ---------- Render principal ----------
  function render() {
    renderKpis();
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
    const v = $("#view");
    if (!state.cargado) { v.innerHTML = `<div class="empty">Cargando tus contactos…</div>`; return; }
    if (state.tab === "prospectos") v.innerHTML = vistaProspectos();
    else if (state.tab === "hoy") v.innerHTML = vistaHoy();
    else if (state.tab === "socio" || state.tab === "cliente") v.innerHTML = vistaTablero(state.tab);
    else if (state.tab === "referidos") v.innerHTML = vistaReferidos();
    else v.innerHTML = vistaPlantillas();
    if (state.abierto) renderPanel();
  }

  function renderKpis() {
    const activos = state.contactos.filter((c) => !CERRADAS.includes(c.etapa));
    const vencidos = activos.filter((c) => urgencia(c) === "due").length;
    const deHoy = activos.filter((c) => urgencia(c) === "today").length;
    const sociosActivos = state.contactos.filter((c) => c.pipeline === "socio" && ["Acuerdo firmado", "Refiriendo"].includes(c.etapa)).length;
    const pendiente = state.referidos.filter((r) => !r.pagada).reduce((s, r) => s + comision(r), 0);
    $("#kpis").innerHTML = `
      <div class="kpi due"><span class="small muted">Vencidos</span><b>${vencidos}</b></div>
      <div class="kpi today"><span class="small muted">Para hoy</span><b>${deHoy}</b></div>
      <div class="kpi"><span class="small muted">Socios con acuerdo</span><b>${sociosActivos}</b></div>
      <div class="kpi"><span class="small muted">Comisiones por pagar</span><b>${money(pendiente)}</b></div>`;
    const n = (k) => activos.filter((c) => estadoDe(c) === k).length;
    const escritos = n("mensaje") + n("respondio");
    const tasa = escritos ? Math.round((n("respondio") / escritos) * 100) : 0;
    $("#embudo").innerHTML = ESTADOS.map((e) => `
      <button class="etapa-est est-${e.key}" data-filtro="${e.key}" aria-pressed="${state.filtro === e.key}">
        <span class="lbl">${e.label}</span><b>${n(e.key)}</b><span class="small muted">${e.desc}</span>
      </button>`).join("") + `<div class="tasa small muted">Tasa de respuesta: <b class="mono">${tasa}%</b> de ${escritos} a los que ya escribiste${state.filtro ? ` · <button class="btn sm" data-filtro="">Quitar filtro</button>` : ""}</div>`;
  }

  function filaAgenda(c) {
    const u = urgencia(c);
    const d = diffDays(c.proximaFecha, hoy());
    const cuando = u === "due" ? `<span class="pill due">Vencido ${-d} d</span>` : u === "today" ? `<span class="pill today">Hoy</span>` : `<span class="pill stage">${fmt(c.proximaFecha)}</span>`;
    const sugFrio = c.etapa === "Mensaje enviado" && (c.toques || 0) >= CADENCIA.length && d <= 0;
    return `<div class="row ${u === "due" ? "due" : u === "today" ? "today" : ""}">
      <div class="who"><a class="name" data-open="${c.id}">${esc(c.nombre)}</a>
        <span class="pill ${c.pipeline}">${c.pipeline === "socio" ? "Socio" : "Cliente"}</span>
        ${pillEstado(c)}
        ${["Solicitud enviada", "Conectado", "Mensaje enviado"].includes(c.etapa) ? "" : `<span class="pill stage">${esc(c.etapa)}</span>`}
        ${c.empresa ? `<span class="small muted">${esc(c.empresa)}</span>` : ""}</div>
      <div class="acts">
        ${c.linkedin ? `<a class="btn sm" href="${esc(c.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>` : ""}
        ${c.etapa === "Solicitud enviada" ? `<button class="btn sm" data-act="acepto" data-id="${c.id}">Aceptó</button>` : ""}
        ${sugFrio ? `<button class="btn sm warn" data-act="frio" data-id="${c.id}">Pasar a Frío</button>` :
          c.etapa === "Solicitud enviada" ? "" : `<button class="btn sm" data-act="msg" data-id="${c.id}">Mensaje enviado</button>`}
        ${["Mensaje enviado", "Frío"].includes(c.etapa) ? `<button class="btn sm" data-act="resp" data-id="${c.id}">Respondió</button>` : ""}
      </div>
      <div class="what">${cuando}<strong>${esc(c.proximaAccion || "Definir siguiente paso")}</strong></div>
    </div>`;
  }

  function vistaHoy() {
    const pasa = (c) => !state.filtro || estadoDe(c) === state.filtro;
    const act = state.contactos.filter((c) => !CERRADAS.includes(c.etapa) && c.proximaFecha && pasa(c));
    const sort = (a, b) => a.proximaFecha.localeCompare(b.proximaFecha) || a.nombre.localeCompare(b.nombre);
    const venc = act.filter((c) => urgencia(c) === "due").sort(sort);
    const hoyL = act.filter((c) => urgencia(c) === "today").sort(sort);
    const sem = act.filter((c) => urgencia(c) === "week").sort(sort);
    const despues = act.filter((c) => urgencia(c) === "later").sort(sort);
    const sinFecha = state.contactos.filter((c) => !CERRADAS.includes(c.etapa) && !c.proximaFecha && pasa(c));
    const sec = (t, arr, vacio) => `<section><h2>${t} <span class="mono small muted">${arr.length}</span></h2>${arr.length ? arr.map(filaAgenda).join("") : `<div class="empty">${vacio}</div>`}</section>`;
    if (!state.contactos.length) return `<div class="empty">Todavía no hay contactos. Usa “+ Contacto” para agregar el primero.</div>`;
    return `<div class="agenda">
      ${sec("Vencidos", venc, "Nada vencido. Vas al día.")}
      ${sec("Hoy", hoyL, "Nada programado para hoy.")}
      ${sec("Próximos 7 días", sem, "Nada en los próximos 7 días.")}
      ${state.filtro && despues.length ? sec("Más adelante", despues, "") : ""}
      ${sinFecha.length ? sec("Sin siguiente paso", sinFecha, "") : ""}
    </div>`;
  }

  const PASOS = [["Solicitud", "fechaSolicitud"], ["Aceptó", "fechaAcepto"], ["Mensaje", "fechaMensaje"], ["Respondió", "fechaRespuesta"]];
  const ORDEN_EST = { respondio: 0, mensaje: 1, aceptado: 2, solicitud: 3 };
  function progreso(c) {
    const k = estadoDe(c);
    const alcanzado = { solicitud: 0, aceptado: 1, mensaje: 2, respondio: 3 }[k] ?? -1;
    return `<ol class="track">${PASOS.map(([lbl, campo], i) => {
      const f = c[campo];
      const cls = i < alcanzado || (i === alcanzado && i === 3) ? "done" : i === alcanzado ? "cur" : "todo";
      return `<li class="${cls}"><span class="dot"></span><span class="t">${lbl}</span><span class="fd">${f ? fmt(f) : i <= alcanzado ? "s/f" : "—"}</span></li>`;
    }).join("")}</ol>`;
  }
  function vistaProspectos() {
    const q = state.q.toLowerCase();
    const p = state.tipo || "";
    const lista = state.contactos.filter((c) => c.etapa !== "Descartado" && (!p || c.pipeline === p) && (!state.filtro || estadoDe(c) === state.filtro) && (!q || `${c.nombre} ${c.empresa} ${c.ubicacion} ${c.notas}`.toLowerCase().includes(q)));
    const orden = state.orden || "estado";
    lista.sort((a, b) => orden === "estado" ? (ORDEN_EST[estadoDe(a)] - ORDEN_EST[estadoDe(b)]) || (b.fechaSolicitud || "").localeCompare(a.fechaSolicitud || "") || a.nombre.localeCompare(b.nombre)
      : orden === "antiguos" ? (a.fechaSolicitud || "9").localeCompare(b.fechaSolicitud || "9") || a.nombre.localeCompare(b.nombre)
      : (b.fechaSolicitud || "").localeCompare(a.fechaSolicitud || "") || a.nombre.localeCompare(b.nombre));
    const descartados = state.contactos.filter((c) => c.etapa === "Descartado").length;
    const filas = lista.map((c) => {
      const dias = c.fechaSolicitud ? diffDays(hoy(), c.fechaSolicitud) : null;
      const u = urgencia(c);
      return `<tr data-open="${c.id}" class="clic">
        <td><div class="nm">${esc(c.nombre)}</div>${c.empresa ? `<div class="small muted ell">${esc(c.empresa)}</div>` : ""}</td>
        <td><span class="pill ${c.pipeline}">${c.pipeline === "socio" ? "Socio" : "Cliente"}</span></td>
        <td>${pillEstado(c)}<div class="small muted">${esc(c.etapa)}</div></td>
        <td>${progreso(c)}</td>
        <td class="num">${dias == null ? "—" : `${dias} d`}</td>
        <td>${c.proximaFecha && c.etapa !== "Descartado" ? `<span class="pill ${u === "due" ? "due" : u === "today" ? "today" : "stage"}">${u === "due" ? "Vencido" : u === "today" ? "Hoy" : fmt(c.proximaFecha)}</span>` : ""}<div class="small">${esc(c.proximaAccion)}</div></td>
      </tr>`;
    }).join("");
    return `<div style="display:grid;gap:12px">
      <div class="toolbar">
        <input type="search" id="q" placeholder="Buscar por nombre, empresa, ciudad o nota" value="${esc(state.q)}">
        <select id="selTipo" style="width:auto"><option value="">Socios y clientes</option><option value="socio" ${p === "socio" ? "selected" : ""}>Solo socios</option><option value="cliente" ${p === "cliente" ? "selected" : ""}>Solo clientes</option></select>
        <select id="selOrden" style="width:auto"><option value="estado" ${orden === "estado" ? "selected" : ""}>Ordenar por avance</option><option value="recientes" ${orden === "recientes" ? "selected" : ""}>Solicitud más reciente</option><option value="antiguos" ${orden === "antiguos" ? "selected" : ""}>Solicitud más antigua</option></select>
      </div>
      ${lista.length ? `<div class="tbl-wrap"><table class="prospectos"><thead><tr><th>Prospecto</th><th>Tipo</th><th>Estado</th><th>Avance y fechas</th><th class="num">Desde solicitud</th><th>Siguiente paso</th></tr></thead><tbody>${filas}</tbody></table></div>`
        : `<div class="empty">Ningún prospecto coincide con el filtro.</div>`}
      <p class="small muted">${lista.length} prospectos${descartados ? ` · ${descartados} descartados no se muestran` : ""}. Clic en una fila para abrir la ficha y corregir fechas.</p>
    </div>`;
  }

  function vistaTablero(p) {
    const q = state.q.toLowerCase();
    const lista = state.contactos.filter((c) => c.pipeline === p && (!state.filtro || estadoDe(c) === state.filtro) && (!q || `${c.nombre} ${c.empresa} ${c.ubicacion} ${c.notas}`.toLowerCase().includes(q)));
    const cols = ETAPAS[p].map((et) => {
      const cs = lista.filter((c) => c.etapa === et).sort((a, b) => (a.proximaFecha || "9").localeCompare(b.proximaFecha || "9"));
      return `<div class="col"><h3><span>${esc(et)}</span><span class="mono">${cs.length}</span></h3>
        ${cs.map((c) => { const u = urgencia(c); return `<button class="card" data-open="${c.id}">
          <span class="n">${esc(c.nombre)}</span>
          ${c.empresa ? `<span class="e">${esc(c.empresa)}</span>` : ""}
          <span class="d">${pillEstado(c)}</span>
          ${c.proximaFecha && !CERRADAS.includes(c.etapa) ? `<span class="d"><span class="pill ${u === "due" ? "due" : u === "today" ? "today" : "stage"}">${u === "due" ? "Vencido" : u === "today" ? "Hoy" : fmt(c.proximaFecha)}</span><span class="muted">${esc(c.proximaAccion)}</span></span>` : ""}
        </button>`; }).join("")}
      </div>`;
    }).join("");
    return `<div style="display:grid;gap:12px">
      <div class="toolbar"><input type="search" id="q" placeholder="Buscar por nombre, empresa, ciudad o nota" value="${esc(state.q)}"></div>
      <div class="board-wrap"><div class="board">${cols}</div></div></div>`;
  }

  const comision = (r) => Math.round((Number(r.honorarios) || 0) * (Number(r.comisionPct) || 0) / 100);

  function vistaReferidos() {
    const filas = [...state.referidos].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    const porSocio = {};
    for (const r of state.referidos) {
      const k = r.socioId || "?";
      porSocio[k] ||= { n: 0, hon: 0, com: 0, pend: 0 };
      porSocio[k].n++; porSocio[k].hon += Number(r.honorarios) || 0; porSocio[k].com += comision(r); if (!r.pagada) porSocio[k].pend += comision(r);
    }
    const opts = socios().concat(state.contactos.filter((c) => c.pipeline === "socio" && CERRADAS.includes(c.etapa)))
      .map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join("");
    return `<div style="display:grid;gap:16px">
      <div class="grid2">
        <form class="box" id="formRef">
          <h2>Registrar cliente referido</h2>
          <div class="fields">
            <label class="f full">Socio que refirió<select id="rSocio" required><option value="">Elige un socio…</option>${opts}</select></label>
            <label class="f full">Cliente referido<input id="rCliente" required placeholder="Nombre o empresa"></label>
            <label class="f">Fecha<input type="date" id="rFecha" value="${hoy()}"></label>
            <label class="f">Asunto<input id="rAsunto" placeholder="Ej. defensa fiscal"></label>
            <label class="f">Honorarios (MXN)<input type="number" min="0" step="100" id="rHon" placeholder="0"></label>
            <label class="f">Comisión %<input type="number" min="0" max="100" step="0.5" id="rPct" placeholder="Del acuerdo del socio"></label>
          </div>
          <div class="actions"><button class="btn primary" type="submit">Guardar referido</button></div>
        </form>
        <div class="box">
          <h2>Por socio</h2>
          ${Object.keys(porSocio).length ? `<div class="tbl-wrap"><table style="min-width:420px"><thead><tr><th>Socio</th><th class="num">Ref.</th><th class="num">Honorarios</th><th class="num">Por pagar</th></tr></thead><tbody>
            ${Object.entries(porSocio).map(([id, t]) => `<tr><td><a class="name" data-open="${id}" style="cursor:pointer">${esc(byId(id)?.nombre || "Socio eliminado")}</a></td><td class="num">${t.n}</td><td class="num">${money(t.hon)}</td><td class="num">${money(t.pend)}</td></tr>`).join("")}
          </tbody></table></div>` : `<div class="empty">Cuando un contador te pase un cliente, regístralo aquí. El % de comisión se toma de su ficha.</div>`}
        </div>
      </div>
      ${filas.length ? `<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Socio</th><th>Asunto</th><th class="num">Honorarios</th><th class="num">%</th><th class="num">Comisión</th><th>Pagada</th><th></th></tr></thead><tbody>
        ${filas.map((r) => `<tr><td class="mono">${fmt(r.fecha)}</td><td>${esc(r.cliente)}</td><td>${esc(byId(r.socioId)?.nombre || "—")}</td><td>${esc(r.asunto)}</td>
          <td class="num"><input type="number" min="0" step="100" value="${Number(r.honorarios) || 0}" data-ref-hon="${r.id}" style="width:110px;text-align:right"></td>
          <td class="num">${Number(r.comisionPct) || 0}%</td><td class="num">${money(comision(r))}</td>
          <td><input type="checkbox" ${r.pagada ? "checked" : ""} data-ref-pag="${r.id}" style="width:auto" aria-label="Comisión pagada"></td>
          <td><button class="btn sm warn" data-ref-del="${r.id}">Borrar</button></td></tr>`).join("")}
      </tbody></table></div>` : ""}
    </div>`;
  }

  function vistaPlantillas() {
    const ps = [...state.plantillas].sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));
    return `<div class="grid2">
      <div class="box">
        <h2>Tus mensajes</h2>
        <p class="small muted">Usa {nombre} y se reemplaza por el primer nombre del contacto al copiar desde su ficha.</p>
        ${ps.length ? ps.map((p) => `<div class="tpl">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><h3>${esc(p.nombre)}</h3>
            <span class="actions"><span class="pill ${p.pipeline === "socio" ? "socio" : p.pipeline === "cliente" ? "cliente" : "stage"}">${p.pipeline === "socio" ? "Socios" : p.pipeline === "cliente" ? "Clientes" : "Ambos"}</span>
            <button class="btn sm" data-tpl-edit="${p.id}">Editar</button><button class="btn sm" data-tpl-copy="${p.id}">Copiar</button></span></div>
          <pre>${esc(p.texto)}</pre></div>`).join("") : `<div class="empty">Aún no hay plantillas. Crea la primera con el formulario.</div>`}
      </div>
      <form class="box" id="formTpl">
        <h2 id="tplTitulo">Nueva plantilla</h2>
        <input type="hidden" id="tId">
        <label class="f">Nombre<input id="tNombre" required placeholder="Ej. Presentación a contador"></label>
        <label class="f">Para<select id="tPipe"><option value="socio">Socios contadores</option><option value="cliente">Clientes PyME</option><option value="ambos">Ambos</option></select></label>
        <label class="f">Texto<textarea id="tTexto" rows="9" required></textarea></label>
        <div class="actions"><button class="btn primary" type="submit">Guardar plantilla</button><button class="btn" type="button" id="tCancel">Limpiar</button><button class="btn warn" type="button" id="tDel" hidden>Borrar</button></div>
      </form>
    </div>`;
  }

  // ---------- Panel del contacto ----------
  function abrir(id) { state.abierto = id; $("#scrim").hidden = false; $("#panel").hidden = false; renderPanel(); }
  function cerrar() { state.abierto = null; $("#scrim").hidden = true; $("#panel").hidden = true; }

  function renderPanel() {
    const P = $("#panel");
    const nuevo = state.abierto === "__nuevo__";
    const c = nuevo ? { nombre: "", pipeline: "socio", etapa: "Solicitud enviada", historial: [] } : byId(state.abierto);
    if (!c) { cerrar(); return; }
    // No re-renderizar mientras se edita un campo del panel
    if (!nuevo && P.dataset.id === c.id && P.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    P.dataset.id = nuevo ? "__nuevo__" : c.id;
    const etapas = ETAPAS[c.pipeline] || ETAPAS.socio;
    const tpls = state.plantillas.filter((t) => t.pipeline === "ambos" || t.pipeline === c.pipeline);
    const u = urgencia(c);
    P.innerHTML = `
      <div class="panel-head">
        <div style="display:grid;gap:4px;min-width:0">
          <span class="eyebrow">${nuevo ? "Nuevo contacto" : (c.pipeline === "socio" ? "Socio contador" : "Cliente PyME")}</span>
          <h2>${esc(c.nombre) || "Sin nombre"}</h2>
          ${nuevo ? "" : `<div>${pillEstado(c)}</div>`}
          ${c.linkedin ? `<a href="${esc(c.linkedin)}" target="_blank" rel="noopener" class="small">Abrir perfil de LinkedIn ↗</a>` : ""}
        </div>
        <button class="btn" id="pCerrar" aria-label="Cerrar">Cerrar</button>
      </div>
      ${nuevo ? "" : `
      <div class="next">
        <span class="eyebrow">Siguiente paso</span>
        <div><strong>${esc(c.proximaAccion || "Sin definir")}</strong></div>
        <div class="small">${c.proximaFecha ? `<span class="pill ${u === "due" ? "due" : u === "today" ? "today" : "stage"}">${fmt(c.proximaFecha)}</span>` : ""}
          ${c.etapa === "Mensaje enviado" ? `<span class="muted"> · ${c.toques || 0} de ${CADENCIA.length} mensajes sin respuesta</span>` : ""}</div>
      </div>
      <div class="actions">
        ${c.etapa === "Solicitud enviada" ? `<button class="btn primary" data-act="acepto" data-id="${c.id}">Aceptó solicitud</button>` : `<button class="btn primary" data-act="msg" data-id="${c.id}">Mensaje enviado</button>`}
        <button class="btn" data-act="resp" data-id="${c.id}">Respondió</button>
        <button class="btn" id="pReunionBtn">Agendar reunión</button>
        ${c.pipeline === "socio" ? `<button class="btn" id="pRefBtn">Registrar referido</button>` : ""}
      </div>
      <div class="sub" id="pReunion" hidden>
        <h3>Reunión con ${esc(primerNombre(c.nombre))}</h3>
        <div class="fields">
          <label class="f">Fecha<input type="date" id="mFecha" value="${addDays(hoy(), 2)}"></label>
          <label class="f">Hora<input type="time" id="mHora" value="10:00"></label>
          <label class="f">Duración<select id="mDur"><option value="30">30 min</option><option value="45">45 min</option><option value="60" selected>1 hora</option></select></label>
          <label class="f">Modalidad<select id="mMeet"><option value="meet">Google Meet</option><option value="presencial">Presencial</option></select></label>
          <label class="f full">Correo del invitado (opcional)<input type="email" id="mEmail" value="${esc(c.email || "")}" placeholder="Si lo pones, se agrega como invitado"></label>
          <label class="f full">Lugar / notas<input id="mLugar" placeholder="Ej. sus oficinas en Coyoacán"></label>
        </div>
        <div class="actions"><button class="btn primary" id="mCrear">Abrir en Google Calendar</button><button class="btn" id="mSolo">Solo registrar aquí</button></div>
        <p class="small muted" id="mNota">Se abre Google Calendar con el evento prellenado; guárdalo ahí. El contacto pasa a la etapa Reunión.</p>
      </div>
      ${tpls.length ? `<div class="sub"><h3>Copiar mensaje</h3>
        <div class="toolbar"><select id="pTpl">${tpls.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join("")}</select><button class="btn" id="pTplCopy">Copiar para ${esc(primerNombre(c.nombre))}</button></div></div>` : ""}
      `}
      <form class="sub" id="pForm">
        <div class="fields">
          <label class="f full">Nombre<input id="fNombre" value="${esc(c.nombre)}" required></label>
          <label class="f">Tipo<select id="fPipe">
            <option value="socio" ${c.pipeline === "socio" ? "selected" : ""}>Socio contador / conector</option>
            <option value="cliente" ${c.pipeline === "cliente" ? "selected" : ""}>Cliente PyME</option></select></label>
          <label class="f">Etapa<select id="fEtapa">${etapas.map((e) => `<option ${e === c.etapa ? "selected" : ""}>${e}</option>`).join("")}</select></label>
          <label class="f full">Puesto / empresa<input id="fEmpresa" value="${esc(c.empresa)}"></label>
          <label class="f">Ubicación<input id="fUbic" value="${esc(c.ubicacion)}"></label>
          <label class="f">Perfil<input id="fSub" value="${esc(c.subtipo)}" placeholder="Ej. fiscalista independiente"></label>
          <label class="f full">LinkedIn<input id="fLink" type="url" value="${esc(c.linkedin)}"></label>
          <label class="f">Correo<input id="fEmail" type="email" value="${esc(c.email)}"></label>
          <label class="f">Teléfono / WhatsApp<input id="fTel" value="${esc(c.telefono)}"></label>
          <label class="f">Siguiente acción<input id="fAccion" value="${esc(c.proximaAccion)}"></label>
          <label class="f">Fecha<input id="fFecha" type="date" value="${esc(c.proximaFecha)}"></label>
          ${c.pipeline === "socio" ? `<label class="f">Comisión acordada %<input id="fPct" type="number" min="0" max="100" step="0.5" value="${c.comisionPct ?? ""}" placeholder="Ej. 10"></label>` : `<label class="f">Referido por<select id="fRefPor"><option value="">Nadie / directo</option>${socios().map((s) => `<option value="${s.id}" ${c.referidoPor === s.id ? "selected" : ""}>${esc(s.nombre)}</option>`).join("")}</select></label>`}
          <label class="f">Solicitud enviada<input id="fFSol" type="date" value="${esc(c.fechaSolicitud ?? (nuevo ? hoy() : ""))}"></label>
          <label class="f">Aceptó<input id="fFAce" type="date" value="${esc(c.fechaAcepto)}"></label>
          <label class="f">Primer mensaje<input id="fFMsg" type="date" value="${esc(c.fechaMensaje)}"></label>
          <label class="f">Respondió<input id="fFRes" type="date" value="${esc(c.fechaRespuesta)}"></label>
          <label class="f full">Notas<textarea id="fNotas">${esc(c.notas)}</textarea></label>
        </div>
        <div class="actions"><button class="btn primary" type="submit">${nuevo ? "Crear contacto" : "Guardar cambios"}</button>${nuevo ? "" : `<button class="btn warn" type="button" id="pBorrar">Borrar contacto</button>`}</div>
        <p class="small muted" id="pBorrarConf" hidden>¿Seguro? <button class="btn sm warn" type="button" id="pBorrarSi">Sí, borrar</button></p>
      </form>
      ${nuevo ? "" : `<div class="sub"><h3>Historial</h3>
        <div class="toolbar"><input id="hNota" placeholder="Agregar nota (llamada, comentario, etc.)"><button class="btn" id="hAdd">Agregar</button></div>
        <div class="hist">${[...(c.historial || [])].reverse().map((h) => `<div><time>${fmt(h.fecha)}</time><span>${esc(h.texto)}</span></div>`).join("") || `<span class="muted small">Sin movimientos.</span>`}</div></div>`}
    `;
    wirePanel(c, nuevo);
  }

  function wirePanel(c, nuevo) {
    $("#pCerrar").onclick = cerrar;
    $("#fPipe").onchange = (e) => {
      const et = ETAPAS[e.target.value];
      const sel = $("#fEtapa"); const cur = sel.value;
      sel.innerHTML = et.map((x) => `<option ${x === cur ? "selected" : ""}>${x}</option>`).join("");
    };
    $("#fEtapa").onchange = (e) => {
      const [d, a] = DEFAULTS[e.target.value] || [null, ""];
      $("#fAccion").value = a; $("#fFecha").value = d == null ? "" : addDays(hoy(), d);
    };
    $("#pForm").onsubmit = async (e) => {
      e.preventDefault();
      const data = {
        nombre: $("#fNombre").value.trim(), pipeline: $("#fPipe").value, etapa: $("#fEtapa").value,
        empresa: $("#fEmpresa").value.trim(), ubicacion: $("#fUbic").value.trim(), subtipo: $("#fSub").value.trim(),
        linkedin: $("#fLink").value.trim(), email: $("#fEmail").value.trim(), telefono: $("#fTel").value.trim(),
        proximaAccion: $("#fAccion").value.trim(), proximaFecha: $("#fFecha").value, notas: $("#fNotas").value,
        fechaSolicitud: $("#fFSol").value, fechaAcepto: $("#fFAce").value, fechaMensaje: $("#fFMsg").value, fechaRespuesta: $("#fFRes").value,
      };
      if ($("#fPct")) data.comisionPct = $("#fPct").value === "" ? null : Number($("#fPct").value);
      if ($("#fRefPor")) data.referidoPor = $("#fRefPor").value;
      if (!data.nombre) return;
      if (nuevo) {
        if (!state.db) { toast("Sin conexión a la base de datos"); return; }
        try {
          const ref = await state.db.collection("contactos").add({ ...data, toques: 0, primerMensaje: "", alta: hoy(), fechaSolicitud: data.fechaSolicitud || (data.etapa === "Solicitud enviada" ? hoy() : ""), actualizado: hoy(), historial: [{ fecha: hoy(), texto: `Alta en ${data.etapa}` }] });
          state.abierto = ref.id; toast("Contacto creado");
        } catch (err) { toast("No se pudo crear: " + (err.code || err.message)); }
      } else {
        if (data.etapa !== c.etapa && data.etapa !== "Mensaje enviado") { data.toques = 0; data.primerMensaje = ""; }
        $("#panel").dataset.id = "";
        await guardar(c.id, data, data.etapa !== c.etapa ? `Etapa: ${c.etapa} → ${data.etapa}` : null);
        toast("Guardado");
      }
    };
    if (nuevo) return;
    $("#pBorrar").onclick = () => ($("#pBorrarConf").hidden = false);
    $("#pBorrarSi").onclick = async () => { try { await state.db.collection("contactos").doc(c.id).delete(); cerrar(); toast("Contacto borrado"); } catch (e) { toast("No se pudo borrar"); } };
    $("#hAdd").onclick = async () => { const t = $("#hNota").value.trim(); if (!t) return; $("#hNota").value = ""; $("#panel").dataset.id = ""; await guardar(c.id, { ultimoContacto: hoy() }, t); };
    $("#pReunionBtn").onclick = () => { const s = $("#pReunion"); s.hidden = !s.hidden; };
    if ($("#pRefBtn")) $("#pRefBtn").onclick = () => { cerrar(); state.tab = "referidos"; render(); $("#rSocio").value = c.id; $("#rPct").value = c.comisionPct ?? ""; $("#rCliente").focus(); };
    if ($("#pTplCopy")) $("#pTplCopy").onclick = () => {
      const t = state.plantillas.find((x) => x.id === $("#pTpl").value); if (!t) return;
      copiar(t.texto.replaceAll("{nombre}", primerNombre(c.nombre)));
    };
    const registrarReunion = async (fecha, hora, extra) => {
      $("#panel").dataset.id = "";
      await guardar(c.id, { etapa: "Reunión", toques: 0, primerMensaje: "", proximaFecha: fecha, proximaAccion: `Reunión ${hora}`, ultimoContacto: hoy() }, `Reunión agendada ${fmt(fecha)} ${hora}${extra ? " · " + extra : ""}`);
    };
    $("#mSolo").onclick = async () => { await registrarReunion($("#mFecha").value, $("#mHora").value, ""); toast("Reunión registrada"); };
    $("#mCrear").onclick = async () => {
      const fecha = $("#mFecha").value, hora = $("#mHora").value, dur = Number($("#mDur").value);
      if (!fecha || !hora) return;
      const [h, m] = hora.split(":").map(Number);
      const finMin = h * 60 + m + dur;
      const stamp = (f, mins) => { const d = addDays(f, Math.floor(mins / 1440)); const mm = mins % 1440; return `${d.replaceAll("-", "")}T${pad(Math.floor(mm / 60))}${pad(mm % 60)}00`; };
      const meet = $("#mMeet").value === "meet";
      const lugar = $("#mLugar").value.trim();
      const email = $("#mEmail").value.trim();
      const detalles = `${c.pipeline === "socio" ? "Reunión con contador (posible socio referidor)" : "Reunión con prospecto PyME"}${c.empresa ? "\n" + c.empresa : ""}${c.linkedin ? "\n" + c.linkedin : ""}${meet ? "\n\nAgrega videollamada de Google Meet antes de guardar." : ""}`;
      const p = new URLSearchParams({ action: "TEMPLATE", text: `Ibarra Quezada · ${c.nombre}`, dates: `${stamp(fecha, h * 60 + m)}/${stamp(fecha, finMin)}`, ctz: "America/Mexico_City", details: detalles });
      if (lugar) p.set("location", lugar);
      if (email) p.set("add", email);
      window.open(`https://calendar.google.com/calendar/render?${p.toString()}`, "_blank", "noopener");
      if (email && email !== c.email) await guardar(c.id, { email });
      await registrarReunion(fecha, hora, "Google Calendar");
      toast("Se abrió Google Calendar. Guarda el evento ahí.");
    };
  }

  // ---------- Eventos globales ----------
  document.addEventListener("click", async (e) => {
    const f = e.target.closest("[data-filtro]");
    if (f) { const k = f.dataset.filtro; state.filtro = state.filtro === k ? "" : k; if (!["prospectos", "hoy", "socio", "cliente"].includes(state.tab)) state.tab = "prospectos"; render(); return; }
    const t = e.target.closest("[data-tab],[data-open],[data-act],[data-tpl-edit],[data-tpl-copy],[data-ref-del]");
    if (!t) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; try { localStorage.setItem("iq-tab", state.tab); } catch (err) {} render(); return; }
    if (t.dataset.open) { abrir(t.dataset.open); return; }
    if (t.dataset.act) {
      const c = byId(t.dataset.id); if (!c) return;
      $("#panel").dataset.id = "";
      if (t.dataset.act === "msg") await mensajeEnviado(c);
      else if (t.dataset.act === "resp") await respondio(c);
      else if (t.dataset.act === "acepto") { await guardar(c.id, { ...cambiosDeEtapa(c, "Conectado"), fechaAcepto: hoy() }, "Aceptó la solicitud"); toast("Conectado: toca mandarle mensaje hoy"); }
      else if (t.dataset.act === "frio") { await moverEtapa(c, "Frío", "Sin respuesta tras 3 mensajes"); toast("Movido a Frío. Reintento en 60 días."); }
      return;
    }
    if (t.dataset.tplCopy) { const p = state.plantillas.find((x) => x.id === t.dataset.tplCopy); if (p) copiar(p.texto); return; }
    if (t.dataset.tplEdit) {
      const p = state.plantillas.find((x) => x.id === t.dataset.tplEdit); if (!p) return;
      $("#tId").value = p.id; $("#tNombre").value = p.nombre; $("#tPipe").value = p.pipeline || "ambos"; $("#tTexto").value = p.texto;
      $("#tplTitulo").textContent = "Editar plantilla"; $("#tDel").hidden = false; $("#tNombre").focus(); return;
    }
    if (t.dataset.refDel) { try { await state.db.collection("referidos").doc(t.dataset.refDel).delete(); toast("Referido borrado"); } catch (err) { toast("No se pudo borrar"); } }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "q") { state.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $("#q"); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }
  });

  document.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.id === "selTipo") { state.tipo = el.value; render(); return; }
    if (el.id === "selOrden") { state.orden = el.value; render(); return; }
    if (el.id === "rSocio") { const s = byId(el.value); if (s && s.comisionPct != null) $("#rPct").value = s.comisionPct; }
    if (el.dataset.refPag) { try { await state.db.collection("referidos").doc(el.dataset.refPag).update({ pagada: el.checked }); } catch (err) { toast("No se pudo guardar"); } }
    if (el.dataset.refHon) { try { await state.db.collection("referidos").doc(el.dataset.refHon).update({ honorarios: Number(el.value) || 0 }); } catch (err) { toast("No se pudo guardar"); } }
  });

  document.addEventListener("submit", async (e) => {
    if (e.target.id === "formRef") {
      e.preventDefault(); if (!state.db) return;
      const data = { socioId: $("#rSocio").value, cliente: $("#rCliente").value.trim(), fecha: $("#rFecha").value || hoy(), asunto: $("#rAsunto").value.trim(), honorarios: Number($("#rHon").value) || 0, comisionPct: Number($("#rPct").value) || 0, pagada: false };
      if (!data.socioId || !data.cliente) return;
      try {
        await state.db.collection("referidos").add(data);
        const s = byId(data.socioId);
        if (s) await guardar(s.id, s.etapa === "Acuerdo firmado" ? cambiosDeEtapa(s, "Refiriendo") : {}, `Refirió a ${data.cliente}`);
        toast("Referido registrado");
      } catch (err) { toast("No se pudo guardar: " + (err.code || err.message)); }
    }
    if (e.target.id === "formTpl") {
      e.preventDefault(); if (!state.db) return;
      const id = $("#tId").value;
      const data = { nombre: $("#tNombre").value.trim(), pipeline: $("#tPipe").value, texto: $("#tTexto").value };
      try {
        if (id) await state.db.collection("plantillas").doc(id).update(data);
        else await state.db.collection("plantillas").add({ ...data, orden: state.plantillas.length + 1 });
        toast("Plantilla guardada");
      } catch (err) { toast("No se pudo guardar"); }
    }
  });

  document.addEventListener("click", async (e) => {
    if (e.target.id === "tCancel") { $("#formTpl").reset(); $("#tId").value = ""; $("#tplTitulo").textContent = "Nueva plantilla"; $("#tDel").hidden = true; }
    if (e.target.id === "tDel") { const id = $("#tId").value; if (!id) return; try { await state.db.collection("plantillas").doc(id).delete(); toast("Plantilla borrada"); } catch (err) { toast("No se pudo borrar"); } }
  });

  $("#scrim").onclick = cerrar;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.abierto) cerrar(); });
  $("#btnNuevo").onclick = () => abrir("__nuevo__");

  // ---------- Supabase ----------
  const TABLAS = { contactos: "crm_contactos", plantillas: "crm_plantillas", referidos: "crm_referidos" };
  const SNAKE = { proximaAccion: "proxima_accion", proximaFecha: "proxima_fecha", fechaSolicitud: "fecha_solicitud", fechaAcepto: "fecha_acepto", fechaMensaje: "fecha_mensaje", fechaRespuesta: "fecha_respuesta", primerMensaje: "primer_mensaje", ultimoContacto: "ultimo_contacto", comisionPct: "comision_pct", referidoPor: "referido_por", socioId: "socio_id" };
  const CAMEL = Object.fromEntries(Object.entries(SNAKE).map(([k, v]) => [v, k]));
  const NULLABLES = new Set(["proxima_fecha", "fecha_solicitud", "fecha_acepto", "fecha_mensaje", "fecha_respuesta", "primer_mensaje", "ultimo_contacto", "referido_por", "socio_id", "fecha", "alta"]);
  const toRow = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) { if (k === "id") continue; const sk = SNAKE[k] || k; r[sk] = NULLABLES.has(sk) && v === "" ? null : v; } return r; };
  const fromRow = (r) => { const o = {}; for (const [k, v] of Object.entries(r)) { const ck = CAMEL[k] || k; o[ck] = NULLABLES.has(k) && v == null ? "" : v; } return o; };
  const sb = window.supabase.createClient(window.IQ_CONFIG.supabaseUrl, window.IQ_CONFIG.supabaseKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } });
  const chk = ({ data, error }) => { if (error) throw { code: error.code, message: error.message }; return data; };

  async function cargar() {
    try {
      const [c, p, r] = await Promise.all([
        sb.from(TABLAS.contactos).select("*").order("nombre"),
        sb.from(TABLAS.plantillas).select("*").order("orden"),
        sb.from(TABLAS.referidos).select("*").order("fecha", { ascending: false }),
      ].map((q) => q.then(chk)));
      state.contactos = c.map(fromRow); state.plantillas = p.map(fromRow); state.referidos = r.map(fromRow);
      state.cargado = true;
      $("#status").textContent = `Actualizado ${new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
      if (!state.contactos.length && !state.plantillas.length) {
        const b = $("#banner"); b.hidden = false; b.textContent = "No ves datos. Si es tu primera vez, verifica que tu correo esté autorizado para usar el CRM.";
      } else $("#banner").hidden = true;
    } catch (e) {
      state.cargado = true;
      $("#status").textContent = "Error al cargar";
      const b = $("#banner"); b.hidden = false; b.textContent = "No se pudieron cargar los datos: " + (e.message || e.code);
    }
    render();
  }

  state.db = {
    collection: (name) => ({
      doc: (id) => ({
        update: async (d) => { chk(await sb.from(TABLAS[name]).update(toRow(d)).eq("id", id)); await cargar(); },
        delete: async () => { chk(await sb.from(TABLAS[name]).delete().eq("id", id)); await cargar(); },
      }),
      add: async (d) => { const r = chk(await sb.from(TABLAS[name]).insert(toRow(d)).select("id").single()); await cargar(); return { id: r.id }; },
    }),
  };

  // ---------- Acceso ----------
  let iniciado = false;
  function mostrar(session) {
    $("#loginView").hidden = !!session;
    $("#appView").hidden = !session;
    if (session && !iniciado) { iniciado = true; render(); cargar(); }
    if (!session) { iniciado = false; state.cargado = false; state.contactos = []; state.plantillas = []; state.referidos = []; cerrar(); }
  }
  const loginMsg = (t) => ($("#loginMsg").textContent = t);
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim(), password = $("#loginPass").value;
    if (!email) return;
    if (!password) { loginMsg("Escribe tu contraseña, o usa “Mandarme un link por correo”."); return; }
    $("#loginBtn").disabled = true; loginMsg("Entrando…");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    $("#loginBtn").disabled = false;
    loginMsg(error ? (error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : `No se pudo entrar: ${error.message}`) : "");
  };
  $("#linkBtn").onclick = async () => {
    const email = $("#loginEmail").value.trim(); if (!email) { loginMsg("Escribe tu correo primero."); return; }
    $("#linkBtn").disabled = true; loginMsg("Enviando…");
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
    $("#linkBtn").disabled = false;
    loginMsg(error ? (/rate limit/i.test(error.message) ? "Se alcanzó el límite de correos por hora. Entra con tu contraseña o intenta más tarde." : `No se pudo enviar el link: ${error.message}`) : "Listo. Revisa tu correo y abre el link desde este mismo navegador.");
  };
  $("#btnPass").onclick = () => { $("#passForm").hidden = !$("#passForm").hidden; $("#passMsg").textContent = ""; };
  $("#passCancel").onclick = () => { $("#passForm").hidden = true; };
  $("#passForm").onsubmit = async (e) => {
    e.preventDefault();
    const password = $("#newPass").value;
    if (password.length < 8) { $("#passMsg").textContent = "Usa al menos 8 caracteres."; return; }
    const { error } = await sb.auth.updateUser({ password });
    if (error) { $("#passMsg").textContent = `No se pudo cambiar: ${error.message}`; return; }
    $("#newPass").value = ""; $("#passForm").hidden = true; toast("Contraseña actualizada");
  };
  $("#btnSalir").onclick = () => sb.auth.signOut();
  sb.auth.onAuthStateChange((_ev, session) => mostrar(session));
  sb.auth.getSession().then(({ data }) => mostrar(data.session));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && iniciado) cargar(); });
})();
