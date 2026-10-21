-- Sesiones de medición con el Fitbit Air (estilo "momento"): el usuario se queda quieto unos minutos y después
-- se toman del Fitbit las muestras de pulso de esa ventana. Cada usuario ve, guarda y borra solo las suyas.
create table public.salud_mediciones (
  id uuid primary key default gen_random_uuid(),
  email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  creado timestamptz not null default now(),
  inicio timestamptz,
  fin timestamptz,
  fc numeric,
  fc_min numeric,
  fc_max numeric,
  fr numeric,
  vfc numeric,
  muestras int,
  duracion int,
  calidad numeric,
  fuente text not null default 'fitbit'
);
create index salud_mediciones_email_idx on public.salud_mediciones (email, creado desc);
alter table public.salud_mediciones enable row level security;

create policy salud_mediciones_propias on public.salud_mediciones for all to authenticated
  using (lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', '')) and (select public.crm_permitido()))
  with check (lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', '')) and (select public.crm_permitido()));
