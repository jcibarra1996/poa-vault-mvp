# Prospección Ibarra Quezada

CRM de prospección del despacho: socios contadores (referidores), clientes PyME, seguimientos con cadencia, referidos con comisión y plantillas de mensaje.

- Sitio estático (`index.html`, `app.js`, `config.js`), sin build. Se despliega en Vercel.
- Datos en Supabase (proyecto `iq-taskforge`), tablas `crm_*` con RLS. Esquema en `supabase/migrations/`.
- Acceso con link mágico por correo. Solo entran los correos de la tabla `crm_usuarios`.

Para autorizar otro correo:

```sql
insert into public.crm_usuarios (email) values ('otro@correo.com');
```
