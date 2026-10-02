alter table public.crm_contactos
  add column fecha_solicitud date,
  add column fecha_acepto date,
  add column fecha_mensaje date,
  add column fecha_respuesta date;

update public.crm_contactos c set
  fecha_solicitud = c.alta,
  fecha_mensaje = c.primer_mensaje,
  fecha_acepto = (select min((h->>'fecha')::date) from jsonb_array_elements(c.historial) h where h->>'texto' = 'Aceptó la solicitud'),
  fecha_respuesta = (select min((h->>'fecha')::date) from jsonb_array_elements(c.historial) h where h->>'texto' = 'Respondió');

-- Si ya hay mensaje enviado, implica que aceptó; usa la fecha del mensaje si no quedó registrada
update public.crm_contactos set fecha_acepto = fecha_mensaje where fecha_acepto is null and fecha_mensaje is not null;
