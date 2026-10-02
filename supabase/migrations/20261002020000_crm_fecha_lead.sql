alter table public.crm_contactos add column if not exists fecha_lead date;
update public.crm_contactos set fecha_lead = coalesce(fecha_solicitud, alta) where fecha_lead is null;
