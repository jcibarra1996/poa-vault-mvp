-- Datos de salud del Fitbit Air (Google Health API v4). Cada usuario autorizado del CRM
-- (crm_usuarios) conecta su propia cuenta y solo ve sus propios días.

-- Tokens de OAuth de Google. Sin políticas: solo la Edge Function (service role) lee y escribe.
create table public.salud_conexion (
  email text primary key,
  refresh_token text not null,
  access_token text,
  expira timestamptz,
  health_user_id text default '',
  scopes text default '',
  conectado timestamptz not null default now(),
  ultima_sync timestamptz,
  error text default ''
);
alter table public.salud_conexion enable row level security;

-- Un renglón por día (fecha local del usuario). Las puntuaciones se calculan en el navegador
-- a partir de estas métricas; `crudo` guarda los payloads de Google para recalcular sin volver a pedirlos.
create table public.salud_dias (
  email text not null,
  fecha date not null,
  pasos int,
  azm int,
  fc_reposo numeric,
  vfc numeric,
  spo2 numeric,
  resp numeric,
  temp numeric,
  temp_base numeric,
  sueno jsonb,
  crudo jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now(),
  primary key (email, fecha)
);
alter table public.salud_dias enable row level security;

create policy salud_dias_propios on public.salud_dias for select to authenticated
  using (lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', '')) and (select public.crm_permitido()));
