// Edge Function: conecta la cuenta de Google Health (Fitbit Air) de cada usuario autorizado y
// sincroniza sus métricas diarias a public.salud_dias.
//
// POST (con la sesión de Supabase del usuario): { accion: "estado" | "conectar" | "sincronizar" | "fcReciente" | "sesion" | "desconectar" }
// GET  ?code=…&state=…  → regreso de Google OAuth (la redirect URI registrada es la URL de esta función)
// POST con header x-cron-secret → sincroniza a todos los conectados (para pg_cron)
//
// Secretos: GOOGLE_CLIENT_SECRET (y GOOGLE_CLIENT_ID para usar otro cliente). Opcionales: SALUD_CRON_SECRET, SALUD_STATE_SECRET (por default se usa
// la service role key para firmar), SALUD_APP_URL (por default se regresa al sitio desde donde se pidió conectar).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  API, AUTH_URL, TOKEN_URL, SCOPES, DIARIOS, Dias, civil, filtroDiario, fusionar,
  leerAzm, leerDiario, leerPasos, leerSueno, resumirFc, resumirSesion, sumarDias,
} from "./google.ts";

// trim: un espacio o salto de línea al pegar el secreto en el panel hace que Google responda invalid_client
const env = (k: string) => (Deno.env.get(k) || "").trim();
const SUPABASE_URL = env("SUPABASE_URL");
const REDIRECT = env("SALUD_REDIRECT_URI") || `${SUPABASE_URL}/functions/v1/fitbit-sync`;
const APP_URL = env("SALUD_APP_URL");
const db = createClient(SUPABASE_URL, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const volverA = (destino: string, params: Record<string, string>) => {
  const app = destino || APP_URL;
  return app ? Response.redirect(`${app}${app.includes("?") ? "&" : "?"}${new URLSearchParams(params)}`, 302) : json({ error: "No se sabe a dónde regresar; define SALUD_APP_URL", ...params }, 400);
};
// El client ID no es secreto (viaja en la URL de Google); el secreto GOOGLE_CLIENT_ID solo lo reemplaza si tiene forma válida
const FORMATO_CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const clientId = () => (FORMATO_CLIENT_ID.test(env("GOOGLE_CLIENT_ID")) ? env("GOOGLE_CLIENT_ID") : "576433418475-a0etd07gaq0ncbnbpsn46f2ajaq66m9k.apps.googleusercontent.com");
const faltaConfig = () => ["GOOGLE_CLIENT_SECRET"].filter((k) => !env(k));
// Página a la que se regresa después de Google: el sitio que pidió conectar (https, o localhost para pruebas)
const appDesde = (req: Request) => {
  const o = req.headers.get("Origin") || "";
  return /^https:\/\/[\w.-]+$|^http:\/\/localhost(:\d+)?$/.test(o) ? `${o}/fitbit-air/` : APP_URL;
};
// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

// ---------- Acceso ----------
async function autorizado(email: string) {
  const { data, error } = await db.from("crm_usuarios").select("email");
  if (error) throw error;
  return (data || []).some((u) => u.email.toLowerCase() === email.toLowerCase());
}

async function usuario(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return "";
  const { data } = await db.auth.getUser(jwt);
  const email = data.user?.email?.toLowerCase() || "";
  return email && (await autorizado(email)) ? email : "";
}

// state firmado (HMAC) para que el regreso de Google solo se acepte si salió de un usuario autorizado
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const deB64url = (s: string) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
const llave = () => crypto.subtle.importKey("raw", new TextEncoder().encode(env("SALUD_STATE_SECRET") || env("SUPABASE_SERVICE_ROLE_KEY")), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
async function crearState(email: string, app: string) {
  const carga = b64url(new TextEncoder().encode(JSON.stringify({ e: email, a: app, t: Date.now() })));
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", await llave(), new TextEncoder().encode(carga)));
  return `${carga}.${b64url(firma)}`;
}
async function leerState(state: string): Promise<{ email: string; app: string }> {
  const nada = { email: "", app: "" };
  const [carga, firma] = state.split(".");
  if (!carga || !firma) return nada;
  try {
    const ok = await crypto.subtle.verify("HMAC", await llave(), deB64url(firma), new TextEncoder().encode(carga));
    if (!ok) return nada;
    const { e, a, t } = JSON.parse(new TextDecoder().decode(deB64url(carga)));
    return Date.now() - t < 15 * 60 * 1000 ? { email: String(e), app: String(a || "") } : nada;
  } catch {
    return nada;
  }
}

// ---------- OAuth con Google ----------
async function token(params: Record<string, string>) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: env("GOOGLE_CLIENT_SECRET"), ...params }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error_description || data.error || `token ${r.status}`);
  return data;
}

