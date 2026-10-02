-- Aplicada en el proyecto iq-taskforge (uzyzeaoliwzkmxiaudso) el 2026-10-02.
create table public.crm_usuarios (
  email text primary key
);
alter table public.crm_usuarios enable row level security;

create or replace function public.crm_permitido()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.crm_usuarios u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke execute on function public.crm_permitido() from public, anon;
grant execute on function public.crm_permitido() to authenticated;

create table public.crm_contactos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  pipeline text not null check (pipeline in ('socio','cliente')),
  subtipo text default '',
  empresa text default '',
  ubicacion text default '',
  linkedin text default '',
  email text default '',
  telefono text default '',
  etapa text not null,
  proxima_accion text default '',
  proxima_fecha date,
  toques int not null default 0,
  primer_mensaje date,
  ultimo_contacto date,
  notas text default '',
  comision_pct numeric,
  referido_por uuid references public.crm_contactos(id) on delete set null,
  origen text default '',
  alta date default current_date,
  actualizado timestamptz default now(),
  historial jsonb not null default '[]'::jsonb
);
create index crm_contactos_proxima_idx on public.crm_contactos (proxima_fecha);
create index crm_contactos_referido_idx on public.crm_contactos (referido_por);

create table public.crm_plantillas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  pipeline text not null default 'ambos' check (pipeline in ('socio','cliente','ambos')),
  texto text not null default '',
  orden int default 99
);

create table public.crm_referidos (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid references public.crm_contactos(id) on delete set null,
  cliente text not null,
  fecha date default current_date,
  asunto text default '',
  honorarios numeric not null default 0,
  comision_pct numeric not null default 0,
  pagada boolean not null default false
);
create index crm_referidos_socio_idx on public.crm_referidos (socio_id);

alter table public.crm_contactos enable row level security;
alter table public.crm_plantillas enable row level security;
alter table public.crm_referidos enable row level security;

create policy crm_contactos_all on public.crm_contactos for all to authenticated
  using ((select public.crm_permitido())) with check ((select public.crm_permitido()));
create policy crm_plantillas_all on public.crm_plantillas for all to authenticated
  using ((select public.crm_permitido())) with check ((select public.crm_permitido()));
create policy crm_referidos_all on public.crm_referidos for all to authenticated
  using ((select public.crm_permitido())) with check ((select public.crm_permitido()));

insert into public.crm_usuarios (email) values ('jcibarra1996@gmail.com');