async function accessToken(con: Obj) {
  if (con.access_token && con.expira && Date.parse(con.expira) - Date.now() > 60_000) return con.access_token as string;
  let t;
  try { t = await token({ grant_type: "refresh_token", refresh_token: con.refresh_token }); }
  catch (e) {
    await db.from("salud_conexion").update({ error: "Google rechazó el acceso; vuelve a conectar tu cuenta." }).eq("email", con.email);
    throw e;
  }
  const cambios: Obj = { access_token: t.access_token, expira: new Date(Date.now() + t.expires_in * 1000).toISOString() };
  if (t.refresh_token) cambios.refresh_token = t.refresh_token;
  await db.from("salud_conexion").update(cambios).eq("email", con.email);
  Object.assign(con, cambios);
  return t.access_token as string;
}

async function google(at: string, ruta: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${ruta}`, { ...init, headers: { Authorization: `Bearer ${at}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const razon = data.error?.details?.find?.((d: Obj) => d.reason)?.reason;
    throw new Error(razon === "ACCOUNT_NOT_LINKED" ? "Vincula Google Health con tu cuenta de Google desde la app Google Health y vuelve a conectar." : `${ruta.split("?")[0]}: ${data.error?.message || r.status}`);
  }
  return data;
}

async function lista(at: string, tipo: string, filtro: string, pageSize: number) {
  const out: Obj[] = [];
  let pageToken = "";
  for (let i = 0; i < 40; i++) {
    const q = new URLSearchParams({ filter: filtro, pageSize: String(pageSize) });
    if (pageToken) q.set("pageToken", pageToken);
    const d = await google(at, `/dataTypes/${tipo}/dataPoints?${q}`);
    out.push(...(d.dataPoints || []));
    pageToken = d.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

async function rollupDiario(at: string, tipo: string, desde: string, hasta: string) {
  const out: Obj[] = [];
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const body: Obj = { range: { start: civil(desde), end: civil(hasta) }, windowSizeDays: 1 };
    if (pageToken) body.pageToken = pageToken;
    const d = await google(at, `/dataTypes/${tipo}/dataPoints:dailyRollUp`, { method: "POST", body: JSON.stringify(body) });
    out.push(...(d.rollupDataPoints || []));
    pageToken = d.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

// ---------- Sincronización ----------
async function sincronizar(email: string, numDias: number) {
  const { data: con } = await db.from("salud_conexion").select("*").eq("email", email).maybeSingle();
  if (!con) throw new Error("No hay cuenta de Google Health conectada.");
  const at = await accessToken(con);
  // Rango en fechas UTC con un día de margen para cubrir cualquier zona horaria; dailyRollUp admite máx. 90 días
  const hoy = new Date().toISOString().slice(0, 10);
  const n = Math.max(1, Math.min(88, Math.round(numDias) || 7));
  const desde = sumarDias(hoy, -n), hasta = sumarDias(hoy, 2);
  const dias = new Dias();
  const tareas: [string, () => Promise<void>][] = [
    ["pasos", async () => leerPasos(dias, await rollupDiario(at, "steps", desde, hasta))],
    ["minutos en zona", async () => leerAzm(dias, await lista(at, "active-zone-minutes", `active_zone_minutes.interval.civil_start_time >= "${desde}T00:00:00" AND active_zone_minutes.interval.civil_start_time < "${hasta}T00:00:00"`, 10000))],
    ["sueño", async () => leerSueno(dias, await lista(at, "sleep", `sleep.interval.civil_end_time >= "${desde}"`, 25))],
    ...DIARIOS.map((def): [string, () => Promise<void>] => [def.tipo, async () => leerDiario(dias, await lista(at, def.tipo, filtroDiario(def.tipo, desde, hasta), 1000), def)]),
  ];
  const res = await Promise.allSettled(tareas.map(([, f]) => f()));
  const errores = res.flatMap((r, i) => (r.status === "rejected" ? [`${tareas[i][0]}: ${(r.reason as Error)?.message || r.reason}`] : []));
  if (errores.length === tareas.length) {
    await db.from("salud_conexion").update({ error: errores[0] }).eq("email", email);
    throw new Error(errores[0]);
  }
  const nuevos = dias.lista();
  if (nuevos.length) {
    const { data: viejos, error } = await db.from("salud_dias").select("*").eq("email", email).in("fecha", nuevos.map((d) => d.fecha));
    if (error) throw error;
    const porFecha = new Map((viejos || []).map((v) => [v.fecha, v]));
    const filas = nuevos.map((d) => ({ ...fusionar(porFecha.get(d.fecha), d), email, actualizado: new Date().toISOString() }));
    const { error: e2 } = await db.from("salud_dias").upsert(filas, { onConflict: "email,fecha" });
    if (e2) throw e2;
  }
  await db.from("salud_conexion").update({ ultima_sync: new Date().toISOString(), error: errores.join(" · ") }).eq("email", email);
  return { dias: nuevos.length, errores };
}

// ---------- Rutas ----------
async function regresoDeGoogle(url: URL) {
  const { email, app } = await leerState(url.searchParams.get("state") || "");
  const volver = (params: Record<string, string>) => volverA(app, params);
  if (!email || !(await autorizado(email))) return volver({ fitbit: "error", motivo: "La solicitud expiró o no es válida. Intenta de nuevo." });
  if (url.searchParams.get("error")) return volver({ fitbit: "error", motivo: "Se canceló el permiso en Google." });
  try {
    const t = await token({ grant_type: "authorization_code", code: url.searchParams.get("code") || "", redirect_uri: REDIRECT });
    if (!t.refresh_token) return volver({ fitbit: "error", motivo: "Google no entregó acceso permanente. Quita el acceso en myaccount.google.com/permissions y conecta de nuevo." });
    const faltan = SCOPES.filter((s) => !String(t.scope || "").includes(s));
    const identidad = await google(t.access_token, "/identity").catch(() => ({}));
    const { error } = await db.from("salud_conexion").upsert({
      email, refresh_token: t.refresh_token, access_token: t.access_token,
      expira: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      health_user_id: identidad.healthUserId || "", scopes: t.scope || "", conectado: new Date().toISOString(), error: "",
    });
    if (error) throw error;
    const r = await sincronizar(email, 45).catch((e) => ({ dias: 0, errores: [String(e.message || e)] }));
    return volver({ fitbit: "ok", dias: String(r.dias), ...(faltan.length || r.errores.length ? { aviso: [faltan.length ? "No se otorgaron todos los permisos." : "", ...r.errores].filter(Boolean).join(" · ") } : {}) });
  } catch (e) {
    return volver({ fitbit: "error", motivo: String((e as Error).message || e) });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  try {
    if (req.method === "GET" && (url.searchParams.has("code") || url.searchParams.has("error"))) return await regresoDeGoogle(url);
    // Diagnóstico sin datos sensibles: el client ID es público (va en la URL de Google); del secreto solo se ve su forma
    if (req.method === "GET" && url.searchParams.has("diagnostico")) {
      const id = env("GOOGLE_CLIENT_ID"), sec = env("GOOGLE_CLIENT_SECRET");
      const idOk = FORMATO_CLIENT_ID.test(id);
      return json({
        clientId: clientId(),
        // Si el secreto GOOGLE_CLIENT_ID no tiene forma de client ID (p. ej. se pegó otra cosa), no se muestra completo
        secretoClientId: id ? (idOk ? id : `${id.slice(0, 4)}… (${id.length} caracteres, se ignora)`) : "", clientIdFormatoOk: idOk,
        secretoLargo: sec.length, secretoFormatoOk: /^GOCSPX-[\w-]{20,}$/.test(sec), redirectUri: REDIRECT,
      });
    }
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    const body = await req.json().catch(() => ({}));

    const cron = env("SALUD_CRON_SECRET");
    if (cron && req.headers.get("x-cron-secret") === cron) {
      const { data } = await db.from("salud_conexion").select("email");
      const res = await Promise.allSettled((data || []).map((c) => sincronizar(c.email, 4)));
      return json({ ok: res.filter((r) => r.status === "fulfilled").length, fallidos: res.filter((r) => r.status === "rejected").length });
    }

    const email = await usuario(req);
    if (!email) return json({ error: "No autorizado" }, 401);

    if (body.accion === "estado") {
      const { data } = await db.from("salud_conexion").select("conectado, ultima_sync, error, health_user_id").eq("email", email).maybeSingle();
      return json({ conectado: !!data, ultimaSync: data?.ultima_sync || null, error: data?.error || "", faltaConfig: faltaConfig() });
    }
    if (body.accion === "conectar") {
      if (faltaConfig().length) return json({ error: `Falta configurar en Supabase: ${faltaConfig().join(", ")}` }, 503);
      const q = new URLSearchParams({
        client_id: clientId(), redirect_uri: REDIRECT, response_type: "code", scope: SCOPES.join(" "),
        access_type: "offline", prompt: "consent", state: await crearState(email, appDesde(req)),
      });
      return json({ url: `${AUTH_URL}?${q}` });
    }
    if (body.accion === "sincronizar") return json(await sincronizar(email, Number(body.dias) || 7));
    if (body.accion === "sesion") {
      const inicio = new Date(String(body.inicio)), fin = new Date(String(body.fin));
      if (isNaN(+inicio) || isNaN(+fin) || fin <= inicio || +fin - +inicio > 3600_000) return json({ error: "Sesión inválida" }, 400);
      const { data: con } = await db.from("salud_conexion").select("*").eq("email", email).maybeSingle();
      if (!con) return json({ error: "No hay cuenta de Google Health conectada." }, 400);
      const at = await accessToken(con);
      const desde = inicio.toISOString().replace(/\.\d+Z$/, "Z");
      // Sin límite superior en el pulso: las muestras posteriores al fin dicen si el reloj ya sincronizó toda la sesión
      const [fcs, vfcs] = await Promise.all([
        lista(at, "heart-rate", `heart_rate.sample_time.physical_time >= "${desde}"`, 10000),
        lista(at, "heart-rate-variability", `heart_rate_variability.sample_time.physical_time >= "${desde}"`, 1000).catch(() => []),
      ]);
      return json(resumirSesion(fcs, vfcs, inicio.toISOString(), fin.toISOString()));
    }
    if (body.accion === "fcReciente") {
      const { data: con } = await db.from("salud_conexion").select("*").eq("email", email).maybeSingle();
      if (!con) return json({ error: "No hay cuenta de Google Health conectada." }, 400);
      const at = await accessToken(con);
      // Últimas 3 h; si el reloj no ha sincronizado en ese tiempo, se amplía a 24 h
      for (const horas of [3, 24]) {
        const desde = new Date(Date.now() - horas * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
        const r = resumirFc(await lista(at, "heart-rate", `heart_rate.sample_time.physical_time >= "${desde}"`, 10000));
        if (r.ultimo || horas === 24) return json({ ...r, horas });
      }
    }
    if (body.accion === "desconectar") {
      const { data: con } = await db.from("salud_conexion").select("refresh_token").eq("email", email).maybeSingle();
      if (con) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(con.refresh_token)}`, { method: "POST" }).catch(() => {});
      await db.from("salud_conexion").delete().eq("email", email);
      if (body.borrarDatos) await db.from("salud_dias").delete().eq("email", email);
      return json({ ok: true });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
